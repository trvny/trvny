// Keep local handlers available during deployment and binding outages.
export async function forwardHubRequest(context, local, { fallbackOnMissingRoute = false } = {}) {
  if (context.env?.HUB_BACKEND && context.request) {
    try {
      const response = await context.env.HUB_BACKEND.fetch(context.request);
      // Older Worker versions do not dispatch newly added routes.
      if (!fallbackOnMissingRoute || response.status !== 404 || response.headers.has('x-travny-backend')) return response;
    } catch (error) {
      console.warn('Hub binding unavailable; using local handler', error instanceof Error ? error.name : 'unknown');
    }
  }
  return local(context);
}

// Explicit Pages HEAD handlers preserve GET headers even with the local fallback.
export async function hubHead(context, get) {
  const response = await get(context);
  await response.body?.cancel();
  return new Response(null, { status: response.status, headers: response.headers });
}
