import { lookup } from "node:dns/promises";
import { once } from "node:events";
import { createServer } from "node:http";
import { BlockList, connect, isIP } from "node:net";
import type { Duplex } from "node:stream";
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
  port: number;
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

function isAllowedHost(hostname: string, hosts: readonly string[]): boolean {
  const normalized = hostname.toLowerCase();
  return hosts.some((host) => normalized === host.toLowerCase());
}

function configuredNetworkProfile(config: DispatcherConfig, name: string) {
  const profile = config.networkProfiles[name];
  if (!profile) throw new Error(`unknown network profile: ${name}`);
  return profile;
}

const NON_PUBLIC_IPV4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) NON_PUBLIC_IPV4.addSubnet(address, prefix, "ipv4");

const NON_PUBLIC_IPV6 = new BlockList();
for (const [address, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96], ["100::", 64], ["2001:2::", 48],
  ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) NON_PUBLIC_IPV6.addSubnet(address, prefix, "ipv6");

export interface ResolvedConnectTarget { address: string; family: 4 | 6 }
type ConnectResolver = (hostname: string) => Promise<ResolvedConnectTarget[]>;

function isPublicConnectAddress(address: string, family: 4 | 6): boolean {
  if (isIP(address) !== family) return false;
  return family === 4 ? !NON_PUBLIC_IPV4.check(address, "ipv4") : !NON_PUBLIC_IPV6.check(address, "ipv6");
}

export async function resolvePublicConnectTarget(
  hostname: string,
  resolver: ConnectResolver = async (host) => lookup(host, { all: true, verbatim: true }) as Promise<ResolvedConnectTarget[]>,
): Promise<ResolvedConnectTarget> {
  const addresses = await resolver(hostname);
  if (addresses.length === 0) throw new Error(`DNS returned no addresses for ${hostname}`);
  if (addresses.some(({ address, family }) => !isPublicConnectAddress(address, family))) {
    throw new Error(`DNS returned a non-public address for ${hostname}`);
  }
  return addresses[0]!;
}

export function assertAllowedConnectAuthority(authority: string, hosts: readonly string[]): { host: string; port: number } {
  const match = /^([^:/?#]+):(\d{1,5})$/u.exec(authority.trim());
  if (!match) throw new Error("proxy CONNECT destination must be host:443");
  const host = match[1]?.toLowerCase() ?? "";
  const port = Number(match[2]);
  if (port !== 443) throw new Error("proxy CONNECT permits HTTPS port 443 only");
  if (isIP(host) !== 0) throw new Error("IP-literal destinations are not allowed");
  if (!isAllowedHost(host, hosts)) throw new Error(`destination is outside the session network profile: ${host}`);
  return { host, port };
}

export function assertAllowedUrl(rawUrl: string, hosts: readonly string[]): URL {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:") throw new Error("brokered network permits HTTPS only");
  if (url.username || url.password) throw new Error("URL credentials are not allowed");
  if (url.port && url.port !== "443") throw new Error("brokered HTTPS is restricted to port 443");
  const ipCandidate = url.hostname.startsWith("[") && url.hostname.endsWith("]") ? url.hostname.slice(1, -1) : url.hostname;
  if (isIP(ipCandidate) !== 0) throw new Error("IP-literal destinations are not allowed");
  if (!isAllowedHost(url.hostname, hosts)) {
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
    const profile = configuredNetworkProfile(this.config, session.network.profile);
    const sockets = new Set<Duplex>();
    const trackSocket = (socket: Duplex): void => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    };
    const server = createServer((_request, response) => {
      response.writeHead(405, { Connection: "close", "Content-Type": "text/plain" });
      response.end("HTTPS CONNECT only\\n");
    });
    server.on("connect", async (request, client, head) => {
      let destination: { host: string; port: number };
      try { destination = assertAllowedConnectAuthority(request.url ?? "", profile.hosts); }
      catch { client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
      let target: ResolvedConnectTarget;
      try { target = await resolvePublicConnectTarget(destination.host); }
      catch { client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
      trackSocket(client);
      const upstream = connect({ host: target.address, port: destination.port, family: target.family });
      trackSocket(upstream);
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
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") { server.close(); throw new Error("failed to allocate subprocess proxy port"); }
    let closed = false;
    return {
      url: `http://127.0.0.1:${address.port}`,
      port: address.port,
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
    const profile = configuredNetworkProfile(this.config, session.network.profile);

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
