import { realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { win32 } from "node:path";
import { z } from "zod";

// Host mode authority. Host mode is OFF unless the local config lists what may be granted; the Legion
// refuses everything else whatever the Worker signed. Paths are Windows paths and are compared with
// win32 semantics on every platform, so the rules are testable in the Linux CI job too.

export const HOST_CAPABILITIES = ["host.fs.read", "host.fs.write", "host.exec", "process.manage"] as const;
export type HostCapability = (typeof HOST_CAPABILITIES)[number];
export const hostCapabilitySchema = z.enum(HOST_CAPABILITIES);

export const authorityConfigSchema = z.object({
  grantable: z.array(hostCapabilitySchema).max(HOST_CAPABILITIES.length).default([]),
  roots: z.array(z.string().min(1)).max(32).default([]),
  maxLeaseMinutes: z.number().int().min(1).max(480).default(60),
}).strict();
export type AuthorityConfig = z.infer<typeof authorityConfigSchema>;

export type TrustTier = "operator-interactive" | "trusted-delegate" | "untrusted-delegate";

/** The tier comes from how the signed task will be executed, never from a field the caller controls. */
export function tierForExecutor(executor: "direct" | "openrouter" | "deepseek" | "gemini"): TrustTier {
  return executor === "direct" ? "operator-interactive" : "untrusted-delegate";
}

// What each tier may ever hold, before the config allowlist narrows it further.
const TIER_CEILING: Record<TrustTier, readonly HostCapability[]> = {
  "operator-interactive": HOST_CAPABILITIES,
  "trusted-delegate": ["host.fs.read"],
  "untrusted-delegate": [],
};

export type PathMode = "read" | "write";
export interface Decision { allowed: boolean; reason?: string }
export interface Lease { id: string; capability: HostCapability; tier: TrustTier; grantedAt: number; expiresAt: number }

// Policy floor: no lease lifts it. Home-relative, matched on canonical paths after the root check.
const HOME_DENY_READ = [
  ".ssh", ".gnupg", ".aws", ".azure", ".engram", ".local\\share\\.engram", ".local\\share\\claude-backup", ".local\\share\\engram-export",
  ".claude\\secrets", ".claude\\.credentials.json", ".codex\\auth.json", ".git-credentials", ".config\\rclone", ".config\\gh\\hosts.yml",
  "AppData\\Roaming\\rclone", "AppData\\Roaming\\GitHub CLI\\hosts.yml",
];
// A write that becomes code execution (settings/hooks, profiles, autostart) or edits this policy.
const HOME_DENY_WRITE = [
  ".claude", "Documents\\PowerShell", "Documents\\WindowsPowerShell", ".bashrc", ".bash_profile", ".profile", ".local\\share\\pet-dispatcher",
  "AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup",
];
// Credential-shaped file names, denied for reading anywhere under a root.
const DENY_READ_NAME = [/^\.env(\..*)?$/iu, /\.(pem|key|pfx|p12|jks|keystore)$/iu, /^\.credentials\.json$/iu, /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/iu,
  /^hosts\.yml$/iu, /^auth\.json$/iu, /^\.git-credentials$/iu, /^\.npmrc$/iu, /^\.dev\.vars$/iu];
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/iu;

const key = (path: string): string => win32.normalize(path).replace(/[\\/]+$/u, "").toLowerCase();

function isInside(root: string, path: string): boolean {
  const rel = win32.relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !win32.isAbsolute(rel));
}

export interface AuthorityOptions {
  /** Home directory for the policy floor. */
  home: string;
  /** PD install root (config/, bin/, secrets/, app/): denied for read and write. */
  installRoot?: string;
  /** Canonicalizes roots; default resolves symlinks/junctions. Injected in tests. */
  canonicalize?: (path: string) => Promise<string>;
  now?: () => number;
}

export class AuthorityPolicy {
  readonly #grantable: ReadonlySet<HostCapability>;
  readonly #roots: readonly string[];
  readonly #maxLeaseMs: number;
  readonly #denyRead: readonly string[];
  readonly #denyWrite: readonly string[];
  readonly #now: () => number;
  readonly #leases = new Map<string, Lease>();

  private constructor(config: AuthorityConfig, roots: string[], options: AuthorityOptions) {
    this.#grantable = new Set(roots.length > 0 ? config.grantable : []);   // no usable root = host mode off
    this.#roots = roots;
    this.#maxLeaseMs = config.maxLeaseMinutes * 60_000;
    this.#now = options.now ?? Date.now;
    const home = win32.resolve(options.home);
    const install = options.installRoot ? [win32.resolve(options.installRoot)] : [];
    this.#denyRead = [...install, ...HOME_DENY_READ.map((p) => win32.join(home, p))].map(key);
    this.#denyWrite = [...install, ...[...HOME_DENY_READ, ...HOME_DENY_WRITE].map((p) => win32.join(home, p))].map(key);
  }

  static async create(config: AuthorityConfig | undefined, options: AuthorityOptions): Promise<AuthorityPolicy> {
    const parsed = authorityConfigSchema.parse(config ?? {});
    const canonicalize = options.canonicalize ?? ((path: string) => realpath(path));
    const roots: string[] = [];
    for (const root of parsed.roots) {
      try { roots.push(key(await canonicalize(win32.resolve(root)))); } catch { /* unavailable root grants nothing */ }
    }
    return new AuthorityPolicy(parsed, roots, options);
  }

  /** Capabilities the local config would let an operator hold; empty = host mode off (no roots = nothing to act on). */
  enabledCapabilities(): HostCapability[] {
    return HOST_CAPABILITIES.filter((c) => this.#grantable.has(c));
  }

  grant(capability: HostCapability, tier: TrustTier, ttlMinutes: number): Lease {
    if (!this.#grantable.has(capability)) throw new Error(`capability is not grantable on this host: ${capability}`);
    if (!TIER_CEILING[tier].includes(capability)) throw new Error(`${tier} may not hold ${capability}`);
    if (!Number.isFinite(ttlMinutes) || ttlMinutes < 1) throw new Error("lease ttl must be at least 1 minute");
    const ttlMs = Math.min(Math.trunc(ttlMinutes) * 60_000, this.#maxLeaseMs);
    const now = this.#now();
    const lease: Lease = { id: randomUUID(), capability, tier, grantedAt: now, expiresAt: now + ttlMs };
    this.#leases.set(lease.id, lease);
    return lease;
  }

  revoke(id: string): boolean { return this.#leases.delete(id); }
  revokeAll(): void { this.#leases.clear(); }

  list(): Lease[] {
    this.#prune();
    return [...this.#leases.values()];
  }

  /** True when `tier` currently holds a live lease for `capability`. Does not look at paths. */
  evaluate(capability: HostCapability, tier: TrustTier): Decision {
    if (!this.#grantable.has(capability)) return { allowed: false, reason: `${capability} is not enabled on this host` };
    if (!TIER_CEILING[tier].includes(capability)) return { allowed: false, reason: `${tier} may not use ${capability}` };
    this.#prune();
    for (const lease of this.#leases.values()) if (lease.capability === capability && lease.tier === tier) return { allowed: true };
    return { allowed: false, reason: `no active lease for ${capability}` };
  }

  /** Path rules for an already canonicalized absolute path: inside a root, outside the policy floor. */
  evaluatePath(canonicalPath: string, mode: PathMode): Decision {
    const raw = canonicalPath;
    if (/^[\\/]{2}[?.][\\/]/u.test(raw)) return { allowed: false, reason: "device paths are not allowed" };
    if (!win32.isAbsolute(raw) || /^[A-Za-z]:(?![\\/])/u.test(raw)) return { allowed: false, reason: "path must be absolute" };
    const withoutDrive = raw.replace(/^[A-Za-z]:/u, "");
    if (withoutDrive.includes(":")) return { allowed: false, reason: "alternate data streams are not allowed" };
    const normalized = win32.normalize(raw);
    const segments = normalized.split("\\").filter(Boolean);
    if (segments.some((s) => s === ".." || RESERVED_NAME.test(s))) return { allowed: false, reason: "reserved or relative path segment" };
    const path = key(normalized);
    if (!this.#roots.some((root) => isInside(root, path))) return { allowed: false, reason: "path is outside the granted roots" };
    const floor = mode === "write" ? this.#denyWrite : this.#denyRead;
    if (floor.some((denied) => isInside(denied, path))) return { allowed: false, reason: "path is protected by the policy floor" };
    const name = segments.at(-1) ?? "";
    if (mode === "read" && DENY_READ_NAME.some((pattern) => pattern.test(name))) return { allowed: false, reason: "credential-shaped file name" };
    return { allowed: true };
  }

  #prune(): void {
    const now = this.#now();
    for (const [id, lease] of this.#leases) if (lease.expiresAt <= now) this.#leases.delete(id);
  }
}
