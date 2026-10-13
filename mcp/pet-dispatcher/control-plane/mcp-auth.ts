export interface McpAuthEnv {
  CONTROL_PLANE_TOKEN?: string;
  MCP_CONNECTOR_TOKEN?: string;
}

function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function connectorToken(pathname: string): string | undefined {
  const match = pathname.match(/^\/mcp\/([^/]+)$/u);
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

export function isMcpPath(pathname: string): boolean {
  return pathname === "/mcp" || /^\/mcp\/[^/]+$/u.test(pathname);
}

export type McpRoute = "owner" | "connector";

/**
 * Which credential authorized the request: "owner" = the operator bearer header on plain /mcp, "connector" = the secret URL
 * token. null = not authorized. The route decides whether host tools exist for the caller at all.
 */
export function mcpRoute(request: Request, env: McpAuthEnv): McpRoute | null {
  const pathname = new URL(request.url).pathname;
  const operatorToken = env.CONTROL_PLANE_TOKEN;
  const authorization = request.headers.get("authorization") ?? "";
  const bearerPrefix = "Bearer ";
  if (
    pathname === "/mcp"
    && operatorToken
    && authorization.startsWith(bearerPrefix)
    && secretsMatch(authorization.slice(bearerPrefix.length), operatorToken)
  ) {
    return "owner";
  }

  const expectedConnectorToken = env.MCP_CONNECTOR_TOKEN;
  if (!expectedConnectorToken) return null;
  const suppliedConnectorToken = connectorToken(pathname);
  return suppliedConnectorToken !== undefined && secretsMatch(suppliedConnectorToken, expectedConnectorToken) ? "connector" : null;
}

export function mcpAuthorized(request: Request, env: McpAuthEnv): boolean {
  return mcpRoute(request, env) !== null;
}
