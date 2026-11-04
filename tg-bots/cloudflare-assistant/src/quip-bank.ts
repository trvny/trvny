import type { DurableObjectStateLike, Env } from "./types.ts";

const KEY = "timeless-quip-bank:v1";
const LIMIT = 80;
const MIN_CHARS = 32;
const MAX_CHARS = 220;

export type QuipEntry = {
  text: string;
  provider: string;
  createdAt: string;
};

type BankState = { entries: QuipEntry[] };
export type QuipPick = { text: string; count: number; source: "bank" | "preset" };

export const QUIP_PRESETS: readonly string[] = [
  "Kiedy modele milczą, serwerownia ma chwilę ciszy. Nikt nie podejrzewa, że to naprawdę dobry znak.",
  "Botek zrobił audyt humoru. Wynik: żarty przechodzą testy, ale powaga ma niezaliczone zależności.",
  "Kiedy AI prosi o chwilę namysłu, serwerownia zamawia kawę. Nikt nie pyta, kto za nią płaci.",
  "Na spotkaniu botów najwięcej mówił timeout. Wszyscy zgodnie uznali, że nie wnosi nic nowego.",
  "Administrator wszedł do baru. Barman pyta o hasło. Administrator odpowiada: nie zapisuj tego w logach.",
  "Programista mówi: to działa u mnie. Botek odpowiada: gratuluję, mamy pierwszy udokumentowany cud.",
];

export function reusableQuip(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/gu, " ");
  if (text.length < MIN_CHARS || text.length > MAX_CHARS) return null;
  const forbidden = ["@", "<", ">", "[", "]", "{", "}", "`"];
  if (/\p{N}/u.test(text) ||
      /(?<![.!?])\s\p{Lu}\p{Ll}{2,}/u.test(text) ||
      forbidden.some((char) => text.includes(char)) ||
      /(?:https?:\/\/|www\.|\b(?:dzi[sś]|dzisiaj|jutro|wczoraj|obecnie|aktualnie|właśnie|najnowsz\w*|today|tomorrow|yesterday|currently|latest)\b)/iu.test(text) ||
      /(?:\b(?:chat_id|token|password|apikey|secret)\b|\/\w{2,})/iu.test(text)) return null;
  return text;
}

function validEntries(value: unknown): QuipEntry[] {
  const entries = (value as BankState | undefined)?.entries;
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry): entry is QuipEntry =>
    Boolean(entry && reusableQuip(entry.text) && typeof entry.provider === "string" &&
      entry.provider.length <= 64 && typeof entry.createdAt === "string")
  ).slice(-LIMIT);
}

function randomIndex(length: number): number {
  const nonce = new Uint32Array(1);
  crypto.getRandomValues(nonce);
  return nonce[0] % length;
}

export function presetQuip(): string {
  return QUIP_PRESETS[randomIndex(QUIP_PRESETS.length)];
}

export class TelegramQuipBank {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/pick") {
      const entries = validEntries(await this.state.storage.get<BankState>(KEY));
      const chosen = entries.length ? entries[randomIndex(entries.length)].text : presetQuip();
      return Response.json({
        text: chosen,
        count: entries.length,
        source: entries.length ? "bank" : "preset",
      } satisfies QuipPick);
    }
    if (request.method !== "POST" || url.pathname !== "/remember") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    const input = await request.json() as { text?: unknown; provider?: unknown };
    const text = reusableQuip(input?.text);
    if (!text || typeof input.provider !== "string" ||
        !/^[\w .:/-]{1,64}$/u.test(input.provider)) {
      return Response.json({ error: "invalid_quip" }, { status: 400 });
    }
    const entries = validEntries(await this.state.storage.get<BankState>(KEY));
    const canonical = text.toLocaleLowerCase("pl-PL");
    if (entries.some((entry) => entry.text.toLocaleLowerCase("pl-PL") === canonical)) {
      return Response.json({ stored: false, count: entries.length });
    }
    const next = [...entries, {
      text,
      provider: input.provider,
      createdAt: new Date().toISOString(),
    }].slice(-LIMIT);
    await this.state.storage.put(KEY, { entries: next } satisfies BankState);
    return Response.json({ stored: true, count: next.length });
  }
}

function stub(env: Env) {
  const ns = env.TELEGRAM_QUIP_BANK;
  return ns.get(ns.idFromName("botek-global"));
}

export async function pickBankQuip(env: Env): Promise<QuipPick> {
  const response = await stub(env).fetch("https://quip-bank/pick");
  if (!response.ok) throw new Error("quip bank read failed");
  return await response.json() as QuipPick;
}

export async function rememberBankQuip(
  env: Env, text: string, provider: string,
): Promise<boolean> {
  const response = await stub(env).fetch("https://quip-bank/remember", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, provider }),
  });
  if (!response.ok) return false;
  return (await response.json() as { stored: boolean }).stored;
}
