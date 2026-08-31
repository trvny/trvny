import { isIP } from "node:net";
import type { DispatcherConfig } from "./config.js";
import type { Session } from "./sessions.js";

export type NetworkMode = "none" | "brokered" | "restricted";

export interface NetworkAccess {
  mode: NetworkMode;
  profile: string | null;
}

export interface BrokeredFetchRequest {
  url: string;
  method?: "GET" | "HEAD";
  accept?: string;
}

export interface BrokeredFetchResult {
  status: number;
  url: string;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
}

const SAFE_RESPONSE_HEADERS = new Set(["content-type", "content-length", "etag", "last-modified", "location"]);
const MAX_REDIRECTS = 5;
function hostMatches(hostname: string, rule: string): boolean {
  const host = hostname.toLowerCase();
  const normalized = rule.toLowerCase();
  if (normalized.startsWith("*.")) {
    const suffix = normalized.slice(1);
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return host === normalized;
}

export function assertAllowedUrl(rawUrl: string, hosts: readonly string[]): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") throw new Error("brokered network permits HTTPS only");
  if (url.username || url.password) throw new Error("URL credentials are not allowed");
  if (url.port && url.port !== "443") throw new Error("brokered HTTPS is restricted to port 443");
  const ipCandidate = url.hostname.startsWith("[") && url.hostname.endsWith("]") ? url.hostname.slice(1, -1) : url.hostname;
  if (isIP(ipCandidate) !== 0) throw new Error("IP-literal destinations are not allowed");
  if (!hosts.some((rule) => hostMatches(url.hostname, rule))) {
    throw new Error(`destination is outside the session network profile: ${url.hostname}`);
  }
  return url;
}

async function readBoundedText(response: Response, limit: number): Promise<{ body: string; truncated: boolean }> {
  if (!response.body) return { body: "", truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    const remaining = limit - total;
    if (remaining <= 0) { truncated = true; await reader.cancel(); break; }
    if (value.byteLength > remaining) {
      chunks.push(value.subarray(0, remaining));
      total += remaining;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return { body: new TextDecoder().decode(merged), truncated };
}

export class NetworkBroker {
  constructor(
    readonly config: DispatcherConfig,
    readonly fetchImpl: typeof fetch = fetch,
  ) {}

  profileNames(): string[] { return Object.keys(this.config.networkProfiles).sort(); }
  async request(session: Session, request: BrokeredFetchRequest): Promise<BrokeredFetchResult> {
    if (session.network.mode !== "brokered" && session.network.mode !== "restricted") {
      throw new Error("session has no brokered network capability");
    }
    if (!session.network.profile) throw new Error("session network profile is missing");
    const profile = this.config.networkProfiles[session.network.profile];
    if (!profile) throw new Error(`unknown network profile: ${session.network.profile}`);

    const method = request.method ?? "GET";
    if (request.accept && (request.accept.length > 256 || /[\x00-\x1f\x7f]/u.test(request.accept))) {
      throw new Error("invalid Accept header");
    }
    let url = assertAllowedUrl(request.url, profile.hosts);
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const response = await this.fetchImpl(url, {
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
        headers: request.accept ? { Accept: request.accept } : undefined,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location) throw new Error("redirect response is missing Location");
        if (redirects === MAX_REDIRECTS) throw new Error("too many redirects");
        url = assertAllowedUrl(new URL(location, url).toString(), profile.hosts);
        continue;
      }
      const headers = Object.fromEntries([...response.headers].filter(([name]) => SAFE_RESPONSE_HEADERS.has(name.toLowerCase())));
      const body = method === "HEAD" ? { body: "", truncated: false } : await readBoundedText(response, this.config.maxBrokerResponseBytes);
      return { status: response.status, url: url.toString(), headers, ...body };
    }
    throw new Error("redirect handling failed closed");
  }
}
