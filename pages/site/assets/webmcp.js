"use strict";

(() => {
  const context = document.modelContext;
  if (!context?.registerTool) return;

  function currentDestinations() {
    const links = [...document.querySelectorAll(".trvny-nav-link[href]")].slice(0, 32);
    const seen = new Set();
    return links.flatMap((link) => {
      const label = (link.firstChild?.textContent || link.textContent || "").trim();
      if (!label || seen.has(label)) return [];
      seen.add(label);
      return [{ label, url: link.href }];
    });
  }

  const ownerKey = Symbol.for("trfny.hub.webmcp.lifecycle");
  const previous = globalThis[ownerKey];
  if (previous && typeof previous.abort === "function") previous.abort();

  const lifecycle = new AbortController();
  globalThis[ownerKey] = lifecycle;
  const cleanup = () => {
    lifecycle.abort();
    if (globalThis[ownerKey] === lifecycle) delete globalThis[ownerKey];
  };
  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) cleanup();
  }, { signal: lifecycle.signal });

  const tool = {
    name: "open_travny_destination",
    title: "Open a TRAVNY destination",
    description: "Start browser navigation to one destination exposed by the current TRAVNY site menu.",
    inputSchema: {
      type: "object",
      properties: {
        destination: {
          type: "string",
          description: "Exact current menu label from list_travny_destinations.",
        },
      },
      required: ["destination"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input = {}) {
      const destinations = currentDestinations();
      const names = destinations.map(({ label }) => label);
      const destination = input && typeof input === "object" ? input.destination : undefined;
      if (typeof destination !== "string") {
        return { ok: false, error: "destination must be a string.", availableDestinations: names };
      }
      const target = destinations.find(({ label }) => label === destination);
      if (!target) {
        return { ok: false, error: "Unknown destination.", availableDestinations: names };
      }
      window.location.assign(target.url);
      return { ok: true, navigationStarted: true, destination: target.label, url: target.url };
    },
  };


  const readDestinations = {
    name: "list_travny_destinations",
    title: "List TRAVNY destinations",
    description: "Find public projects and services in the current TRAVNY menu without navigating.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", maxLength: 100 } },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute(input = {}) {
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        return { ok: false, error: "input must be an object." };
      }
      const { query = "" } = input;
      if (typeof query !== "string" || query.length > 100) {
        return { ok: false, error: "query must be a string of at most 100 characters." };
      }
      const needle = query.trim().toLowerCase();
      return { ok: true, destinations: currentDestinations().filter(({ label, url }) =>
        (label + " " + url).toLowerCase().includes(needle)) };
    },
  };

  const catalogue = {
    name: "get_travny_agent_resources",
    title: "Get TRAVNY agent resources",
    description: "Discover machine-readable hub guides, publication feed, sitemap and structured project atlas.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute() {
      const base = "https://bartek.lol";
      return { resources: [
        { name: "Concise guide", url: base + "/llms.txt" },
        { name: "Full guide", url: base + "/llms-full.txt" },
        { name: "TRAVNY Radio guide", url: base + "/radio/index.md" },
        { name: "TRAVNY Radio now playing", url: base + "/api/radio-station?station=travny" },
        { name: "Publications", url: base + "/teksty/feed.xml" },
        { name: "Project atlas", url: base + "/teksty/githubowa-kraina/atlas.json" },
        { name: "Sitemap", url: base + "/sitemap.xml" },
      ] };
    },
  };

  const radioNow = {
    name: "get_travny_radio_now",
    title: "Get TRAVNY Radio now playing",
    description: "Read live track metadata and listening links from the fixed TRAVNY Radio hub API.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input = {}) {
      if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) {
        return { ok: false, error: "No input parameters supported." };
      }
      try {
        const response = await fetch("/api/radio-station?station=travny", {
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error("metadata unavailable");
        const current = await response.json();
        if (current.kind !== "track" || typeof current.title !== "string" || !current.title) {
          throw new Error("invalid metadata");
        }
        const str = value => typeof value === "string" ? value.slice(0, 200) : "";
        const cover = str(current.cover);
        return {
          ok: true,
          station: "TRAVNY Radio",
          now: {
            title: str(current.title),
            artist: str(current.artist),
            album: str(current.album),
            cover: /^https:\/\/travny-radio\.taild44c6c\.ts\.net\/artwork\/[a-f0-9]{20}\.(?:jpg|png)$/.test(cover) ? cover : "",
          },
          streamUrl: "https://radio.bartek.lol/radio.mp3",
          playerUrl: "https://bartek.lol/#radio",
          infoUrl: "https://bartek.lol/radio/",
        };
      } catch {
        return { ok: false, error: "Radio metadata temporarily unavailable." };
      }
    },
  };

  for (const definition of [tool, readDestinations, catalogue, radioNow]) {
    try {
      Promise.resolve(context.registerTool(definition, { signal: lifecycle.signal }))
        .catch((error) => console.warn("TRAVNY WebMCP registration failed", error));
    } catch (error) {
      console.warn("TRAVNY WebMCP registration failed", error);
    }
  }
})();
