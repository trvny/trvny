import assert from "node:assert/strict";
import test from "node:test";
import { petOAuthOwnerMatches, requiredPetScopes } from "../control-plane/oauth-policy.js";

function rpc(method: string, params?: Record<string, unknown>): Request {
  return new Request("https://pet.example/oauth/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
}

test("OAuth authorizes only the exact configured GitHub identity", () => {
  const owner = { githubId: 120686325, githubLogin: "trvny" };
  assert.equal(petOAuthOwnerMatches(owner, "120686325", "trvny"), true);
  assert.equal(petOAuthOwnerMatches({ ...owner, githubLogin: "another" }, "120686325", "trvny"), false);
  assert.equal(petOAuthOwnerMatches({ ...owner, githubId: 999 }, "120686325", "trvny"), false);
  assert.equal(petOAuthOwnerMatches(owner, undefined, "trvny"), false);
  assert.equal(petOAuthOwnerMatches(owner, "NaN", "trvny"), false);
  assert.equal(petOAuthOwnerMatches(owner, "120686325", undefined), false);
});

test("read-only tools need only the read scope", async () => {
  for (const name of ["pet_meta", "pet_workspace_inspect", "pet_read_files", "pet_recent_tasks", "pet_task_get", "pet_cockpit_open"]) {
    assert.deepEqual(await requiredPetScopes(rpc("tools/call", { name })), ["pet:read"], name);
  }
  assert.deepEqual(await requiredPetScopes(rpc("tools/list")), ["pet:read"]);
  assert.deepEqual(await requiredPetScopes(rpc("initialize")), ["pet:read"]);
  assert.deepEqual(await requiredPetScopes(rpc("resources/read", { uri: "ui://pet-dispatcher/cockpit/v1" })), ["pet:read"]);
});

test("mutating or unknown tools demand delegation scope", async () => {
  for (const name of ["pet_delegate", "pet_direct", "pet_session_finish", "pet_task_cancel", "pet_host_fs", "something_new"]) {
    assert.deepEqual(await requiredPetScopes(rpc("tools/call", { name })), ["pet:read", "pet:delegate"], name);
  }
  assert.deepEqual(await requiredPetScopes(rpc("custom/operation")), ["pet:read", "pet:delegate"]);
  const batch = [ { jsonrpc: "2.0", id: 1, method: "tools/list" }, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "pet_delegate" } } ];
  assert.deepEqual(await requiredPetScopes(new Request("https://pet.example/oauth/mcp", {
    method: "POST", body: JSON.stringify(batch),
  })), ["pet:read", "pet:delegate"]);
  assert.deepEqual(await requiredPetScopes(new Request("https://pet.example/oauth/mcp", {
    method: "POST", body: "{bad",
  })), ["pet:read", "pet:delegate"]);
  assert.deepEqual(await requiredPetScopes(new Request("https://pet.example/oauth/mcp", {
    method: "POST", body: "[]",
  })), ["pet:read", "pet:delegate"]);
});
