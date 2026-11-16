// Private reads of known public JSON endpoints. Preserve the existing 5m cache
// when a service binding bypasses the upstream hostname's edge cache.
import { SHITPOST_FEED_URL } from "./shitpost.js";

export const WEATHER_STATE_URL = "https://weather.travny.workers.dev/state.json";
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
        if (hit) return hit;
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
      headers.set("cache-control", "public, max-age=300");
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
