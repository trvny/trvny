// Private reads of known public JSON endpoints. Preserve the existing 5m cache
// when a service binding bypasses the upstream hostname's edge cache.
import { SHITPOST_FEED_URL } from "./shitpost.js";

export const WEATHER_STATE_URL = "https://weather.travny.workers.dev/state.json";
const CACHE_TTL = 300;
const CACHED_AT = "x-travny-cached-at";
const SOURCES = {
  WEATHER_SERVICE: WEATHER_STATE_URL,
  REACTOR_SERVICE: SHITPOST_FEED_URL,
};

export function serviceFetch(context, name, fetchImpl = fetch) {
  const binding = context?.env?.[name];
  return async (url, init = {}) => {
    if (!binding || SOURCES[name] !== String(url) || (init.method ?? "GET").toUpperCase() !== "GET") return fetchImpl(url, init);

    let cache, key;
    try {
      cache = await globalThis.caches?.open("hub-public-json-v1");
      if (cache) {
        key = new Request("https://travny.pages.dev/__hub-cache/" + name);
        const hit = await cache.match(key);
        if (hit) {
          const stored = Number(hit.headers.get(CACHED_AT));
          const age = Date.now() - stored;
          if (stored > 0 && age >= 0 && age < CACHE_TTL * 1000) return hit;
          await hit.body?.cancel();
        }
      }
    } catch (error) {
      console.warn("hub_cache_unavailable", name, error instanceof Error ? error.name : "unknown");
      cache = undefined;
    }

    let response;
    try {
      const bindingInit = { ...init };
      delete bindingInit.cf; // Public-origin cache options; bound reads use the named cache.
      response = await binding.fetch(url, bindingInit);
    } catch (error) {
      if (init.signal?.aborted) throw error;
      console.warn("hub_service_binding_unavailable", name, error instanceof Error ? error.name : "unknown");
      return fetchImpl(url, init);
    }

    if (response.status === 200 && cache && key) {
      const copy = response.clone();
      const headers = new Headers(copy.headers);
      headers.delete("age");
      headers.delete("expires");
      headers.set("date", new Date().toUTCString());
      headers.set(CACHED_AT, String(Date.now()));
      headers.set("cache-control", "public, max-age=" + CACHE_TTL);
      const task = cache.put(key, new Response(copy.body, {
        status: copy.status, headers,
      })).catch(error => {
        console.warn("hub_cache_write_failed", name, error instanceof Error ? error.name : "unknown");
      });
      if (typeof context.waitUntil === "function") context.waitUntil(task);
      else await task;
    }
    return response;
  };
}
