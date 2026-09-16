import { inlineModeInstruction, inlineModeLabel, parseInlineMode } from "./inline-mode";
import { chatWithInlineFallback } from "./providers";
import { answerTelegramInlineQuery, TELEGRAM_MESSAGE_MAX_CHARS } from "./telegram";
import type {
  DurableObjectStateLike,
  Env,
  TelegramInlineQuery,
  TelegramInlineQueryResultArticle,
} from "./types";

const STATE_KEY = "latest-inline-query";
const INLINE_QUERY_MAX_CHARS = 256;
const INLINE_DEBOUNCE_MS = 700;

type InlineWork = {
  updateId: number;
  query: TelegramInlineQuery;
};

function validInlineWork(value: unknown): value is InlineWork {
  if (!value || typeof value !== "object") return false;
  const work = value as Record<string, unknown>;
  const query = work.query as Record<string, unknown> | undefined;
  return typeof work.updateId === "number" && Number.isInteger(work.updateId) &&
    Boolean(query) && typeof query?.id === "string" && typeof query?.query === "string" &&
    typeof (query?.from as Record<string, unknown> | undefined)?.id === "number";
}

function openBotButton() {
  return { text: "Otwórz Botka", start_parameter: "inline-help" };
}

export class TelegramInlineQueryGate {
  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/enqueue") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    const work = await request.json();
    if (!validInlineWork(work)) return Response.json({ error: "invalid_query" }, { status: 400 });

    const inline = work.query;
    if (!this.env.OWNER_TELEGRAM_USER_ID || String(inline.from.id) !== this.env.OWNER_TELEGRAM_USER_ID) {
      await answerTelegramInlineQuery(this.env, inline.id, []).catch((error) => {
        console.warn("Telegram non-owner inline query rejection failed", error);
      });
      return Response.json({ accepted: false });
    }

    if (!inline.query.trim()) {
      await this.state.storage.deleteAll();
      await answerTelegramInlineQuery(this.env, inline.id, [], openBotButton());
      return Response.json({ accepted: true, empty: true });
    }

    await this.state.storage.put(STATE_KEY, work);
    await this.state.storage.setAlarm(Date.now() + INLINE_DEBOUNCE_MS);
    return Response.json({ accepted: true }, { status: 202 });
  }

  async alarm(): Promise<void> {
    const work = await this.state.storage.get<InlineWork>(STATE_KEY);
    if (!work) return;
    const rawQuery = work.query.query.trim().slice(0, INLINE_QUERY_MAX_CHARS);
    if (!rawQuery) return;
    const request = parseInlineMode(rawQuery);
    const query = request.prompt;
    if (!query) {
      await answerTelegramInlineQuery(this.env, work.query.id, [], openBotButton()).catch((error) => {
        console.warn("Telegram empty inline mode response failed", error);
      });
      const afterEmpty = await this.state.storage.get<InlineWork>(STATE_KEY);
      if (afterEmpty?.query.id === work.query.id) await this.state.storage.deleteAll();
      return;
    }

    let answer: string;
    try {
      const result = await chatWithInlineFallback(this.env, [
        {
          role: "system",
          content:
            "You are Botek in Telegram inline mode. The result may be shared in another chat. " +
            "Inline mode is stateless: do not refer to private conversation memory or hidden context. " +
            "Return only useful output, without provider/model footers. Use the query's language unless translation requires another language. " +
            inlineModeInstruction(request.mode),
        },
        { role: "user", content: query },
      ]);
      answer = result.text.trim().slice(0, TELEGRAM_MESSAGE_MAX_CHARS);
    } catch (error) {
      console.error("Telegram inline generation failed", error);
      const current = await this.state.storage.get<InlineWork>(STATE_KEY);
      if (current?.query.id === work.query.id) {
        await answerTelegramInlineQuery(this.env, work.query.id, [], openBotButton()).catch((sendError) => {
          console.warn("Telegram inline failure response failed", sendError);
        });
        const afterFailure = await this.state.storage.get<InlineWork>(STATE_KEY);
        if (afterFailure?.query.id === work.query.id) await this.state.storage.deleteAll();
      }
      return;
    }

    const current = await this.state.storage.get<InlineWork>(STATE_KEY);
    if (current?.query.id !== work.query.id) return;

    const title = request.mode === "ask"
      ? `Botek: ${query}`
      : `${inlineModeLabel(request.mode)} · Botek: ${query}`;
    const article: TelegramInlineQueryResultArticle = {
      type: "article",
      id: `answer-${request.mode}-${work.updateId}`.slice(0, 64),
      title: title.slice(0, 80),
      description: answer.replace(/\s+/gu, " ").slice(0, 160),
      input_message_content: {
        message_text: answer || "Brak odpowiedzi.",
        link_preview_options: { is_disabled: true },
      },
    };
    await answerTelegramInlineQuery(this.env, work.query.id, [article]);

    const afterSend = await this.state.storage.get<InlineWork>(STATE_KEY);
    if (afterSend?.query.id === work.query.id) await this.state.storage.deleteAll();
  }
}
