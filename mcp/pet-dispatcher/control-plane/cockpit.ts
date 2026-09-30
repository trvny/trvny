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
</style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>Pet Dispatcher</h1>
      <div class="muted">Confined work on the paired machine</div>
    </div>
    <button id="refresh" type="button">Refresh</button>
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

  <div id="error" class="error" role="alert"></div>
</main>
<script>
(function () {
  var pending = new Map();
  var nextId = 1;
  var selectedTarget = null;

  function request(method, params) {
    var id = nextId++;
    window.parent.postMessage({ jsonrpc: "2.0", id: id, method: method, params: params }, "*");
    return new Promise(function (resolve, reject) {
      pending.set(id, { resolve: resolve, reject: reject });
    });
  }

  function text(id, value) {
    document.getElementById(id).textContent = value == null ? "-" : String(value);
  }

  function metaBody(result) {
    return result && result.structuredContent && result.structuredContent.body
      ? result.structuredContent.body
      : null;
  }

  function render(result) {
    var body = metaBody(result);
    if (!body) return;
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
    selectedTarget = target;
    text("selection", "Selected target: " + target);
    document.querySelectorAll(".target").forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.textContent === target));
    });
    try {
      await request("ui/update-model-context", {
        content: [{ type: "text", text: "Selected Pet Dispatcher target: " + target + "." }],
        structuredContent: { target: target }
      });
      text("error", "");
    } catch (error) {
      text("error", "Could not sync target with the conversation: " + String(error));
    }
  }

  async function refresh() {
    var button = document.getElementById("refresh");
    button.disabled = true;
    try {
      var result = await request("tools/call", { name: "pet_meta", arguments: {} });
      render(result);
      text("error", "");
    } catch (error) {
      text("error", "Refresh failed: " + String(error));
    } finally {
      button.disabled = false;
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
      render(message.params);
    }
  }, { passive: true });

  document.getElementById("refresh").onclick = refresh;
}());
</script>
</body>
</html>
`.trim();
