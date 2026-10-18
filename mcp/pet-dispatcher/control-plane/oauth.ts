import {
  AuthorizationError,
  OAuthProvider,
  insufficientScope,
  type AuthRequest,
  type OAuthHelpers,
} from "@cloudflare/workers-oauth-provider";
import { WorkerEntrypoint } from "cloudflare:workers";
import { githubAppAuthorizeUrl, githubAppPkce } from "./github-app-pkce.js";
import { petOAuthOwnerMatches, requiredPetScopes } from "./oauth-policy.js";

// The OAuth endpoint is separate from the existing /mcp owner bearer and
// /mcp/<connector-secret> compatibility routes until the ChatGPT cutover.
export const PET_OAUTH_ORIGIN = "https://pet-dispatcher-control.travny.workers.dev";
export const PET_OAUTH_RESOURCE = PET_OAUTH_ORIGIN + "/oauth/mcp";
const GITHUB_CALLBACK = PET_OAUTH_ORIGIN + "/oauth/github/callback";
const SCOPES = ["pet:read", "pet:delegate", "offline_access"] as const;
export interface PetOAuthEnv {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  PET_OAUTH_GITHUB_CLIENT_ID?: string;
  PET_OAUTH_GITHUB_CLIENT_SECRET?: string;
  PET_OAUTH_GITHUB_ID?: string;
  PET_OAUTH_GITHUB_LOGIN?: string;
}

interface PetAuthProps {
  githubId: number;
  githubLogin: string;
}

function configured(env: PetOAuthEnv): boolean {
  return !!(
    env.PET_OAUTH_GITHUB_CLIENT_ID && env.PET_OAUTH_GITHUB_CLIENT_SECRET &&
    env.PET_OAUTH_GITHUB_ID && env.PET_OAUTH_GITHUB_LOGIN
  );
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/gu, (char) => "&#" + char.charCodeAt(0) + ";");
}

function consentPage(details: {
  clientName: string;
  clientDomain?: string;
  redirectHost: string;
  redirectIsLoopback: boolean;
  scope: string[];
}, handle: string): string {
  const publisher = details.clientDomain
    ? "Client domain: <strong>" + htmlEscape(details.clientDomain) + "</strong>."
    : "This client's displayed name is self-reported.";
  const scopes = details.scope.map((scope) =>
    '<label><input type="checkbox" name="scope" value="' + htmlEscape(scope) +
    '" checked> ' + htmlEscape(scope) + "</label>").join("");
  return '<!doctype html><html lang="en"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Authorize Pet Dispatcher</title>' +
    '<style>body{font:16px system-ui;max-width:40rem;margin:8vh auto;padding:1.5rem;line-height:1.6}label{display:block}button{font:inherit;padding:.5rem 1rem;margin:.5rem .5rem .5rem 0}</style>' +
    '<h1>Allow ' + htmlEscape(details.clientName) + ' to use Pet Dispatcher?</h1>' +
    '<p>' + publisher + ' Tokens will be delivered to <strong>' +
    htmlEscape(details.redirectHost) + '</strong>.</p>' +
    (details.redirectIsLoopback ? '<p><strong>Local redirect:</strong> continue only if you initiated this login.</p>' : '') +
    '<p>Read permits confined inspection. Delegate permits task creation, edits, cancellation and session finalization. Host filesystem tools stay operator-only.</p>' +
    '<form method="post" action="/authorize"><input type="hidden" name="handle" value="' +
    htmlEscape(handle) + '">' + scopes +
    '<p><button name="decision" value="approve">Allow</button>' +
    '<button name="decision" value="deny">Deny</button></p></form></html>';
}

function errorRedirect(request: AuthRequest): string {
  const url = new URL(request.redirectUri);
  url.searchParams.set("error", "access_denied");
  if (request.state) url.searchParams.set("state", request.state);
  if (request.issuer) url.searchParams.set("iss", request.issuer);
  return url.toString();
}

async function authorize(request: Request, env: PetOAuthEnv): Promise<Response> {
  if (!configured(env)) return new Response("Pet Dispatcher GitHub OAuth is not configured", { status: 503 });
  try {
    if (request.method === "GET") {
      const parsed = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      const details = await env.OAUTH_PROVIDER.describeConsent(parsed);
      const consent = await env.OAUTH_PROVIDER.beginConsent(parsed);
      consent.headers.set("content-type", "text/html; charset=utf-8");
      return new Response(consentPage(details, consent.handle), { headers: consent.headers });
    }
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const form = await request.formData();
    const handle = String(form.get("handle") ?? "");
    if (form.get("decision") !== "approve") {
      const denied = await env.OAUTH_PROVIDER.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const scopes = form.getAll("scope").map(String);
    if (!scopes.includes("pet:read")) return new Response("Required scope missing", { status: 400 });
    const approved = await env.OAUTH_PROVIDER.approveConsent(request, handle, { scope: scopes });
    const { verifier, challenge } = await githubAppPkce();
    const upstream = await env.OAUTH_PROVIDER.beginUpstream(approved.request, {
      data: { verifier }, headers: approved.headers,
    });
    upstream.headers.set("Location", githubAppAuthorizeUrl(
      env.PET_OAUTH_GITHUB_CLIENT_ID!, GITHUB_CALLBACK, upstream.state, challenge,
    ));
    return new Response(null, { status: 302, headers: upstream.headers });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return error.redirectTo ? Response.redirect(error.redirectTo, 302)
        : new Response("Invalid authorization request", { status: 400 });
    }
    throw error;
  }
}

async function gitHubUser(env: PetOAuthEnv, code: string, verifier: string): Promise<PetAuthProps | null> {
  let token: Response;
  try {
    token = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.PET_OAUTH_GITHUB_CLIENT_ID!,
        client_secret: env.PET_OAUTH_GITHUB_CLIENT_SECRET!,
        code,
        redirect_uri: GITHUB_CALLBACK,
        code_verifier: verifier,
      }),
    });
  } catch {
    throw new Error("upstream_github_unavailable");
  }
  if (token.status >= 500 || token.status === 429 || token.status === 403) throw new Error("upstream_github_unavailable");
  if (!token.ok) return null;
  let result: unknown;
  try { result = await token.json(); }
  catch { throw new Error("upstream_github_unavailable"); }
  const accessToken = typeof result === "object" && result !== null && "access_token" in result
    ? (result as { access_token?: unknown }).access_token : undefined;
  if (typeof accessToken !== "string" || !accessToken) return null;
  let response: Response;
  try {
    response = await fetch("https://api.github.com/user", {
      headers: {
        "accept": "application/vnd.github+json",
        "authorization": "Bearer " + accessToken,
        "user-agent": "Pet-Dispatcher-OAuth",
        "x-github-api-version": "2022-11-28",
      },
    });
  } catch {
    throw new Error("upstream_github_unavailable");
  }
  if (response.status >= 500 || response.status === 429 || response.status === 403) throw new Error("upstream_github_unavailable");
  if (!response.ok) return null;
  let user: unknown;
  try { user = await response.json(); }
  catch { throw new Error("upstream_github_unavailable"); }
  if (!user || typeof user !== "object" || Array.isArray(user)) return null;
  const identity = user as { id?: unknown; login?: unknown };
  const ownerId = Number(env.PET_OAUTH_GITHUB_ID);
  if (!petOAuthOwnerMatches({ githubId: typeof identity.id === "number" ? identity.id : NaN, githubLogin: String(identity.login ?? "") }, env.PET_OAUTH_GITHUB_ID, env.PET_OAUTH_GITHUB_LOGIN)) return null;
  return { githubId: ownerId, githubLogin: env.PET_OAUTH_GITHUB_LOGIN! };
}

async function callback(request: Request, env: PetOAuthEnv): Promise<Response> {
  if (!configured(env)) return new Response("Pet Dispatcher GitHub OAuth is not configured", { status: 503 });
  try {
    const completed = await env.OAUTH_PROVIDER.finishUpstream<{ verifier: string }>(request);
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    if (url.searchParams.has("error") || !code) {
      completed.headers.set("location", errorRedirect(completed.request));
      return new Response(null, { status: 302, headers: completed.headers });
    }
    if (typeof completed.data?.verifier !== "string" || completed.data.verifier.length < 43) {
      return new Response("Invalid GitHub PKCE state", { status: 400 });
    }
    const user = await gitHubUser(env, code, completed.data.verifier);
    if (!user) {
      completed.headers.set("location", errorRedirect(completed.request));
      return new Response(null, { status: 302, headers: completed.headers });
    }
    // Only verified identity is retained in the grant. GitHub access tokens
    // are neither stored in KV props nor passed into MCP handlers.
    const granted = await env.OAUTH_PROVIDER.completeAuthorization({
      request: completed.request,
      userId: "github:" + user.githubId,
      metadata: { provider: "github" },
      scope: completed.request.scope,
      props: user,
    });
    completed.headers.set("location", granted.redirectTo);
    return new Response(null, { status: 302, headers: completed.headers });
  } catch (error) {
    if (error instanceof AuthorizationError) return new Response("Invalid or expired authorization", { status: 400 });
    if (error instanceof Error && error.message === "upstream_github_unavailable") {
      return new Response("GitHub sign-in temporarily unavailable. Restart sign-in from the MCP client; the previous callback state cannot be replayed.", {
        status: 503, headers: { "cache-control": "no-store", "retry-after": "30" },
      });
    }
    throw error;
  }
}

export function withPetOAuth<Env extends PetOAuthEnv>(
  fallback: ExportedHandler<Env>,
  handleConnector: (request: Request, env: Env) => Promise<Response>,
): ExportedHandler<Env> {
  class PetMcpHandler extends WorkerEntrypoint<Env, PetAuthProps> {
    async fetch(request: Request): Promise<Response> {
      const context = this.ctx as typeof this.ctx & { auth?: { scope?: string[] } };
      if (!petOAuthOwnerMatches(this.ctx.props, this.env.PET_OAUTH_GITHUB_ID, this.env.PET_OAUTH_GITHUB_LOGIN)) {
        return new Response("Forbidden", { status: 403 });
      }
      let required: string[];
      try { required = await requiredPetScopes(request); }
      catch (error) {
        if (error instanceof RangeError) return new Response("MCP request body is too large", { status: 413 });
        throw error;
      }
      if (!required.every((scope) => context.auth?.scope?.includes(scope))) {
        if (!context.auth?.scope) return new Response("Forbidden", { status: 403 });
        return insufficientScope(context.auth as Parameters<typeof insufficientScope>[0], required);
      }
      return handleConnector(request, this.env);
    }
  }
  const defaultHandler: ExportedHandler<Env> = {
    fetch(request, env, ctx) {
      const path = new URL(request.url).pathname;
      if (path === "/authorize") return authorize(request, env);
      if (path === "/oauth/github/callback") return callback(request, env);
      return fallback.fetch!(request, env, ctx);
    },
  };
  return new OAuthProvider<Env>({
    apiRoute: "/oauth/mcp",
    apiHandler: PetMcpHandler,
    defaultHandler,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: [...SCOPES],
    requiredScopes: ["pet:read"],
    resourceMetadata: {
      resource: PET_OAUTH_RESOURCE,
      authorization_servers: [PET_OAUTH_ORIGIN],
      resource_name: "Pet Dispatcher",
    },
  });
}
