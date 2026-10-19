// First-match dispatch: a route returns a Response to claim the request,
// or null to pass it to the next route.
export type Route<C> = (context: C) => Promise<Response | null> | Response | null;

export async function firstMatch<C>(
  routes: readonly Route<C>[],
  context: C,
): Promise<Response | null> {
  for (const route of routes) {
    const response = await route(context);
    if (response) return response;
  }
  return null;
}
