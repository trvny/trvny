const READ_TOOLS = new Set([
  "pet_meta", "pet_recent_tasks", "pet_task_get", "pet_cockpit_open",
  "pet_workspace_inspect", "pet_read_files",
]);

/** An unknown or malformed MCP operation must not be granted read-only rights. */
export async function requiredPetScopes(request: Request): Promise<string[]> {
  if (request.method !== "POST") return ["pet:read"];
  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return ["pet:read", "pet:delegate"];
  }
  const calls = Array.isArray(body) ? body : [body];
  const readOnly = calls.length > 0 && calls.every((call) => {
    if (!call || typeof call !== "object" || Array.isArray(call)) return false;
    const value = call as { method?: unknown; params?: { name?: unknown } };
    if (value.method === "initialize" || value.method === "ping" ||
        value.method === "tools/list" || value.method === "resources/list" ||
        value.method === "resources/read" || value.method === "notifications/initialized") return true;
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
