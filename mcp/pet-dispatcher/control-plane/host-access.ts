import type { McpRoute } from "./mcp-auth.js";

// Host tasks (host.fs) are owner-route only, end to end: they can be submitted, read, cancelled and listed only by the
// owner. Connector callers get "not found", never a hint that a host task exists.

export function mayHandleHostTask(route: McpRoute | undefined): boolean {
  return route === "owner";
}

/** Host tasks are everything that runs on the machine itself: host.fs calls and host-target direct tools (system.status,
 *  system.wakeguard). All are hidden from connector routes and kept out of the shared recent-task index. */
export function isHostTask(task: { hostFs?: unknown; target?: string }): boolean {
  return task.hostFs !== undefined || task.target === "host";
}

/** Only host.fs needs the owner route to be submitted. Host-target direct tools are submitted by the owner's own
 *  entrypoints (owner HTTP, the private Telegram assistant binding); no connector tool can build one. */
export function requiresOwnerRoute(task: { hostFs?: unknown }): boolean {
  return task.hostFs !== undefined;
}

/** Whether a caller on `route` may see a task whose host flag is `isHost`. */
export function taskVisibleTo(isHost: boolean, route: McpRoute | undefined): boolean {
  return !isHost || mayHandleHostTask(route);
}

/** Host tasks never enter the shared recent-task index (it feeds pet_recent_tasks and the cockpit on every route). */
export function mayIndexTask(isHost: boolean): boolean {
  return !isHost;
}

/**
 * Whether a task must be hidden from `route`. `readFlag` reads the task's host flag; if it cannot be read, a non-owner
 * gets "not found" (fail closed) rather than a task that might be a host task.
 */
export async function hostTaskHiddenFrom(route: McpRoute | undefined, readFlag: () => Promise<boolean | undefined>): Promise<boolean> {
  if (route === "owner") return false;
  try {
    const host = await readFlag();
    return host === undefined ? true : !taskVisibleTo(host, route);
  } catch {
    return true;
  }
}
