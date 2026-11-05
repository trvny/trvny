import { chatWithInlineFallback } from "./providers.ts";
import { withDeadline } from "./deadline.ts";
import { feedseekMemeReply } from "./feedseek-briefing.ts";
import { pickBankQuip, presetQuip, rememberBankQuip, reusableQuip } from "./quip-bank.ts";
import type { Env } from "./types.ts";

export type QuickIntent = "hello" | "thanks" | "quip" | "status" | null;

const BANK_READ_TIMEOUT_MS = 1_500;
const BANK_WRITE_TIMEOUT_MS = 1_500;

// Exact, bounded intents only. Never infer an answer to arbitrary questions.
export function quickIntent(input: string): QuickIntent {
  if (input.length > 80) return null;
  const normalized = input.trim().toLocaleLowerCase("pl-PL")
    .normalize("NFD").replace(/\p{M}/gu, "")
    .replace(/[!?.,…]+$/gu, "").trim().replace(/\s+/gu, " ");
  if (["hej", "czesc", "siema", "elo", "hej botek", "czesc botek", "hello", "hi"].includes(normalized)) return "hello";
  if (["dzieki", "dziekuje", "thx", "thanks", "thank you"].includes(normalized)) return "thanks";
  if (["status botka", "jak tam status botka", "status modeli"].includes(normalized)) return "status";
  if ([
    "zart", "dowcip", "opowiedz dowcip", "opowiedz zart",
    "powiedz zart", "rzuc dowcip", "rzuc zart", "daj dowcip",
    "daj zart", "rozsmiesz mnie", "daj przygaduszke",
    "co tam", "powiedz cos smiesznego",
  ].includes(normalized)) return "quip";
  return null;
}

export function staticQuickReply(intent: "hello" | "thanks", input = ""): string {
  const english = /^(?:hello|hi|thanks|thank you|thx)[!?.,…\s]*$/iu.test(input.trim());
  if (intent === "hello") {
    return english
      ? "Hey! 🤖 I've got tools, a memory, and a pretty decent resistance to timeouts. Try /tools."
      : "Siema! 🤖 Mam narzędzia, pamięć i całkiem przyzwoitą odporność na timeouty. /tools pokaże warsztat.";
  }
  return english
    ? "You're welcome. Botek files the token bill in a drawer. 😎"
    : "Nie ma sprawy. Botek odkłada rachunek za tokeny do szuflady. 😎";
}

const QUIP_PROMPT = [
  "Write one timeless Polish one-liner for a Telegram assistant called Botek.",
  "Dry technical humor, gentle sarcasm, clever wording. Mildly edgy, no insults.",
  "Standalone, reusable in any chat with strangers. Do not refer to a user, request, location, recent event, device or private context.",
  "No dates, numbers, time, model names, organizations, external facts, links, @mentions, Markdown, secrets, commands or personal data.",
  "Plain text, 45-180 characters, one line only. Never claim to have performed an action.",
].join(" ");

function shouldGrowBank(count: number): boolean {
  if (count >= 48) return false;
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return random[0] % 6 === 0;
}

export async function quickQuip(
  env: Env,
  allowAi = false,
  shouldGenerate: (count: number) => boolean = shouldGrowBank,
): Promise<string> {
  let pick: Awaited<ReturnType<typeof pickBankQuip>> | null = null;
  try {
    pick = await withDeadline(pickBankQuip(env), BANK_READ_TIMEOUT_MS, "Botek quip bank read");
  } catch (error) {
    console.warn("Botek quip bank read unavailable", error);
  }

  let generationUnavailable = false;
  if (allowAi && pick && shouldGenerate(pick.count)) {
    try {
      const generated = await chatWithInlineFallback(env, [
        { role: "system", content: QUIP_PROMPT },
        { role: "user", content: "Write one standalone, reusable short joke." },
      ]);
      const reusable = reusableQuip(generated.text);
      if (reusable) {
        try {
          await withDeadline(
            rememberBankQuip(env, reusable, generated.provider),
            BANK_WRITE_TIMEOUT_MS,
            "Botek quip bank write",
          );
        } catch (error) {
          console.warn("Botek quip bank persistence unavailable", error);
        }
        return reusable;
      }
    } catch (error) {
      console.warn("Botek quip generation unavailable; using retained text", error);
      generationUnavailable = true;
    }
  }
  if (allowAi && (!pick || (generationUnavailable && pick.source === "preset"))) {
    const fallback = await feedseekMemeReply();
    if (fallback) return fallback;
  }
  return pick?.text ?? presetQuip();
}
