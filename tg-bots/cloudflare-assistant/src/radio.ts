import type { Env, TelegramReply } from "./types";

const RADIO_NOW_URL = "https://travny.pages.dev/api/radio-now";
const METADATA_MAX_BYTES = 8 * 1024;
const MAX_TEXT = 200;
const COVER_HOST = "img.radioparadise.com";

export type RadioTrack = {
  title: string;
  artist: string;
  album: string;
  cover: string;
  checkedAt: string;
};

function compactText(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : "";
}

function safeCover(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === COVER_HOST &&
      !url.username && !url.password && !url.port &&
      url.pathname.startsWith("/covers/") && !url.search && !url.hash ? url.href : "";
  } catch {
    return "";
  }
}

// Fixed Pages endpoint owns Radio Paradise upstream normalization.
export async function readRadioTrack(
  fetcher: typeof fetch = (input, init) => fetch(input, init),
  timeoutMs = 6_000,
): Promise<RadioTrack | null> {
  try {
    const response = await fetcher(RADIO_NOW_URL, {
      redirect: "error",
      headers: { "user-agent": "Botek/1.0 (+https://tg-assistant.travny.workers.dev)", accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": 20, "400-599": 0 } },
    } as RequestInit);
    if (!response.ok || !response.body ||
        Number(response.headers.get("content-length") || "0") > METADATA_MAX_BYTES) {
      console.warn("Radio metadata upstream rejected", {
        status: response.status,
        contentType: response.headers.get("content-type"),
        hasBody: Boolean(response.body),
      });
      return null;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > METADATA_MAX_BYTES) {
          console.warn("Radio metadata upstream rejected", { reason: "size_limit", size });
          return null;
        }
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const data = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    const title = compactText(data.title);
    const artist = compactText(data.artist);
    if (!title || !artist) {
      console.warn("Radio metadata upstream rejected", { reason: "missing_track_fields" });
      return null;
    }
    return {
      title, artist,
      album: compactText(data.album),
      cover: safeCover(data.cover),
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.warn("Radio metadata relay error", error instanceof SyntaxError ? "invalid_json" : "relay_failure");
    return null;
  }
}

export async function radioNowResponse(request: Request): Promise<Response> {
  if (request.method !== "GET") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  // The browser follows this fixed redirect. Pages owns metadata and CORS.
  return new Response(null, {
    status: 307,
    headers: { location: RADIO_NOW_URL, "cache-control": "no-store" },
  });
}

export function radioMiniAppUrl(env: Env): string | null {
  try {
    const base = new URL(env.TELEGRAM_WEBHOOK_URL ?? "");
    if (base.protocol !== "https:") return null;
    return new URL("/mini-app?tab=radio", base).toString();
  } catch {
    return null;
  }
}

export async function radioReply(
  env: Env,
  chatId: string | number,
  replyToMessageId: number,
  readTrack: () => Promise<RadioTrack | null> = () => readRadioTrack(undefined, 800),
  chatType = "private",
): Promise<TelegramReply> {
  const track = await readTrack();
  const url = chatType === "private" ? radioMiniAppUrl(env) : null;
  return {
    chatId,
    replyToMessageId,
    text: [
      "📻 Radio Paradise · Main Mix",
      track ? `🎵 ${track.artist} · ${track.title}` : "🎵 Track details unavailable",
      track ? "Metadata checked just now · live stream" : "Live stream · metadata temporarily unavailable",
      "",
      url ? "Tap to open the player. Playback starts after Play." : "Open Botek in a private chat and send /radio to play.",
    ].join("\n"),
    ...(url ? { replyMarkup: { inline_keyboard: [[{
      text: "▶️ Play in Botek",
      web_app: { url },
    }]] } } : {}),
  };
}
