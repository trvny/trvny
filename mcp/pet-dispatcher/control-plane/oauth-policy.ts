const MCP_BODY_LIMIT = 128 * 1024;

const READ_TOOLS = new Set([
  "pet_meta", "pet_recent_tasks", "pet_task_get", "pet_cockpit_open",
  "pet_workspace_inspect", "pet_read_files",
]);

/** An unknown or malformed MCP operation must not be granted read-only rights. */
export async function requiredPetScopes(request: Request): Promise<string[]> {
  if (request.method !== "POST") return ["pet:read"];
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MCP_BODY_LIMIT) {
    throw new RangeError("MCP request body is too large");
  }
  // Read only a bounded clone. The original stream is still available to the
  // MCP handler, and even a missing/incorrect Content-Length cannot bypass
  // the OAuth scope parser's memory ceiling.
  const reader = request.clone().body?.getReader();
  if (!reader) return ["pet:read", "pet:delegate"];
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MCP_BODY_LIMIT) {
      void reader.cancel().catch(() => {});
      throw new RangeError("MCP request body is too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return ["pet:read", "pet:delegate"];
  }
  const calls = Array.isArray(body) ? body : [body];
  const readOnly = calls.length > 0 && calls.every((call) => {
    if (!call || typeof call !== "object" || Array.isArray(call)) return false;
    const value = call as { method?: unknown; params?: { name?: unknown } };
    if (value.method === "initialize" || value.method === "ping" ||
        value.method === "tools/list" || value.method === "resources/list" ||
        value.method === "resources/read" || value.method === "notifications/initialized" ||
        value.method === "notifications/cancelled") return true;
    return value.method === "tools/call" && READ_TOOLS.has(String(value.params?.name ?? ""));
  });
  return readOnly ? ["pet:read"] : ["pet:read", "pet:delegate"];
}

/** A token issued to any other GitHub account must never open the connector. */
export function petOAuthOwnerMatches(
  verified: { githubId: number; githubLogin: string },
  configuredId: string | undefined,
  configuredLogin: string | undefined,
): boolean {
  const ownerId = Number(configuredId);
  return !!configuredId && !!configuredLogin && Number.isSafeInteger(ownerId) &&
    verified.githubId === ownerId && verified.githubLogin === configuredLogin;
}

/** OAuth remains dormant until the dedicated KV and GitHub client exist. */
export function petOAuthConfigured(env: {
  OAUTH_KV?: unknown;
  PET_OAUTH_GITHUB_CLIENT_ID?: string;
  PET_OAUTH_GITHUB_CLIENT_SECRET?: string;
  PET_OAUTH_GITHUB_ID?: string;
  PET_OAUTH_GITHUB_LOGIN?: string;
}): boolean {
  return !!(env.OAUTH_KV && env.PET_OAUTH_GITHUB_CLIENT_ID?.trim() &&
    env.PET_OAUTH_GITHUB_CLIENT_SECRET?.trim() && env.PET_OAUTH_GITHUB_ID?.trim() &&
    env.PET_OAUTH_GITHUB_LOGIN?.trim());
}
