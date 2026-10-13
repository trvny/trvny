import type { McpRoute } from "./mcp-auth.js";

// Host tasks (host.fs) are owner-route only, end to end: they can be submitted, read, cancelled and listed only by the
// owner. Connector callers get "not found", never a hint that a host task exists.

export function mayHandleHostTask(route: McpRoute | undefined): boolean {
  return route === "owner";
}

/** Whether a caller on `route` may see a task whose host flag is `isHost`. */
export function taskVisibleTo(isHost: boolean, route: McpRoute | undefined): boolean {
  return !isHost || mayHandleHostTask(route);
}

/** Host tasks never enter the shared recent-task index (it feeds pet_recent_tasks and the cockpit on every route). */
export function mayIndexTask(isHost: boolean): boolean {
  return !isHost;
}
