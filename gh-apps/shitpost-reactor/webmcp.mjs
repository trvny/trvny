export const WEBMCP_SCRIPT = String.raw`"use strict";
(() => {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const key = Symbol.for("trfny.reactor.webmcp");
  globalThis[key]?.abort();
  const lifecycle = new AbortController();
  globalThis[key] = lifecycle;
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) {
      lifecycle.abort();
      if (globalThis[key] === lifecycle) delete globalThis[key];
    }
  }, { signal: lifecycle.signal });

  const tool = {
    name: "read_reactor_posts",
    title: "Read latest Reactor posts",
    description: "Read recent automatically generated satire from the public Reactor feed. Not verified reporting.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 5, default: 3 } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute({ limit = 3 } = {}, { signal } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 5) {
        return { ok: false, error: "limit must be an integer from 1 to 5." };
      }
      const response = await fetch("/feed.json", { signal, headers: { accept: "application/json" } });
      if (!response.ok) return { ok: false, error: "Feed unavailable.", status: response.status };
      const feed = await response.json();
      return {
        ok: true,
        items: (feed.items || []).slice(0, limit).map(({ title, url, summary, date_published }) => ({
          title: String(title || "").slice(0, 150),
          url,
          summary: String(summary || "").slice(0, 240),
          date_published,
        })),
      };
    },
  };
  try {
    Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal }))
      .catch(error => console.warn("Reactor WebMCP registration failed", error));
  } catch (error) {
    console.warn("Reactor WebMCP registration failed", error);
  }
})();
`;
