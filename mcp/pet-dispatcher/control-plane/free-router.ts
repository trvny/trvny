export const FREE_ROUTER_WORKER_PATH = "/v1/worker/providers/free/chat/completions";

const KANAREK_REVIEW_PATH = "/review-router/v1/chat/completions";
const KANAREK_COMPANION_ORIGIN = "https://kanarek-companion.internal";

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

export async function proxyKanarekFreeRouter(
  body: string,
  env: FreeRouterEnv,
  signal?: AbortSignal,
): Promise<Response> {
  const token = env.KANAREK_REVIEW_ROUTER_TOKEN?.trim();
  const service = env.KANAREK_COMPANION;
  if (!token || !service) return unavailable("free_router_unavailable");

  try {
    const upstream = await service.fetch(new Request(`${KANAREK_COMPANION_ORIGIN}${KANAREK_REVIEW_PATH}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body,
      signal,
    }));
    const headers = new Headers({ "cache-control": "no-store" });
    const contentType = upstream.headers.get("content-type");
    if (contentType) headers.set("content-type", contentType);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return unavailable("free_router_upstream_failed", 502);
  }
}
