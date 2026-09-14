import type {
  ChatMessage,
  DurableObjectStateLike,
  TelegramConversationHistory,
  TelegramConversationTurn,
  TelegramMemoryTurn,
} from "./types";

const STATE_KEY = "conversation";
const MAX_STORED_TURNS = 8;
const MAX_CONTEXT_CHARS = 8_000;

type ConversationState = {
  turns: TelegramConversationTurn[];
  generation?: number;
  updatedAt: string;
};

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

function currentGeneration(state: ConversationState | undefined): number {
  return state?.generation ?? 0;
}

function validTurn(value: unknown): value is TelegramMemoryTurn {
  if (!value || typeof value !== "object") return false;
  const turn = value as Record<string, unknown>;
  return typeof turn.user === "string" && turn.user.length > 0 && turn.user.length <= 4096 &&
    typeof turn.assistant === "string" && turn.assistant.length > 0 && turn.assistant.length <= 4096 &&
    typeof turn.generation === "number" && Number.isInteger(turn.generation) && turn.generation >= 0;
}

export class TelegramConversationMemory {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const current = await this.state.storage.get<ConversationState>(STATE_KEY);

    if (request.method === "GET" && url.pathname === "/history") {
      return json({
        turns: current?.turns ?? [],
        generation: currentGeneration(current),
      } satisfies TelegramConversationHistory);
    }
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    if (url.pathname === "/clear") {
      const now = new Date().toISOString();
      const next: ConversationState = {
        turns: [],
        generation: currentGeneration(current) + 1,
        updatedAt: now,
      };
      await this.state.storage.put(STATE_KEY, next);
      return json({ ok: true, generation: next.generation });
    }

    if (url.pathname === "/append") {
      const payload = await request.json();
      if (!validTurn(payload)) return json({ error: "invalid_turn" }, 400);
      if (payload.generation !== currentGeneration(current)) {
        return json({ error: "stale_generation" }, 409);
      }
      const { generation: _generation, ...remembered } = payload;
      const turn: TelegramConversationTurn = { ...remembered, createdAt: new Date().toISOString() };
      const turns = [...(current?.turns ?? []), turn].slice(-MAX_STORED_TURNS);
      await this.state.storage.put(STATE_KEY, {
        turns,
        generation: currentGeneration(current),
        updatedAt: turn.createdAt,
      } satisfies ConversationState);
      return json({ ok: true, turns: turns.length }, 201);
    }

    return json({ error: "not_found" }, 404);
  }
}

export function conversationMessages(turns: TelegramConversationTurn[]): ChatMessage[] {
  const selected: TelegramConversationTurn[] = [];
  let chars = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const turnChars = turn.user.length + turn.assistant.length;
    if (selected.length > 0 && chars + turnChars > MAX_CONTEXT_CHARS) break;
    selected.push(turn);
    chars += turnChars;
  }

  return selected.reverse().flatMap((turn) => [
    { role: "user" as const, content: turn.user },
    { role: "assistant" as const, content: turn.assistant },
  ]);
}
