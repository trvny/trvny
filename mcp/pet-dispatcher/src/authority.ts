import { realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { win32 } from "node:path";
import { z } from "zod";
import { validateWindowsPathComponents } from "./path-guard.js";

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
export type TaskExecutor = "direct" | "openrouter" | "deepseek" | "gemini";
/** Which MCP route submitted the task. Until the Worker stamps it into the signed envelope (PR 2) it is unknown. */
export type SubmitRoute = "owner" | "connector";

/**
 * The tier comes from verified facts about the signed task, never from a caller-supplied label: a direct task is
 * operator-level only when it arrived on the owner route; a direct task of unknown or connector origin, and every
 * provider-executed task, is untrusted. Fail-closed while the route is unknown.
 */
export function tierFor(executor: TaskExecutor, route?: SubmitRoute): TrustTier {
  return executor === "direct" && route === "owner" ? "operator-interactive" : "untrusted-delegate";
}

// What each tier may ever hold, before the config allowlist narrows it further.
const TIER_CEILING: Record<TrustTier, readonly HostCapability[]> = {
  "operator-interactive": HOST_CAPABILITIES,
  "trusted-delegate": ["host.fs.read"],
  "untrusted-delegate": [],
};

export type PathMode = "read" | "write";
export interface Decision { allowed: boolean; reason?: string }
export interface Lease { id: string; capability: HostCapability; tier: TrustTier; owner: string; grantedAt: number; expiresAt: number }

// Policy floor: no lease lifts it. Home-relative, matched on canonical paths after the root check.
const HOME_DENY_READ = [
  ".ssh", ".gnupg", ".aws", ".azure", ".docker", ".kube", ".config\\gcloud", ".config\\rclone", ".config\\gh\\hosts.yml",
  ".engram", ".local\\share\\.engram", ".local\\share\\claude-backup", ".local\\share\\engram-export",
  ".claude\\secrets", ".claude\\.credentials.json", ".codex\\auth.json", ".git-credentials", ".netrc", "_netrc", ".pgpass",
  ".terraform.d\\credentials.tfrc.json", "AppData\\Roaming\\rclone", "AppData\\Roaming\\gcloud", "AppData\\Roaming\\GitHub CLI\\hosts.yml",
  // The legacy Desktop Commander dir also holds PD's session clones, legacy DPAPI blobs and the legacy live config.
  "dir\\.dc\\pet-dispatcher-workspace", "dir\\.dc\\.secrets", "dir\\.dc\\pet-dispatcher",
];
// A write that becomes code execution (settings/hooks, profiles, autostart) or edits this policy.
const HOME_DENY_WRITE = [
  ".claude", "Documents\\PowerShell", "Documents\\WindowsPowerShell", ".bashrc", ".bash_profile", ".profile", ".local\\share\\pet-dispatcher",
  "AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup", ".gitconfig", ".config\\git",
];
// Segment rules, applied under every root: a write here runs code later (git hooks/fsmonitor on the next git command,
// project hooks when Claude Code opens the repo).
const DENY_WRITE_SEGMENT = new Set([".git", ".claude"]);
// Credential-shaped file names, denied for reading anywhere under a root.
const DENY_READ_NAME = [/^\.env(\..*)?$/iu, /\.(pem|key|pfx|p12|jks|keystore)$/iu, /^\.credentials\.json$/iu, /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/iu,
  /^hosts\.yml$/iu, /^auth\.json$/iu, /^\.git-credentials$/iu, /^\.npmrc$/iu, /^\.dev\.vars$/iu, /^\.?_?netrc$/iu, /^\.pgpass$/iu,
  /^kubeconfig$/iu, /^credentials\.tfrc\.json$/iu];

/** Comparison key: normalized, lower-case, no trailing separator except on a drive root ("c:\" stays the volume root). */
const key = (path: string): string => {
  const normalized = win32.normalize(path).toLowerCase();
  return /^[a-z]:\\$/u.test(normalized) ? normalized : normalized.replace(/[\\/]+$/u, "");
};

function isInside(root: string, path: string): boolean {
  const rel = win32.relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith("..\\") && !win32.isAbsolute(rel));
}

export interface AuthorityOptions {
  /** Home directory for the policy floor. */
  home: string;
  /** PD install root (config/, bin/, secrets/, app/): denied for read and write. */
  installRoot?: string;
  /** More paths denied for read and write (e.g. the worker's session workspace root, the config directory). */
  extraDeny?: string[];
  /** Canonicalizes roots and floor entries; default resolves symlinks/junctions. Injected in tests. */
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
  /** Configured roots that could not be canonicalized and therefore grant nothing; surfaced so the operator sees the typo. */
  readonly skippedRoots: readonly string[];

  private constructor(config: AuthorityConfig, roots: string[], skipped: string[], denyRead: string[], denyWrite: string[], options: AuthorityOptions) {
    this.#grantable = new Set(roots.length > 0 ? config.grantable : []);   // no usable root = host mode off
    this.#roots = roots;
    this.skippedRoots = skipped;
    this.#maxLeaseMs = config.maxLeaseMinutes * 60_000;
    this.#now = options.now ?? Date.now;
    this.#denyRead = denyRead;
    this.#denyWrite = denyWrite;
  }

  static async create(config: AuthorityConfig | undefined, options: AuthorityOptions): Promise<AuthorityPolicy> {
    const parsed = authorityConfigSchema.parse(config ?? {});
    const canonicalize = options.canonicalize ?? ((path: string) => realpath(path));
    const roots: string[] = [];
    const skipped: string[] = [];
    for (const root of parsed.roots) {
      try { roots.push(key(await canonicalize(win32.resolve(root)))); } catch { skipped.push(root); }
    }
    // Bases (home, install root) are canonicalized too and entries are derived from both spellings, so a junction in
    // front of a protected directory cannot make its canonical path look unprotected.
    const bases = async (path: string): Promise<string[]> => {
      const raw = win32.resolve(path);
      const out = [raw];
      try { const real = await canonicalize(raw); if (key(real) !== key(raw)) out.push(real); } catch { /* absent: raw only */ }
      return out;
    };
    const homes = await bases(options.home);
    const always = [
      ...(options.installRoot ? await bases(options.installRoot) : []),
      ...(await Promise.all((options.extraDeny ?? []).map(bases))).flat(),
    ];
    const expand = async (paths: string[]): Promise<string[]> => {
      const out = new Set<string>();
      for (const path of paths) {
        out.add(key(path));
        try { out.add(key(await canonicalize(path))); } catch { /* not present: the raw spelling still applies */ }
      }
      return [...out];
    };
    const homeJoin = (list: string[]) => homes.flatMap((home) => list.map((entry) => win32.join(home, entry)));
    const denyRead = await expand([...always, ...homeJoin(HOME_DENY_READ)]);
    const denyWrite = await expand([...always, ...homeJoin([...HOME_DENY_READ, ...HOME_DENY_WRITE])]);
    return new AuthorityPolicy(parsed, roots, skipped, denyRead, denyWrite, options);
  }

  /** Capabilities the local config would let an operator hold; empty = host mode off (no usable root = nothing to act on). */
  enabledCapabilities(): HostCapability[] {
    return HOST_CAPABILITIES.filter((c) => this.#grantable.has(c));
  }

  /**
   * Grants `capability` to one owner (a session or task id), for a tier derived from the task's verified facts.
   * A lease is only valid for the owner it was granted to.
   */
  grant(capability: HostCapability, executor: TaskExecutor, route: SubmitRoute | undefined, owner: string, ttlMinutes: number): Lease {
    const tier = tierFor(executor, route);
    if (!owner) throw new Error("a lease needs an owner");
    if (!this.#grantable.has(capability)) throw new Error(`capability is not grantable on this host: ${capability}`);
    if (!TIER_CEILING[tier].includes(capability)) throw new Error(`${tier} may not hold ${capability}`);
    if (!Number.isFinite(ttlMinutes) || ttlMinutes < 1) throw new Error("lease ttl must be at least 1 minute");
    const ttlMs = Math.min(Math.trunc(ttlMinutes) * 60_000, this.#maxLeaseMs);
    const now = this.#now();
    const lease: Lease = { id: randomUUID(), capability, tier, owner, grantedAt: now, expiresAt: now + ttlMs };
    this.#leases.set(lease.id, lease);
    return { ...lease };
  }

  revoke(id: string): boolean { return this.#leases.delete(id); }
  revokeAll(): void { this.#leases.clear(); }
  /** Drops every lease an owner holds (session closed). */
  revokeOwner(owner: string): number {
    let removed = 0;
    for (const [id, lease] of this.#leases) if (lease.owner === owner) { this.#leases.delete(id); removed += 1; }
    return removed;
  }

  list(): Lease[] {
    this.#prune();
    return [...this.#leases.values()].map((lease) => ({ ...lease }));
  }

  /**
   * Static allowance without a lease: the local config lists the capability and the task's tier may hold it. Meant for
   * read-only capabilities, where the allowlist + roots + policy floor are the consent; write/exec use leases.
   */
  permits(capability: HostCapability, executor: TaskExecutor, route: SubmitRoute | undefined): Decision {
    const tier = tierFor(executor, route);
    if (!this.#grantable.has(capability)) return { allowed: false, reason: `${capability} is not enabled on this host` };
    if (!TIER_CEILING[tier].includes(capability)) return { allowed: false, reason: `${tier} may not use ${capability}` };
    return { allowed: true };
  }

  /** True when `owner` currently holds a live lease for `capability` at the tier its task earns. Does not look at paths. */
  evaluate(capability: HostCapability, executor: TaskExecutor, route: SubmitRoute | undefined, owner: string): Decision {
    const tier = tierFor(executor, route);
    if (!this.#grantable.has(capability)) return { allowed: false, reason: `${capability} is not enabled on this host` };
    if (!TIER_CEILING[tier].includes(capability)) return { allowed: false, reason: `${tier} may not use ${capability}` };
    this.#prune();
    for (const lease of this.#leases.values()) {
      if (lease.capability === capability && lease.tier === tier && lease.owner === owner) return { allowed: true };
    }
    return { allowed: false, reason: `no active lease for ${capability}` };
  }

  /**
   * Path rules for an absolute path: inside a root, outside the policy floor. `canonicalPath` is the resolved target;
   * pass the spelling the caller used as `lexicalPath` too: the floor, the .git/.claude segment rule and the credential
   * names are checked on both, so a junction such as repo\.git -> elsewhere cannot hide the denied component.
   */
  evaluatePath(canonicalPath: string, mode: PathMode, lexicalPath?: string): Decision {
    const canonical = this.#check(canonicalPath, mode, true);
    if (!canonical.allowed || lexicalPath === undefined) return canonical;
    return this.#check(lexicalPath, mode, false);
  }

  #check(raw: string, mode: PathMode, enforceRoots: boolean): Decision {
    if (/^[\\/]{2}[?.][\\/]/u.test(raw)) return { allowed: false, reason: "device paths are not allowed" };
    if (!win32.isAbsolute(raw) || /^[A-Za-z]:(?![\\/])/u.test(raw)) return { allowed: false, reason: "path must be absolute" };
    const withoutDrive = raw.replace(/^[A-Za-z]:/u, "");
    if (withoutDrive.includes(":")) return { allowed: false, reason: "alternate data streams are not allowed" };
    const normalized = win32.normalize(raw);
    const segments = normalized.split("\\").filter(Boolean);
    if (segments.includes("..")) return { allowed: false, reason: "relative path segment" };
    // Same component rules as the workspace path guard: reserved device names (incl. CLOCK$, CONIN$, COM-superscripts, "NUL .txt")
    // and trailing dots/spaces, which Win32 drops so that "x." is "x" on disk and would dodge the name and floor rules.
    try { validateWindowsPathComponents(withoutDrive.replace(/^[\\/]{2}[^\\/]+[\\/][^\\/]+/u, "")); }
    catch (error) { return { allowed: false, reason: error instanceof Error ? error.message : "invalid Windows path component" }; }
    const path = key(normalized);
    if (enforceRoots && !this.#roots.some((root) => isInside(root, path))) return { allowed: false, reason: "path is outside the granted roots" };
    const floor = mode === "write" ? this.#denyWrite : this.#denyRead;
    if (floor.some((denied) => isInside(denied, path))) return { allowed: false, reason: "path is protected by the policy floor" };
    if (mode === "write" && segments.some((s) => DENY_WRITE_SEGMENT.has(s.toLowerCase()))) {
      return { allowed: false, reason: "writes under .git or .claude can execute code later" };
    }
    const name = segments.at(-1) ?? "";
    if (mode === "read" && DENY_READ_NAME.some((pattern) => pattern.test(name))) return { allowed: false, reason: "credential-shaped file name" };
    return { allowed: true };
  }

  #prune(): void {
    const now = this.#now();
    for (const [id, lease] of this.#leases) if (lease.expiresAt <= now) this.#leases.delete(id);
  }
}

/** Device-meta fragment for the Worker: present only while host mode is on (older strict Workers never see an empty field). */
export function hostMetaFields(policy: AuthorityPolicy): { hostCapabilities?: HostCapability[] } {
  const enabled = policy.enabledCapabilities();
  return enabled.length ? { hostCapabilities: enabled } : {};
}
