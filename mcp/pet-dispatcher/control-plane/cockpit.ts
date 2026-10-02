export const PET_COCKPIT_URI = "ui://pet-dispatcher/cockpit/v1";

export const PET_COCKPIT_HTML = String.raw`
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 18px; background: transparent; color: CanvasText; }
  main { max-width: 900px; margin: 0 auto; display: grid; gap: 14px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  h1 { margin: 0; font-size: 22px; letter-spacing: -0.02em; }
  .muted { opacity: .68; font-size: 13px; }
  .card { border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); border-radius: 14px; padding: 14px; background: color-mix(in srgb, Canvas 92%, CanvasText 8%); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(160px,1fr)); gap: 10px; }
  .stat { min-height: 80px; }
  .label { font-size: 12px; opacity: .65; margin-bottom: 6px; }
  .value { font-size: 18px; font-weight: 650; overflow-wrap: anywhere; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  button { font: inherit; border: 1px solid color-mix(in srgb, CanvasText 20%, transparent); background: ButtonFace; color: ButtonText; border-radius: 10px; padding: 8px 11px; cursor: pointer; }
  button:hover { filter: brightness(.96); }
  .target { font-size: 13px; }
  .target[aria-pressed="true"] { outline: 2px solid Highlight; outline-offset: 1px; }
  .status { display: inline-flex; gap: 7px; align-items: center; font-weight: 650; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: GrayText; }
  .ok .dot { background: #2e9b50; }
  .warn .dot { background: #d08b20; }
  .error { color: #c43b3b; white-space: pre-wrap; }
  code { font-size: .92em; }
  input { font: inherit; color: CanvasText; background: Canvas; padding: 9px; border: 1px solid GrayText; border-radius: 8px; max-width: 100%; }
  h2 { font-size: 16px; margin: 0 0 12px; }
  .task { display: block; width: 100%; text-align: left; margin: 6px 0; overflow-wrap: anywhere; }
  .task[aria-pressed="true"] { outline: 2px solid Highlight; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; max-height: 320px; overflow: auto; }
  .split { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 14px; }
  button:disabled { opacity: .5; cursor: default; }
  @media(max-width:600px) { .split { grid-template-columns: 1fr; } body { padding: 12px; } }
</style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>Pet Dispatcher</h1>
      <div class="muted">Confined work on the paired machine</div>
    </div>
    <button id="refresh" type="button" disabled>Refresh</button>
  </header>

  <section class="card">
    <div id="status" class="status"><span class="dot"></span><span>Loading...</span></div>
    <div id="updated" class="muted"></div>
  </section>

  <section class="grid">
    <div class="card stat"><div class="label">Device</div><div class="value" id="device">-</div></div>
    <div class="card stat"><div class="label">Active sessions</div><div class="value" id="sessions">-</div></div>
    <div class="card stat"><div class="label">Active processes</div><div class="value" id="processes">-</div></div>
    <div class="card stat"><div class="label">Isolation</div><div class="value" id="isolation">-</div></div>
  </section>

  <section class="card">
    <div class="label">Targets</div>
    <div id="targets" class="row"><span class="muted">No targets loaded.</span></div>
    <div id="selection" class="muted" style="margin-top:8px"></div>
  </section>

  <section class="card">
    <div class="label">Sandbox</div>
    <div class="muted" id="sandbox">-</div>
  </section>

  <section class="split">
    <div class="card"><h2>Recent tasks</h2><div id="tasks" class="muted">Loading tasks...</div></div>
    <div class="card"><h2>Task result</h2><div id="task-status" class="muted">Select a task.</div><pre id="task-result"></pre>
      <button id="cancel-task" type="button" disabled>Request cancellation</button>
    </div>
  </section>
  <section class="card"><h2>Sessions</h2>
    <div class="row"><button id="load-sessions" type="button" disabled>Load selected target sessions</button><span id="session-status" class="muted">Select a target.</span></div>
    <div id="session-list"></div>
    <form id="finish-form" hidden><p id="finish-info" class="muted"></p>
      <label>Commit message <input id="finish-message" required maxlength="500" placeholder="Describe the finished work"></label>
      <p class="muted">Finish stages changes, commits or exports them when applicable, and closes this session.</p>
      <button id="finish-session" type="submit">Finish selected session</button>
    </form>
  </section>
  <div id="error" class="error" role="alert"></div>
</main>
<script>
(function () {
  var pending = new Map();
  var nextId = 1;
  var selectedTarget = null;
  var initialized = false;
  var hasSnapshot = false;
  var stale = true;
  var selectedTask = null;
  var selectedSession = null;
  var sessionGeneration = 0;
  var taskGeneration = 0;
  var actionBusy = false;
  var interactiveReady = false;
  var sessionsLoading = false;

  function request(method, params, timeoutMs) {
    var id = nextId++;
    var timeout = typeof timeoutMs === "number" ? timeoutMs : 10000;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        pending.delete(id);
        reject(new Error(method + " timed out"));
      }, timeout);
      pending.set(id, {
        resolve: function (value) { clearTimeout(timer); resolve(value); },
        reject: function (error) { clearTimeout(timer); reject(error); }
      });
      window.parent.postMessage({ jsonrpc: "2.0", id: id, method: method, params: params }, "*");
    });
  }

  function notify(method, params) {
    window.parent.postMessage({ jsonrpc: "2.0", method: method, params: params }, "*");
  }

  function text(id, value) {
    document.getElementById(id).textContent = value == null ? "-" : String(value);
  }

  function metaBody(result) {
    return result && result.structuredContent && result.structuredContent.body
      ? result.structuredContent.body
      : null;
  }

  function resultErrorText(result) {
    if (!result || !Array.isArray(result.content)) return "Pet Dispatcher tool failed.";
    var lines = result.content
      .filter(function (item) { return item && item.type === "text" && typeof item.text === "string"; })
      .map(function (item) { return item.text; });
    return lines.length ? lines.join("\n") : "Pet Dispatcher tool failed.";
  }

  function handleToolResult(result) {
    if (result && result.isError === true) {
      text("error", "Snapshot not updated. " + resultErrorText(result));
      return false;
    }
    var body = metaBody(result);
    if (!body) {
      text("error", "Snapshot not updated. Pet Dispatcher returned no status data.");
      return false;
    }
    render(result);
    hasSnapshot = true;
    text("error", "");
    return true;
  }

  function setInteractive(value) {
    interactiveReady = value;
    document.getElementById("refresh").disabled = !value;
    document.querySelectorAll(".target").forEach(function (button) {
      button.disabled = !value;
    });
    syncSessionControls();
  }

  function syncSessionControls() {
    document.getElementById("load-sessions").disabled = !interactiveReady || !selectedTarget || stale || actionBusy || sessionsLoading;
    document.getElementById("finish-session").disabled = !interactiveReady || stale || actionBusy || !selectedSession || selectedSession.finishable !== true;
  }

  function render(result) {
    var body = metaBody(result);
    if (!body) return;
    stale = body.stale;
    syncSessionControls();
    if (stale) text("session-status", "Worker offline or stale; session inventory is unavailable.");
    if (result.structuredContent && Array.isArray(result.structuredContent.tasks)) renderTasks(result.structuredContent.tasks);
    var status = document.getElementById("status");
    status.className = "status " + (body.stale ? "warn" : "ok");
    status.querySelector("span:last-child").textContent = body.stale ? "Worker metadata is stale" : "Worker online";
    text("updated", body.updatedAt ? "Last update: " + body.updatedAt : "No heartbeat timestamp");
    text("device", body.deviceId);
    text("sessions", body.activeSessions);
    text("processes", body.activeProcesses);
    text("isolation", body.sandbox && body.sandbox.isolationTier ? body.sandbox.isolationTier : "unknown");
    text("sandbox", body.sandbox
      ? "process guard: " + body.sandbox.processGuard + " | network: " + body.sandbox.networkDefault
      : "unknown");

    var root = document.getElementById("targets");
    root.textContent = "";
    var targets = []
      .concat(Array.isArray(body.repositories) ? body.repositories : [])
      .concat(Array.isArray(body.workspaces) ? body.workspaces : []);
    targets.forEach(function (target) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "target";
      button.textContent = target;
      button.setAttribute("aria-pressed", String(target === selectedTarget));
      button.disabled = !initialized;
      button.onclick = function () { selectTarget(target); };
      root.appendChild(button);
    });
    if (targets.length === 0) {
      var empty = document.createElement("span");
      empty.className = "muted";
      empty.textContent = "No configured targets.";
      root.appendChild(empty);
    }
  }

  async function selectTarget(target) {
    if (!initialized || target === selectedTarget) return;
    setInteractive(false);
    text("selection", "Syncing target: " + target + "...");
    try {
      await request("ui/update-model-context", {
        content: [{ type: "text", text: "Selected Pet Dispatcher target: " + target + "." }],
        structuredContent: { target: target }
      });
      selectedTarget = target;
      sessionGeneration++;
      selectedSession = null;
      document.getElementById("session-list").textContent = "";
      document.getElementById("finish-form").hidden = true;
      syncSessionControls();
      text("session-status", stale ? "Worker offline or stale; session inventory is unavailable." : "Load sessions for " + target + ".");
      text("selection", "Selected target: " + target);
      document.querySelectorAll(".target").forEach(function (button) {
        button.setAttribute("aria-pressed", String(button.textContent === target));
      });
    } catch (error) {
      text("selection", selectedTarget ? "Selected target: " + selectedTarget : "No target selected.");
      text("error", "Target selection was not changed: " + String(error));
    } finally {
      setInteractive(true);
    }
  }

  async function refresh() {
    if (!initialized) return;
    var button = document.getElementById("refresh");
    button.disabled = true;
    try {
      // pet_meta remains the focused conversational status tool.
      var result = await request("tools/call", { name: "pet_cockpit_open", arguments: {} });
      handleToolResult(result);
      if (selectedTask) await showTask(selectedTask);
    } catch (error) {
      text("error", "Snapshot not updated. Refresh failed: " + String(error));
    } finally {
      button.disabled = false;
    }
  }

  async function call(name, args) {
    var result = await request("tools/call", { name: name, arguments: args }, 60000);
    if (!result || (result.isError && !(result.structuredContent && result.structuredContent.body && result.structuredContent.body.taskId))) throw new Error(resultErrorText(result));
    var structured = result.structuredContent;
    if (!structured) throw new Error("No structured result returned.");
    if (typeof structured.httpStatus === "number" && (structured.httpStatus < 200 || structured.httpStatus >= 300) && !(structured.body && structured.body.taskId)) throw new Error("Tool returned HTTP " + structured.httpStatus);
    return structured.body || structured;
  }

  function renderTasks(tasks) {
    var root = document.getElementById("tasks");
    root.textContent = tasks.length ? "" : "No recent tasks.";
    tasks.forEach(function (task) {
      var button = document.createElement("button");
      button.type = "button"; button.className = "task";
      button.textContent = task.status + " · " + task.taskId + (task.result ? "\n" + task.result.summary : "");
      button.setAttribute("aria-pressed", String(task.taskId === selectedTask));
      button.onclick = function () { showTask(task.taskId).catch(report); };
      root.appendChild(button);
    });
  }

  function report(error) { text("error", String(error)); }

  async function showTask(taskId) {
    var generation = ++taskGeneration;
    selectedTask = taskId;
    document.getElementById("cancel-task").disabled = true;
    text("task-status", "Loading " + taskId + "...");
    text("task-result", "");
    var task;
    try {
      task = await call("pet_task_get", { taskId: taskId, debug: true });
    } catch (error) {
      if (generation !== taskGeneration) return;
      text("task-status", "Failed to load " + taskId + ".");
      report(error);
      return;
    }
    if (generation !== taskGeneration) return;
    text("task-status", task.status + " · " + taskId);
    text("task-result", task.result ? JSON.stringify(task.result, null, 2) : "No result yet. Refresh to check progress.");
    document.getElementById("cancel-task").disabled = actionBusy || !["queued", "leased", "running"].includes(task.status);
    document.querySelectorAll(".task").forEach(function (button) { button.setAttribute("aria-pressed", String(button.textContent.includes(taskId))); });
  }

  async function resolveQueued(task, generation) {
    // Poll only the already accepted task. Never replay a session operation.
    for (var attempt = 0; attempt < 15 && ["queued", "leased", "running"].includes(task.status); attempt++) {
      await new Promise(function (resolve) { setTimeout(resolve, 2000); });
      if (generation !== sessionGeneration) return null;
      task = await call("pet_task_get", { taskId: task.taskId, debug: true });
    }
    return task;
  }

  async function loadSessions() {
    if (!interactiveReady || !selectedTarget || stale || actionBusy || sessionsLoading) return;
    sessionsLoading = true;
    var generation = ++sessionGeneration;
    selectedSession = null;
    document.getElementById("finish-form").hidden = true;
    document.getElementById("session-list").textContent = "";
    syncSessionControls();
    text("session-status", "Loading sessions...");
    try {
      var task = await call("pet_direct", { target: selectedTarget, tool: "session.list", args: {}, waitSeconds: 0, debug: true });
      task = await resolveQueued(task, generation);
      if (!task || generation !== sessionGeneration) return;
      if (task.status !== "completed" || !task.result || !task.result.data || !Array.isArray(task.result.data.sessions)) {
        throw new Error("Session inventory unavailable. Task " + task.taskId + ": " + task.status + ". Check Recent tasks.");
      }
      var sessions = task.result.data.sessions.filter(function (session) { return session.alias === selectedTarget || session.repo === selectedTarget; });
      text("session-status", sessions.length + " session(s) for " + selectedTarget + (sessions.length > 100 ? " · showing first 100" : ""));
      sessions.slice(0, 100).forEach(function (session) {
        var button = document.createElement("button");
        button.className = "task"; button.type = "button";
        button.textContent = session.id + " · " + (session.writable ? "writable" : "read only") + " · expires " + session.expiresAt + (session.finishable === true ? "" : " · finish unavailable");
        button.disabled = session.finishable !== true;
        button.onclick = function () {
          if (!interactiveReady || stale || actionBusy || session.finishable !== true) return;
          selectedSession = session;
          text("finish-info", "Selected session: " + session.id);
          document.getElementById("finish-form").hidden = false;
          document.getElementById("finish-message").value = "";
          syncSessionControls();
        };
        document.getElementById("session-list").appendChild(button);
      });
    } catch (error) { report(error); text("session-status", "Session inventory not updated."); }
    finally { sessionsLoading = false; syncSessionControls(); }
  }

  document.getElementById("load-sessions").onclick = loadSessions;
  document.getElementById("cancel-task").onclick = async function () {
    if (!selectedTask || actionBusy) return;
    actionBusy = true; this.disabled = true;
    var taskId = selectedTask;
    var cancellationError = null;
    try { await call("pet_task_cancel", { taskId: taskId }); if (selectedTask === taskId) await showTask(taskId); }
    catch (error) { cancellationError = error; }
    finally { actionBusy = false; await refresh(); if (cancellationError) report(cancellationError); }
  };
  document.getElementById("finish-form").onsubmit = async function (event) {
    event.preventDefault();
    var message = document.getElementById("finish-message").value.trim();
    if (!interactiveReady || !selectedSession || selectedSession.finishable !== true || !message || stale || actionBusy) return;
    actionBusy = true;
    document.getElementById("finish-session").disabled = true;
    document.getElementById("load-sessions").disabled = true;
    setInteractive(false);
    var generation = ++sessionGeneration;
    var actionNotice = null;
    try {
      var task;
      try {
        task = await call("pet_session_finish", { target: selectedTarget, sessionId: selectedSession.id, message: message, idempotencyKey: crypto.randomUUID(), waitSeconds: 0, debug: true });
      } catch (error) {
        // An uncertain transport response must not enable an automatic retry.
        selectedSession = null;
        document.getElementById("finish-form").hidden = true;
        actionNotice = "Finish response unavailable: " + error + ". Refresh tasks and sessions before deciding on another action.";
        return;
      }
      text("session-status", "Finish task: " + task.taskId + " · " + task.status + ". Check Recent tasks for the result.");
      selectedSession = null;
      document.getElementById("finish-form").hidden = true;
      document.getElementById("session-list").textContent = "";
      try {
        await showTask(task.taskId);
        await resolveQueued(task, generation);
      } catch (error) {
        actionNotice = "Finish submitted as task " + task.taskId + ", but progress is unavailable: " + error + ". Refresh tasks and sessions.";
      }
    } finally { actionBusy = false; setInteractive(true); await refresh(); if (actionNotice) report(actionNotice); }
  };

  async function initialize() {
    setInteractive(false);
    try {
      await request("ui/initialize", {
        protocolVersion: "2026-01-26",
        appInfo: { name: "Pet Dispatcher Cockpit", version: "1.0.0" },
        appCapabilities: {}
      });
      notify("ui/notifications/initialized", {});
      initialized = true;
      setInteractive(true);
      if (!hasSnapshot) await refresh();
    } catch (error) {
      var status = document.getElementById("status");
      status.className = "status warn";
      status.querySelector("span:last-child").textContent = "Cockpit bridge unavailable";
      text("error", "Initialization failed: " + String(error));
    }
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var message = event.data;
    if (!message || message.jsonrpc !== "2.0") return;
    if (message.id !== undefined && pending.has(message.id)) {
      var waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(message.error);
      else waiter.resolve(message.result);
      return;
    }
    if (message.method === "ui/notifications/tool-result") {
      handleToolResult(message.params);
    }
  }, { passive: true });

  document.getElementById("refresh").onclick = refresh;
  initialize();
}());
</script>
</body>
</html>
`.trim();
