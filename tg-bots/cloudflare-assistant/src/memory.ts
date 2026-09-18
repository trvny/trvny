import type { Env } from "./types";

type JsonObject = Record<string, unknown>;

export type DurableMemoryHit = {
  content: string;
  category?: string;
  score?: number;
};

export type DurableMemoryStatus = {
  configured: boolean;
  reachable: boolean | null;
  error?: string;
};

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid specialist response");
  }
  return value as JsonObject;
}

function specialists(env: Env) {
  if (!env.BOTEK_SPECIALISTS) throw new Error("Botek specialist binding is not configured");
  return env.BOTEK_SPECIALISTS;
}

export async function durableMemoryStatus(env: Env): Promise<DurableMemoryStatus> {
  const result = object(await specialists(env).engramStatus());
  if (result.ok !== true || typeof result.configured !== "boolean") {
    throw new Error("invalid Engram status response");
  }
  const reachable = typeof result.reachable === "boolean" ? result.reachable : null;
  return {
    configured: result.configured,
    reachable,
    ...(typeof result.error === "string" ? { error: result.error.slice(0, 120) } : {}),
  };
}

export async function rememberDurably(env: Env, text: string): Promise<{ duplicate: boolean }> {
  const value = text.trim();
  if (!value || value.length > 2_000) throw new RangeError("invalid durable memory text");
  const result = object(await specialists(env).engramStore({
    text: value,
    category: "other",
    importance: 0.7,
    metadata: { surface: "telegram" },
  }));
  if (result.ok !== true) throw new Error("Engram store failed");
  return { duplicate: result.duplicate === true };
}

export async function recallDurableMemory(
  env: Env,
  query: string,
  limit = 5,
): Promise<DurableMemoryHit[]> {
  const value = query.trim();
  if (!value || value.length > 2_000) throw new RangeError("invalid durable memory query");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 8) throw new RangeError("invalid memory result limit");
  const result = object(await specialists(env).engramSearch(value, limit));
  if (result.ok !== true || !Array.isArray(result.results)) {
    throw new Error("invalid Engram search response");
  }
  return result.results.slice(0, limit).flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const raw = entry as JsonObject;
    if (typeof raw.content !== "string" || !raw.content.trim()) return [];
    return [{
      content: raw.content.trim().slice(0, 1_200),
      ...(typeof raw.category === "string" ? { category: raw.category.slice(0, 40) } : {}),
      ...(typeof raw.score === "number" && Number.isFinite(raw.score) ? { score: raw.score } : {}),
    }];
  });
}

export function durableMemoryView(hits: DurableMemoryHit[]): string {
  if (!hits.length) return "🧠 Nic sensownego nie znalazłem w pamięci długoterminowej.";
  return [
    "🧠 Pamięć długoterminowa:",
    "",
    ...hits.map((hit, index) => {
      const meta = [
        hit.category,
        typeof hit.score === "number" ? `score ${hit.score.toFixed(2)}` : "",
      ].filter(Boolean).join(" · ");
      return `${index + 1}. ${hit.content}${meta ? `\n   [${meta}]` : ""}`;
    }),
  ].join("\n\n").slice(0, 4_000);
}

export function durableMemoryStatusView(status: DurableMemoryStatus): string {
  if (!status.configured) return "🧠 Engram: nie skonfigurowany.";
  if (status.reachable === true) return "🧠 Engram: online.";
  if (status.reachable === false) return `🧠 Engram: skonfigurowany, ale niedostępny${status.error ? ` (${status.error})` : ""}.`;
  return "🧠 Engram: skonfigurowany, stan połączenia nieznany.";
}
