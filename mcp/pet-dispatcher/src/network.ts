import { createServer } from "node:http";
import { connect, isIP } from "node:net";
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

export interface SubprocessNetworkProxy {
  url: string;
  close(): Promise<void>;
}

const SAFE_RESPONSE_HEADERS = new Set(["content-type", "content-length", "etag", "last-modified", "location"]);
const MAX_REDIRECTS = 5;

function hasControlCharacter(value: string): boolean {
  return [...value].some((char) => {
    const code = char.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function hostMatches(hostname: string, rule: string): boolean {
  return hostname.toLowerCase() === rule.toLowerCase();
}

export function assertAllowedConnectAuthority(authority: string, hosts: readonly string[]): { host: string; port: number } {
  const match = /^([^:/?#]+):(\d{1,5})$/u.exec(authority.trim());
  if (!match) throw new Error("proxy CONNECT destination must be host:443");
  const host = match[1]?.toLowerCase() ?? "";
  const port = Number(match[2]);
  if (port !== 443) throw new Error("proxy CONNECT permits HTTPS port 443 only");
  if (isIP(host) !== 0) throw new Error("IP-literal destinations are not allowed");
  if (!hosts.some((rule) => hostMatches(host, rule))) throw new Error(`destination is outside the session network profile: ${host}`);
  return { host, port };
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

  async openProxy(session: Session): Promise<SubprocessNetworkProxy> {
    if (session.network.mode !== "brokered" || !session.network.profile) throw new Error("session has no brokered network capability");
    const profile = this.config.networkProfiles[session.network.profile];
    if (!profile) throw new Error(`unknown network profile: ${session.network.profile}`);
    const sockets = new Set<{ destroy(): void }>();
    const server = createServer((_request, response) => {
      response.writeHead(405, { Connection: "close", "Content-Type": "text/plain" });
      response.end("HTTPS CONNECT only\\n");
    });
    server.on("connect", (request, client, head) => {
      let destination: { host: string; port: number };
      try { destination = assertAllowedConnectAuthority(request.url ?? "", profile.hosts); }
      catch { client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
      sockets.add(client);
      client.once("close", () => sockets.delete(client));
      const upstream = connect(destination.port, destination.host);
      sockets.add(upstream);
      upstream.once("close", () => sockets.delete(upstream));
      let established = false;
      upstream.once("connect", () => {
        established = true;
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) upstream.write(head);
        client.pipe(upstream); upstream.pipe(client);
      });
      upstream.once("error", () => {
        if (!client.destroyed && !established) client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
        else client.destroy();
      });
      client.once("error", () => upstream.destroy());
      client.once("close", () => upstream.destroy());
    });
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
      const onListening = () => { server.off("error", onError); resolve(); };
      server.once("error", onError); server.once("listening", onListening); server.listen(0, "127.0.0.1");
    });
    const address = server.address();
    if (!address || typeof address === "string") { server.close(); throw new Error("failed to allocate subprocess proxy port"); }
    let closed = false;
    return {
      url: `http://127.0.0.1:${address.port}`,
      close: async () => {
        if (closed) return; closed = true;
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      },
    };
  }

  async request(session: Session, request: BrokeredFetchRequest): Promise<BrokeredFetchResult> {
    if (session.network.mode !== "brokered" && session.network.mode !== "restricted") {
      throw new Error("session has no brokered network capability");
    }
    if (!session.network.profile) throw new Error("session network profile is missing");
    const profile = this.config.networkProfiles[session.network.profile];
    if (!profile) throw new Error(`unknown network profile: ${session.network.profile}`);

    const method = request.method ?? "GET";
    if (request.accept && (request.accept.length > 256 || hasControlCharacter(request.accept))) {
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
