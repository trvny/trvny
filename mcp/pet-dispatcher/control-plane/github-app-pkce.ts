/** GitHub App web authorization reuses the same client as MechaGremlin. */
export async function githubAppPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const bytes = String.fromCharCode(...new Uint8Array(digest));
  const challenge = btoa(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return { verifier, challenge };
}

export function githubAppAuthorizeUrl(clientId: string, callback: string, state: string, challenge: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", callback);
  url.searchParams.set("state", state);
  // Match Gremlin's GitHub App web flow. The temporary GitHub token is used
  // only to verify identity, then discarded (never stored in OAuth props).
  url.searchParams.set("scope", "offline_access");
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}
