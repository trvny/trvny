import assert from "node:assert/strict";
import test from "node:test";
import { isMcpPath, mcpAuthorized } from "../control-plane/mcp-auth.js";

const env = {
  CONTROL_PLANE_TOKEN: "operator-secret",
  MCP_CONNECTOR_TOKEN: "connector-secret",
};

function request(path: string, authorization?: string): Request {
  const headers = authorization ? { authorization } : undefined;
  return new Request(`https://pet.example${path}`, { method: "POST", headers });
}

test("operator bearer authorizes only the canonical MCP endpoint", () => {
  assert.equal(mcpAuthorized(request("/mcp", "Bearer operator-secret"), env), true);
  assert.equal(mcpAuthorized(request("/mcp/wrong", "Bearer operator-secret"), env), false);
});

test("connector token authorizes only the single-secret MCP URL", () => {
  assert.equal(mcpAuthorized(request("/mcp/connector-secret"), env), true);
  assert.equal(mcpAuthorized(request("/mcp/wrong"), env), false);
  assert.equal(mcpAuthorized(request("/mcp/connector-secret/extra"), env), false);
});

test("connector URL is not treated as an operator REST credential", () => {
  assert.equal(isMcpPath("/v1/meta"), false);
  assert.equal(mcpAuthorized(request("/v1/meta"), env), false);
});

test("MCP path matcher accepts only canonical or one-token forms", () => {
  assert.equal(isMcpPath("/mcp"), true);
  assert.equal(isMcpPath("/mcp/connector-secret"), true);
  assert.equal(isMcpPath("/mcp/"), false);
  assert.equal(isMcpPath("/mcp/connector-secret/extra"), false);
});

test("connector authentication fails closed when the secret is missing", () => {
  assert.equal(mcpAuthorized(request("/mcp/connector-secret"), { CONTROL_PLANE_TOKEN: "operator-secret" }), false);
});
