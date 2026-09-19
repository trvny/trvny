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
    h1, h2 { margin: 0; letter-spacing: -0.02em; }
    h1 { font-size: 26px; line-height: 1.1; font-weight: 750; }
    h2 { font-size: 17px; font-weight: 700; }
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
        <button class="tool-card" type="button" data-tool-url="https://streambench.trfny.com">
          <span class="tool-icon" aria-hidden="true">📻</span>
          <span class="tool-name">Streambench</span>
          <span class="tool-desc">Radio, IPTV, HLS i playlisty</span>
        </button>
        <button class="tool-card" type="button" data-tool-url="https://docbench.travny.workers.dev">
          <span class="tool-icon" aria-hidden="true">📄</span>
          <span class="tool-name">Docbench</span>
          <span class="tool-desc">PDF i dokumenty lokalnie</span>
        </button>
      </div>
    </section>

    <section aria-labelledby="tasks-title">
      <div class="section-head"><h2 id="tasks-title">Ostatnie zadania</h2><span id="task-count" class="muted"></span></div>
      <div id="tasks" class="task-list"><div class="empty">Ładowanie…</div></div>
    </section>
    <footer id="footer">Botek · read-only MVP</footer>
  </main>
  <script>
    const webApp = window.Telegram && window.Telegram.WebApp;
    const refreshButton = document.getElementById("refresh");
    const taskList = document.getElementById("tasks");

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
        taskList.append(card);
      }
    }

    function renderError(message) {
      taskList.replaceChildren(element("div", "error", message));
      setText("task-count", "");
    }
    async function refresh() {
      refreshButton.disabled = true;
      try {
        const initData = webApp && webApp.initData ? webApp.initData : "";
        if (!initData) {
          throw new Error("Otwórz Control Center z menu Botka w Telegramie.");
        }
        const response = await fetch("/mini-app/api/status", {
          method: "GET",
          cache: "no-store",
          headers: { "x-telegram-init-data": initData },
        });
        if (!response.ok) {
          if (response.status === 401) throw new Error("Sesja Telegram wygasła. Zamknij panel i otwórz go ponownie.");
          throw new Error("Backend Control Center jest chwilowo niedostępny.");
        }
        const data = await response.json();
        renderLegion(data.legion || {});
        renderTasks(data.tasks || []);
        setText("footer", "Odświeżono: " + new Date().toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" }));
        if (webApp && webApp.HapticFeedback) webApp.HapticFeedback.impactOccurred("light");
      } catch (error) {
        renderError(error instanceof Error ? error.message : "Nie udało się pobrać danych.");
      } finally {
        refreshButton.disabled = false;
      }
    }
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
