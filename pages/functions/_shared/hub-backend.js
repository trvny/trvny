// Keep local handlers available during deployment and binding outages.
export async function forwardHubRequest(context, local) {
  if (context.env?.HUB_BACKEND && context.request) {
    try {
      return await context.env.HUB_BACKEND.fetch(context.request);
    } catch {
      // Binding unavailable. Preserve the existing endpoint contract.
    }
  }
  return local(context);
}
