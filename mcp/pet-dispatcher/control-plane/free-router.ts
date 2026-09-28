export const FREE_ROUTER_WORKER_PATH = "/v1/worker/providers/free/chat/completions";
export const WORK_ROUTER_WORKER_PATH = "/v1/worker/providers/work/chat/completions";

const KANAREK_REVIEW_PATH = "/review-router/v1/chat/completions";
const KANAREK_COMPANION_ORIGIN = "https://kanarek-companion.internal";
const KANAREK_FREE_MODEL = "kanarek-review-free";
const KANAREK_WORK_MODEL = "kanarek-work-paid";

export interface FreeRouterServiceBinding {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

export interface FreeRouterEnv {
  KANAREK_REVIEW_ROUTER_TOKEN?: string;
  KANAREK_COMPANION?: FreeRouterServiceBinding;
}

function unavailable(error: string, status = 503): Response {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

function routedBody(body: string, model: string): string | null {
  try {
    const value = JSON.parse(body) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return JSON.stringify({ ...(value as Record<string, unknown>), model });
  } catch {
    return null;
  }
}

async function proxyKanarekRouter(
  body: string,
  env: FreeRouterEnv,
  model: string,
  unavailableError: string,
  signal?: AbortSignal,
): Promise<Response> {
  const token = env.KANAREK_REVIEW_ROUTER_TOKEN?.trim();
  const service = env.KANAREK_COMPANION;
  if (!token || !service) return unavailable(unavailableError);
  const payload = routedBody(body, model);
  if (!payload) return unavailable("router_invalid_request", 400);

  try {
    const upstream = await service.fetch(new Request(`${KANAREK_COMPANION_ORIGIN}${KANAREK_REVIEW_PATH}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: payload,
      signal,
    }));
    const headers = new Headers({ "cache-control": "no-store" });
    const contentType = upstream.headers.get("content-type");
    const provider = upstream.headers.get("x-kanarek-review-provider");
    if (contentType) headers.set("content-type", contentType);
    if (provider) headers.set("x-kanarek-review-provider", provider);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return unavailable(`${unavailableError}_upstream_failed`, 502);
  }
}

export function proxyKanarekFreeRouter(
  body: string,
  env: FreeRouterEnv,
  signal?: AbortSignal,
): Promise<Response> {
  return proxyKanarekRouter(body, env, KANAREK_FREE_MODEL, "free_router_unavailable", signal);
}

export function proxyKanarekWorkRouter(
  body: string,
  env: FreeRouterEnv,
  signal?: AbortSignal,
): Promise<Response> {
  return proxyKanarekRouter(body, env, KANAREK_WORK_MODEL, "work_router_unavailable", signal);
}
