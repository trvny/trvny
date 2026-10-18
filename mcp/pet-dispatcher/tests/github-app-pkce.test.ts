import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { githubAppAuthorizeUrl, githubAppPkce } from "../control-plane/github-app-pkce.js";

test("GitHub App login reuses the client with PKCE S256 and an explicit Pet callback", async () => {
  const { verifier, challenge } = await githubAppPkce();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const expected = Buffer.from(digest).toString("base64url");
  assert.equal(challenge, expected);
  assert.ok(verifier.length >= 43);
  const url = new URL(githubAppAuthorizeUrl(
    "existing-gremlin-client", "https://pet.example/oauth/github/callback", "bound-state", challenge,
  ));
  assert.equal(url.origin, "https://github.com");
  assert.equal(url.pathname, "/login/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), "existing-gremlin-client");
  assert.equal(url.searchParams.get("redirect_uri"), "https://pet.example/oauth/github/callback");
  assert.equal(url.searchParams.get("state"), "bound-state");
  assert.equal(url.searchParams.get("code_challenge"), challenge);
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "offline_access");
  assert.equal(url.toString().includes(verifier), false, "PKCE verifier must not travel to GitHub");
});

test("Pet reuses GPTomek GitHub App secrets but isolates the OAuth KV store", async () => {
  const workflow = await readFile(new URL("../../../.github/workflows/automation-sync.yml", import.meta.url), "utf8");
  const fallback = await readFile(new URL("../../../.github/workflows/pet-dispatcher.yml", import.meta.url), "utf8");
  const wrangler = await readFile(new URL("../control-plane/wrangler.jsonc", import.meta.url), "utf8");
  const script = await readFile(new URL("../../../.github/scripts/sync-pet-oauth-credentials.sh", import.meta.url), "utf8");
  for (const yaml of [workflow, fallback]) {
    assert.match(yaml, /sync-pet-oauth-credentials\.sh/u);
    assert.match(yaml, /group: pet-dispatcher-control-oauth-credentials/u);
    assert.match(yaml, /GREMLIN_OAUTH_CLIENT_ID/u);
    assert.match(yaml, /GREMLIN_OAUTH_CLIENT_SECRET/u);
  }
  assert.match(script, /PET_OAUTH_GITHUB_CLIENT_ID: process\.env\.GREMLIN_OAUTH_CLIENT_ID/u);
  assert.match(script, /PET_OAUTH_GITHUB_CLIENT_SECRET: process\.env\.GREMLIN_OAUTH_CLIENT_SECRET/u);
  assert.match(script, /wrangler secret bulk/u);
  assert.doesNotMatch(script, /wrangler secret put/u);
  assert.match(wrangler, /"binding": "OAUTH_KV"/u);
  assert.match(wrangler, /"id": "eb005239a6b04209b0a4f9bc79f71bcb"/u);
});
