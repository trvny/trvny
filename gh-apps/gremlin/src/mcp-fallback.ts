// Unauthenticated MCP traffic must never reach the legacy GitHub-token
// MCP runtime. The OAuth provider calls this fallback for missing, invalid,
// and wrong-audience credentials.
export function unauthenticatedMcpFallback(request: Request, origin: string): Response | null {
  if (new URL(request.url).pathname !== '/mcp') return null;
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
      },
    });
  }
  return Response.json({ error: 'unauthorized' }, {
    status: 401,
    headers: {
      'Cache-Control': 'no-store',
      'WWW-Authenticate': 'Bearer resource_metadata="' + origin + '/.well-known/oauth-protected-resource/mcp"',
    },
  });
}
