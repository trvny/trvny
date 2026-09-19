export type RouteDecision<Result> =
  | { matched: false }
  | { matched: true; route: string; value: Result };

export type PredicateRoute<Context, Result> = {
  name: string;
  run(context: Context): Promise<RouteDecision<Result>>;
};

export function definePredicateRoute<Context, Match, Result>(
  name: string,
  match: (context: Context) => Match | undefined,
  handle: (context: Context, match: Match) => Result | Promise<Result>,
): PredicateRoute<Context, Result> {
  if (!name.trim()) throw new Error("route name must not be empty");

  return {
    name,
    async run(context) {
      const matched = match(context);
      if (matched === undefined) return { matched: false };
      return {
        matched: true,
        route: name,
        value: await handle(context, matched),
      };
    },
  };
}

export async function routeFirst<Context, Result>(
  context: Context,
  routes: readonly PredicateRoute<Context, Result>[],
): Promise<RouteDecision<Result>> {
  for (const route of routes) {
    const decision = await route.run(context);
    if (decision.matched) return decision;
  }
  return { matched: false };
}
