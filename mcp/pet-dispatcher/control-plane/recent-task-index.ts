import type { RemoteTaskState } from "../src/remote-protocol.js";

export const RECENT_TASK_LIMIT = 20;

export type RecentTaskRef = Pick<RemoteTaskState, "taskId" | "createdAt">;

export type RecentTaskSnapshot = Pick<
  RemoteTaskState,
  "taskId" | "deviceId" | "status" | "createdAt" | "updatedAt" | "heartbeatAt"
> & {
  result?: {
    status: string;
    summary: string;
    commit?: string;
    exportedRef?: string;
    error?: string;
  };
};

export function compactRecentTask(task: RemoteTaskState): RecentTaskSnapshot {
  const result = task.result ? {
    status: task.result.status,
    summary: task.result.summary.slice(0, 2_000),
    ...(task.result.commit ? { commit: task.result.commit } : {}),
    ...(task.result.exportedRef ? { exportedRef: task.result.exportedRef } : {}),
    ...(task.result.error ? { error: task.result.error.slice(0, 1_000) } : {}),
  } : undefined;
  return {
    taskId: task.taskId,
    deviceId: task.deviceId,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.heartbeatAt ? { heartbeatAt: task.heartbeatAt } : {}),
    ...(result ? { result } : {}),
  };
}

export function upsertRecentTaskRef(
  index: RecentTaskRef[],
  task: RemoteTaskState,
  limit = RECENT_TASK_LIMIT,
): RecentTaskRef[] {
  const next = { taskId: task.taskId, createdAt: task.createdAt };
  return [next, ...index.filter((item) => item.taskId !== task.taskId)]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, Math.max(1, Math.min(limit, RECENT_TASK_LIMIT)));
}
