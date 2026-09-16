import assert from "node:assert/strict";
import test from "node:test";
import {
  compactRecentTask,
  type RecentTaskRef,
  upsertRecentTaskRef,
} from "../control-plane/recent-task-index.js";
import type { RemoteTaskState } from "../src/remote-protocol.js";

const task = (id: string, createdAt: string, updatedAt = createdAt, status: RemoteTaskState["status"] = "running"): RemoteTaskState => ({
  taskId: id,
  deviceId: "legion",
  status,
  createdAt,
  updatedAt,
  heartbeatAt: updatedAt,
  cancelRequested: false,
  result: status === "completed" ? {
    status: "completed",
    summary: `done-${id}`,
    output: "heavy output must not be exposed",
    data: { hidden: true },
  } : undefined,
});

test("recent task refs are newest-first, deduplicated and bounded", () => {
  let index: RecentTaskRef[] = Array.from({ length: 20 }, (_, i) => ({
    taskId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    createdAt: `2026-09-16T10:${String(i).padStart(2, "0")}:00.000Z`,
  }));
  const id = index[5]!.taskId;
  index = upsertRecentTaskRef(index, task(id, "2026-09-16T11:00:00.000Z"));
  assert.equal(index.length, 20);
  assert.equal(index[0]?.taskId, id);
  assert.equal(index.filter((item) => item.taskId === id).length, 1);
});

test("recent task snapshots omit heavy result payloads", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const snapshot = compactRecentTask(task(id, "2026-09-16T10:00:00.000Z", "2026-09-16T11:00:00.000Z", "completed"));
  assert.equal(snapshot.result?.summary, `done-${id}`);
  assert.equal("output" in (snapshot.result ?? {}), false);
  assert.equal("data" in (snapshot.result ?? {}), false);
});
