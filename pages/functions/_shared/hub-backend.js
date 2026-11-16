// Keep local handlers available during deployment and binding outages.
export async function forwardHubRequest(context, local) {
  if (context.env?.HUB_BACKEND && context.request) {
    try {
      return await context.env.HUB_BACKEND.fetch(context.request);
    } catch (error) {
      console.warn('Hub binding unavailable; using local radio handler', error instanceof Error ? error.name : 'unknown');
    }
  }
  return local(context);
}
