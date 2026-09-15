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

export function mcpAuthorized(request: Request, env: McpAuthEnv): boolean {
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
    return true;
  }

  const expectedConnectorToken = env.MCP_CONNECTOR_TOKEN;
  if (!expectedConnectorToken) return false;
  const suppliedConnectorToken = connectorToken(pathname);
  return suppliedConnectorToken !== undefined && secretsMatch(suppliedConnectorToken, expectedConnectorToken);
}
