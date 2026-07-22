import type { WarningFetchResult } from "./sources";
import type { Warning } from "./types";

/**
 * Replace only categories confirmed by IMGW during this cycle. A failed meteo
 * or hydro request keeps its previous active warnings, preventing false
 * "warning lifted" entries during upstream outages.
 */
export function reconcileWarnings(previous: readonly Warning[], result: WarningFetchResult): Warning[] {
  const succeeded = new Set(result.succeeded);
  const preserved = previous.filter((warning) => !succeeded.has(warning.category));
  return [...result.warnings, ...preserved];
}
