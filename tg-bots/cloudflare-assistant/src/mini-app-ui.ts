import { DOC_STUDIO_CSS, DOC_STUDIO_HTML, DOC_STUDIO_SCRIPT } from "./mini-app-doc-ui.ts";

const MINI_APP_HTML = `<!doctype html>
<html lang="pl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light dark">
  <title>Botek Control Center</title>
  <script src="https://telegram.org/js/telegram-web-app.js?63"></script>
  <style>
    :root {
      color-scheme: light dark;
      --bg: var(--tg-theme-bg-color, #ffffff);
      --surface: var(--tg-theme-secondary-bg-color, #f2f3f5);
      --text: var(--tg-theme-text-color, #111111);
      --muted: var(--tg-theme-hint-color, #707579);
      --accent: var(--tg-theme-button-color, #2481cc);
      --accent-text: var(--tg-theme-button-text-color, #ffffff);
      --line: color-mix(in srgb, var(--text) 12%, transparent);
      --ok: #31b545;
      --warn: #e35d6a;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .app {
      width: min(100%, 760px);
      margin: 0 auto;
      padding: max(18px, env(safe-area-inset-top)) 16px max(28px, env(safe-area-inset-bottom));
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 22px;
    }
    h1, h2, h3 { margin: 0; letter-spacing: -0.02em; }
    h1 { font-size: 26px; line-height: 1.1; font-weight: 750; }
    h2 { font-size: 17px; font-weight: 700; }
    h3 { font-size: 14px; font-weight: 650; }
    .section-head.nested { margin-top: 16px; }
    button {
      border: 0;
      border-radius: 12px;
      padding: 10px 14px;
      background: var(--accent);
      color: var(--accent-text);
      font: inherit;
      font-weight: 650;
      cursor: pointer;
    }
    button:disabled { opacity: .55; cursor: default; }
    button.danger { background: var(--warn); color: #fff; }
    section { margin-top: 22px; }
    .section-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 10px;
    }
    .muted { color: var(--muted); }
    .status-line { display: flex; align-items: center; gap: 8px; font-weight: 650; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); }
    .dot.ok { background: var(--ok); }
    .dot.bad { background: var(--warn); }
    .summary {
      padding: 16px;
      border-radius: 18px;
      background: var(--surface);
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1px;
      margin: 16px 0;
      overflow: hidden;
      border-radius: 14px;
      background: var(--line);
    }
    .metric { background: var(--bg); padding: 14px; }
    .metric strong { display: block; font-size: 22px; line-height: 1.1; }
    .metric span { color: var(--muted); font-size: 12px; }
    .rows { display: grid; gap: 10px; }
    .row { display: grid; grid-template-columns: 110px 1fr; gap: 12px; min-width: 0; }
    .row > span:first-child { color: var(--muted); }
    .list { overflow-wrap: anywhere; }
    .tool-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }
    .tool-card {
      min-width: 0;
      padding: 16px;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: var(--surface);
      color: var(--text);
      text-align: left;
    }
    .tool-icon { display: block; margin-bottom: 12px; font-size: 24px; line-height: 1; }
    .tool-name { display: block; font-weight: 750; }
    .tool-desc { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; font-weight: 500; }
    .radio-panel {
      padding: 18px;
      border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--line));
      border-radius: 18px;
      background: var(--surface);
    }
    .radio-panel[hidden], .radio-art img[hidden] { display: none; }
    .radio-top, .radio-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .radio-live { color: var(--ok); font-size: 11px; font-weight: 800; letter-spacing: .12em; }
    .radio-live::before { content: ""; display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 50%; background: currentColor; }
    .radio-now { display: flex; gap: 16px; align-items: center; margin: 18px 0; }
    .radio-art {
      position: relative;
      flex: 0 0 106px;
      width: 106px;
      aspect-ratio: 1;
      overflow: hidden;
      display: grid;
      place-items: center;
      border-radius: 14px;
      background: linear-gradient(135deg, #3b2158, #102d42);
      color: #f8e889;
      font-size: 40px;
    }
    .radio-art img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .radio-track { min-width: 0; overflow-wrap: anywhere; }
    .radio-track strong { display: block; font-size: 19px; line-height: 1.2; }
    .radio-track span { display: block; margin-top: 4px; }
    .radio-controls { display: flex; gap: 14px; align-items: center; }
    .radio-controls button { flex: 0 0 auto; }
    .radio-volume { display: grid; gap: 4px; flex: 1; font-size: 12px; color: var(--muted); }
    .radio-volume input { width: 100%; min-width: 0; accent-color: var(--accent); }
    .radio-status { margin: 10px 0 0; font-size: 13px; }
    .radio-actions { margin-top: 14px; font-size: 12px; }
    .radio-actions a { color: var(--accent); }
    @media (max-width: 420px) {
      .radio-now { gap: 12px; }
      .radio-art { width: 82px; flex-basis: 82px; }
      .radio-track strong { font-size: 17px; }
    }
    ${DOC_STUDIO_CSS}
    .task-list { display: grid; gap: 1px; border-radius: 18px; overflow: hidden; background: var(--line); }
    .task { padding: 14px 16px; background: var(--surface); }
    .task-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
    .task-id { font: 12px/1.3 ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
    .badge {
      flex: 0 0 auto;
      padding: 4px 8px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--accent) 14%, transparent);
      color: var(--text);
      font-size: 11px;
      font-weight: 750;
      text-transform: uppercase;
      letter-spacing: .04em;
    }
    .task p { margin: 8px 0 0; overflow-wrap: anywhere; }
    .task-meta { margin-top: 6px; color: var(--muted); font-size: 12px; }
    .task-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
    .task-actions button { padding: 7px 11px; font-size: 12px; }
    .empty, .error { padding: 20px 16px; text-align: center; color: var(--muted); background: var(--surface); }
    .error { color: var(--warn); }
    footer { margin-top: 18px; color: var(--muted); font-size: 12px; text-align: center; }
    @media (max-width: 560px) {
      .tool-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 420px) {
      .app { padding-left: 12px; padding-right: 12px; }
      h1 { font-size: 23px; }
      .row { grid-template-columns: 90px 1fr; }
    }
    @media (prefers-reduced-motion: no-preference) {
      button { transition: transform 120ms ease, opacity 120ms ease; }
      button:active { transform: scale(.97); }
    }
  </style>
</head>
<body>
  <main class="app">
    <header>
      <h1>Control Center</h1>
      <button id="refresh" type="button">Odśwież</button>
    </header>

    <section aria-labelledby="legion-title">
      <div class="section-head">
        <h2 id="legion-title">Legion</h2>
        <div class="status-line"><span id="state-dot" class="dot"></span><span id="state">Ładowanie…</span></div>
      </div>
      <div class="summary">
        <div id="updated" class="muted">Czekam na dane z Pet Dispatchera…</div>
        <div class="metrics">
          <div class="metric"><strong id="sessions">–</strong><span>aktywne sesje</span></div>
          <div class="metric"><strong id="processes">–</strong><span>aktywne procesy</span></div>
        </div>
        <div class="rows">
          <div class="row"><span>Repo</span><div id="repos" class="list">–</div></div>
          <div class="row"><span>Workspace</span><div id="workspaces" class="list">–</div></div>
          <div class="row"><span>Sandbox</span><div id="sandbox" class="list">–</div></div>
        </div>
      </div>
    </section>

    <section aria-labelledby="benches-title">
      <div class="section-head">
        <h2 id="benches-title">Benches</h2>
        <span class="muted">narzędzia</span>
      </div>
      <div class="tool-grid">
        <button class="tool-card" type="button" data-tool-url="https://codebench.trfny.com">
          <span class="tool-icon" aria-hidden="true">🔳</span>
          <span class="tool-name">Codebench</span>
          <span class="tool-desc">QR i kody kreskowe</span>
        </button>
        <button class="tool-card" type="button" data-radio-open aria-controls="radio-player" aria-expanded="false">
          <span class="tool-icon" aria-hidden="true">📻</span>
          <span class="tool-name">Radio · Streambench</span>
          <span class="tool-desc">Radio Paradise live, right inside Botek</span>
        </button>
        <button class="tool-card" id="doc-open" type="button" aria-controls="doc-studio" aria-expanded="false">
          <span class="tool-icon" aria-hidden="true">📄</span>
          <span class="tool-name">Docbench</span>
          <span class="tool-desc">Create, preview, export and send a draft</span>
        </button>
      </div>
    </section>

    <section id="radio-player" class="radio-panel" aria-labelledby="radio-title" hidden>
      <div class="radio-top">
        <h2 id="radio-title">Radio Paradise · Main Mix</h2>
        <span class="radio-live">LIVE</span>
      </div>
      <div class="radio-now">
        <div class="radio-art" aria-hidden="true">
          <span>📻</span>
          <img id="radio-cover" alt="" hidden>
        </div>
        <div class="radio-track" aria-live="polite">
          <strong id="radio-track-title">Radio Paradise</strong>
          <span id="radio-artist">Main Mix · live stream</span>
          <span id="radio-album" class="muted"></span>
        </div>
      </div>
      <audio id="radio-audio" controls preload="none" src="https://stream.radioparadise.com/aac-320">
        Your browser cannot play this station.
      </audio>
      <div class="radio-controls">
        <button id="radio-toggle" type="button" aria-pressed="false">▶ Play</button>
        <label id="radio-volume-label" class="radio-volume">Volume
          <input id="radio-volume" type="range" min="0" max="1" step="0.05" value="0.8" aria-label="Radio volume">
        </label>
      </div>
      <p id="radio-volume-note" class="radio-status muted" hidden>Use device volume buttons on iOS.</p>
      <p id="radio-status" class="radio-status muted" role="status">Ready to play · tap Play to start</p>
      <div class="radio-actions">
        <span id="radio-checked" class="muted">Track metadata not loaded</span>
        <a href="https://streambench.travny.workers.dev/" target="_blank" rel="noopener noreferrer">More stations</a>
      </div>
    </section>

    ${DOC_STUDIO_HTML}

    <section aria-labelledby="tasks-title">
      <div class="section-head"><h2 id="tasks-title">Ostatnie zadania</h2><span id="task-count" class="muted"></span></div>
      <div id="tasks" class="task-list"><div class="empty">Ładowanie…</div></div>
    </section>

    <section lang="en" aria-labelledby="watchtower-title">
      <div class="section-head"><h2 id="watchtower-title">Watchtower</h2><span class="muted">Automations</span></div>
      <div class="section-head"><h3>Reminders</h3><span id="reminder-count" class="muted"></span></div>
      <div id="reminders" class="task-list" aria-live="polite"><div class="empty">Loading…</div></div>
      <div class="section-head nested"><h3>Watches</h3><span id="watch-count" class="muted"></span></div>
      <div id="watches" class="task-list" aria-live="polite"><div class="empty">Loading…</div></div>
    </section>
    <footer id="footer">Botek · Control Center</footer>
  </main>
  <script>
    const webApp = window.Telegram && window.Telegram.WebApp;
    const refreshButton = document.getElementById("refresh");
    const taskList = document.getElementById("tasks");
    const reminderList = document.getElementById("reminders");
    const watchList = document.getElementById("watches");

    function setText(id, value) {
      document.getElementById(id).textContent = value;
    }

    function formatDate(value) {
      if (!value) return "brak danych";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" });
    }

    function joinList(value) {
      return Array.isArray(value) && value.length ? value.join(", ") : "brak";
    }

    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }
    function renderLegion(meta) {
      const stale = Boolean(meta && meta.stale);
      const dot = document.getElementById("state-dot");
      dot.className = "dot " + (stale ? "bad" : "ok");
      setText("state", stale ? "offline / stale" : "online");
      setText("updated", "Ostatni raport: " + formatDate(meta && meta.updatedAt));
      setText("sessions", String(meta && Number.isFinite(meta.activeSessions) ? meta.activeSessions : 0));
      setText("processes", String(meta && Number.isFinite(meta.activeProcesses) ? meta.activeProcesses : 0));
      setText("repos", joinList(meta && meta.repositories));
      setText("workspaces", joinList(meta && meta.workspaces));
      const sandbox = meta && meta.sandbox;
      const sandboxText = sandbox
        ? [sandbox.supported ? "wspierany" : "brak", sandbox.processGuard, sandbox.networkDefault].filter(Boolean).join(" · ")
        : "brak danych";
      setText("sandbox", sandboxText);
    }

    function taskSummary(task) {
      const result = task && task.result;
      if (result && result.error) return result.error;
      if (result && result.summary) return result.summary;
      return "Zadanie nie ma jeszcze wyniku.";
    }
    function renderTasks(tasks) {
      taskList.replaceChildren();
      const items = Array.isArray(tasks) ? tasks : [];
      setText("task-count", items.length ? String(items.length) : "");
      if (!items.length) {
        taskList.append(element("div", "empty", "Brak ostatnich zadań."));
        return;
      }
      for (const task of items) {
        const card = element("article", "task");
        const head = element("div", "task-head");
        const id = element("div", "task-id", String(task.taskId || "nieznane ID"));
        const badge = element("span", "badge", String(task.status || "unknown"));
        head.append(id, badge);
        const summary = element("p", "", taskSummary(task));
        const meta = element(
          "div",
          "task-meta",
          "Aktualizacja: " + formatDate(task.updatedAt || task.createdAt),
        );
        card.append(head, summary, meta);
        const status = String(task.status || "");
        if (task.taskId && ["queued", "leased", "running"].includes(status)) {
          const actions = element("div", "task-actions");
          const cancel = element("button", "danger", "Anuluj");
          cancel.type = "button";
          cancel.addEventListener("click", () => cancelTask(String(task.taskId), cancel));
          actions.append(cancel);
          card.append(actions);
        }
        taskList.append(card);
      }
    }

    function renderError(message) {
      taskList.replaceChildren(element("div", "error", message));
      setText("task-count", "");
    }

    function renderAutomationRows(container, items, kind) {
      container.replaceChildren();
      const countId = kind === "reminders" ? "reminder-count" : "watch-count";
      if (!Array.isArray(items)) {
        setText(countId, "");
        container.append(element("div", "error", kind === "reminders" ? "Reminders unavailable." : "Watches unavailable."));
        return;
      }
      const records = items;
      setText(countId, records.length ? String(records.length) : "");
      if (!records.length) {
        container.append(element("div", "empty", kind === "reminders" ? "No active reminders." : "No active watches."));
        return;
      }
      for (const item of records) {
        const card = element("article", "task");
        const head = element("div", "task-head");
        const badgeText = kind === "reminders" ? String(item.state || "") : [item.kind, item.status].filter(Boolean).join(" · ");
        head.append(element("div", "task-id", String(item.id || "")), element("span", "badge", badgeText));
        const description = element("p", "", String(kind === "reminders" ? item.text || "" : item.target || ""));
        const meta = element("div", "task-meta", (kind === "reminders" ? "Due: " : "Next check: ") + formatDate(kind === "reminders" ? item.dueAt : item.nextCheckAt));
        const actions = element("div", "task-actions");
        const cancel = element("button", "danger", "Cancel");
        cancel.type = "button";
        cancel.addEventListener("click", () => cancelAutomation(kind, String(item.id), cancel));
        actions.append(cancel);
        card.append(head, description, meta, actions);
        container.append(card);
      }
    }

    function renderAutomationError(message) {
      reminderList.replaceChildren(element("div", "error", message));
      watchList.replaceChildren(element("div", "error", message));
      setText("reminder-count", "");
      setText("watch-count", "");
    }

    async function confirmCancel(message = "Anulować to zadanie?") {
      if (webApp && webApp.showConfirm) {
        return new Promise((resolve) => webApp.showConfirm(message, resolve));
      }
      return window.confirm(message);
    }

    async function cancelTask(taskId, button) {
      if (!(await confirmCancel())) return;
      button.disabled = true;
      try {
        const initData = webApp && webApp.initData ? webApp.initData : "";
        if (!initData) throw new Error("Sesja Telegram jest niedostępna.");
        const response = await fetch("/mini-app/api/tasks/" + encodeURIComponent(taskId) + "/cancel", {
          method: "POST",
          cache: "no-store",
          headers: { "x-telegram-init-data": initData },
        });
        if (!response.ok) {
          if (response.status === 401) throw new Error("Sesja Telegram wygasła. Otwórz panel ponownie.");
          throw new Error("Nie udało się anulować zadania.");
        }
        if (webApp && webApp.HapticFeedback) webApp.HapticFeedback.notificationOccurred("success");
        await refresh();
      } catch (error) {
        if (webApp && webApp.showAlert) {
          webApp.showAlert(error instanceof Error ? error.message : "Nie udało się anulować zadania.");
        }
        button.disabled = false;
      }
    }

    let refreshSequence = 0;

    async function cancelAutomation(kind, id, button) {
      if (!(await confirmCancel("Cancel this automation?"))) return;
      button.disabled = true;
      ++refreshSequence;
      try {
        const initData = webApp && webApp.initData ? webApp.initData : "";
        if (!initData) throw new Error("Telegram session is unavailable.");
        const response = await fetch("/mini-app/api/automations/" + kind + "/" + encodeURIComponent(id) + "/cancel", {
          method: "POST",
          cache: "no-store",
          headers: { "x-telegram-init-data": initData },
        });
        if (!response.ok && response.status !== 404) {
          throw new Error(response.status === 401 ? "Telegram session expired. Reopen this panel." : "Could not cancel the automation.");
        }
        if (response.ok) {
          const result = await response.json();
          if (webApp && webApp.HapticFeedback) webApp.HapticFeedback.notificationOccurred("success");
          if (result.deliveryStarted === true && webApp && webApp.showAlert) {
            webApp.showAlert("Removed, but Telegram delivery already started. One final message may arrive.");
          }
        }
        await refresh();
      } catch (error) {
        if (webApp && webApp.showAlert) webApp.showAlert(error instanceof Error ? error.message : "Cancellation failed.");
        button.disabled = false;
        void refresh();
      }
    }

    async function refresh() {
      const sequence = ++refreshSequence;
      refreshButton.disabled = true;
      const initData = webApp && webApp.initData ? webApp.initData : "";
      if (!initData) {
        renderError("Open Control Center from the Botek menu in Telegram.");
        renderAutomationError("Telegram session is unavailable.");
        refreshButton.disabled = false;
        return;
      }

      void (async () => {
        try {
          const response = await fetch("/mini-app/api/status", {
            method: "GET",
            cache: "no-store",
            headers: { "x-telegram-init-data": initData },
          });
          if (!response.ok) {
            if (response.status === 401) throw new Error("Telegram session expired. Reopen this panel.");
            throw new Error("Control Center backend is temporarily unavailable.");
          }
          const data = await response.json();
          if (sequence !== refreshSequence) return;
          renderLegion(data.legion || {});
          renderTasks(data.tasks || []);
        } catch (error) {
          if (sequence === refreshSequence) renderError(error instanceof Error ? error.message : "Could not load tasks.");
        }
      })();

      try {
        const response = await fetch("/mini-app/api/automations", {
          method: "GET",
          cache: "no-store",
          headers: { "x-telegram-init-data": initData },
        });
        if (!response.ok) throw new Error(response.status === 401 ? "Telegram session expired. Reopen this panel." : "Watchtower is temporarily unavailable.");
        const automations = await response.json();
        if (sequence !== refreshSequence) return;
        renderAutomationRows(reminderList, automations.reminders, "reminders");
        renderAutomationRows(watchList, automations.watches, "watches");
      } catch (error) {
        if (sequence === refreshSequence) renderAutomationError(error instanceof Error ? error.message : "Could not load automations.");
      } finally {
        if (sequence === refreshSequence) {
          setText("footer", "Updated: " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
          if (webApp && webApp.HapticFeedback) webApp.HapticFeedback.impactOccurred("light");
          refreshButton.disabled = false;
        }
      }
    }
    ${DOC_STUDIO_SCRIPT}
    const radioPanel = document.getElementById("radio-player");
    const radioOpenButton = document.querySelector ? document.querySelector("[data-radio-open]") : null;
    const radioAudio = document.getElementById("radio-audio");
    const radioToggle = document.getElementById("radio-toggle");
    const radioVolume = document.getElementById("radio-volume");
    const radioCover = document.getElementById("radio-cover");
    const radioStream = "https://stream.radioparadise.com/aac-320";
    let radioOpened = false;
    let radioWantsPlaying = false;
    let radioAttempt = 0;
    let radioTimer = null;
    let radioFetching = false;

    function radioPlayback(playing, message) {
      radioToggle.textContent = playing ? "⏸ Pause" : "▶ Play";
      radioToggle.setAttribute("aria-pressed", String(playing));
      setText("radio-status", message);
    }

    function stopRadio() {
      radioWantsPlaying = false;
      radioAttempt += 1;
      radioAudio.pause();
      radioAudio.removeAttribute("src");
      radioAudio.load();
      radioPlayback(false, "Paused");
    }

    async function startRadio() {
      radioWantsPlaying = true;
      const attempt = ++radioAttempt;
      radioAudio.src = radioStream;
      radioPlayback(true, "Connecting…");
      try {
        await radioAudio.play();
      } catch {
        if (radioWantsPlaying && attempt === radioAttempt) {
          radioWantsPlaying = false;
          radioPlayback(false, "Cannot start playback. Tap Play to retry.");
        }
      }
    }

    function radioUnavailable() {
      setText("radio-track-title", "Radio Paradise");
      setText("radio-artist", "Track details unavailable");
      setText("radio-album", "");
      setText("radio-checked", "Metadata unavailable · audio may still work");
      radioCover.hidden = true;
      radioCover.removeAttribute("src");
    }

    async function refreshRadio() {
      if (!radioOpened || document.hidden || radioFetching) return;
      radioFetching = true;
      const requestController = new AbortController();
      const requestTimer = setTimeout(() => requestController.abort(), 8_000);
      try {
        const response = await fetch("https://travny.pages.dev/api/radio-now", {
          cache: "no-store", signal: requestController.signal,
        });
        if (!response.ok) throw new Error("metadata unavailable");
        const track = await response.json();
        if (!track || typeof track.title !== "string" || typeof track.artist !== "string") {
          throw new Error("invalid metadata");
        }
        setText("radio-track-title", track.title);
        setText("radio-artist", track.artist);
        setText("radio-album", typeof track.album === "string" ? track.album : "");
        const checkedAt = new Date(track.checkedAt);
        setText("radio-checked", "Metadata checked: " + (Number.isNaN(checkedAt.getTime())
          ? "just now" : checkedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })));
        if (track.cover) {
          radioCover.src = track.cover;
          radioCover.hidden = false;
        } else {
          radioCover.hidden = true;
          radioCover.removeAttribute("src");
        }
      } catch {
        radioUnavailable();
      } finally {
        clearTimeout(requestTimer);
        radioFetching = false;
        clearTimeout(radioTimer);
        if (radioOpened && !document.hidden) radioTimer = setTimeout(refreshRadio, 30000);
      }
    }

    function openRadio() {
      radioOpened = true;
      radioPanel.hidden = false;
      if (radioOpenButton) radioOpenButton.setAttribute("aria-expanded", "true");
      radioPanel.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
      void refreshRadio();
    }

    radioAudio.hidden = true;
    radioAudio.volume = Number(radioVolume.value);
    if (webApp && webApp.platform === "ios") {
      document.getElementById("radio-volume-label").hidden = true;
      document.getElementById("radio-volume-note").hidden = false;
    }
    radioToggle.addEventListener("click", () => {
      if (radioWantsPlaying) stopRadio(); else void startRadio();
    });
    radioVolume.addEventListener("input", () => { radioAudio.volume = Number(radioVolume.value); });
    radioAudio.addEventListener("playing", () => {
      if (radioWantsPlaying) radioPlayback(true, "Playing live");
    });
    radioAudio.addEventListener("waiting", () => {
      if (radioWantsPlaying) radioPlayback(true, "Buffering…");
    });
    radioAudio.addEventListener("pause", () => {
      if (radioWantsPlaying && radioAudio.paused) {
        radioWantsPlaying = false;
        radioAttempt += 1;
        radioPlayback(false, "Paused");
      }
    });
    radioAudio.addEventListener("error", () => {
      // Old-source errors must not cancel a fresh playback attempt.
      if (radioWantsPlaying && radioAudio.error) {
        radioWantsPlaying = false;
        radioAttempt += 1;
        radioPlayback(false, "Stream unavailable. Tap Play to retry.");
      }
    });
    radioCover.addEventListener("error", () => {
      radioCover.hidden = true;
      radioCover.removeAttribute("src");
    });
    if (radioOpenButton) radioOpenButton.addEventListener("click", openRadio);
    document.addEventListener?.("visibilitychange", () => {
      clearTimeout(radioTimer);
      if (!document.hidden) void refreshRadio();
    });
    window.addEventListener?.("pagehide", () => {
      clearTimeout(radioTimer);
      if (radioWantsPlaying) stopRadio();
    });
    if (window.location && new URLSearchParams(window.location.search).get("tab") === "radio") openRadio();

    if (webApp) {
      webApp.ready();
      webApp.expand();
      if (webApp.setHeaderColor) webApp.setHeaderColor("bg_color");
      if (webApp.setBackgroundColor) webApp.setBackgroundColor("bg_color");
    }
    for (const card of document.querySelectorAll("[data-tool-url]")) {
      card.addEventListener("click", () => {
        const url = card.getAttribute("data-tool-url");
        if (!url) return;
        if (webApp && webApp.openLink) {
          webApp.openLink(url);
        } else {
          window.open(url, "_blank", "noopener,noreferrer");
        }
      });
    }
    refreshButton.addEventListener("click", refresh);
    refresh();
  </script>
</body>
</html>`;

export function miniAppHtmlResponse(): Response {
  return new Response(MINI_APP_HTML, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}
