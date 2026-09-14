import type { ChatMessage, Env } from "./types";

const ROUTER_TIMEOUT_MS = 20_000;
const KANAREK_REVIEW_MODEL = "kanarek-review-free";
const KANAREK_REVIEW_PATH = "/review-router/v1/chat/completions";
const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";

type ProviderResult = {
  text: string;
  provider: string;
  model: string;
};

export class AllProvidersFailedError extends Error {
  constructor(readonly providerErrors: string[]) {
    super(`All providers failed: ${providerErrors.join(" | ")}`);
    this.name = "AllProvidersFailedError";
  }
}

export type CompletionResult<T> = {
  value: T;
  provider: string;
  model: string;
};

type OpenAIResponse = {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
};

function clipError(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 240);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(chunks.join(""));
}

export async function transcribeAudio(env: Env, audio: ArrayBuffer): Promise<string> {
  const result = (await env.AI.run(WHISPER_MODEL, {
    audio: arrayBufferToBase64(audio),
    task: "transcribe",
    vad_filter: true,
  })) as {
    text?: string;
    transcription_info?: { text?: string };
  };
  const text = (result.text ?? result.transcription_info?.text)?.trim();
  if (!text) throw new Error("empty Whisper transcription");
  return text;
}

async function kanarekFreeRouter(env: Env, messages: ChatMessage[]): Promise<ProviderResult> {
  const token = env.KANAREK_REVIEW_ROUTER_TOKEN?.trim();
  if (!token) throw new Error("KANAREK_REVIEW_ROUTER_TOKEN is not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ROUTER_TIMEOUT_MS);
  try {
    const request = new Request(`https://kanarek-companion.internal${KANAREK_REVIEW_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: KANAREK_REVIEW_MODEL, messages, temperature: 0.5 }),
      signal: controller.signal,
    });
    const response = await env.KANAREK_COMPANION.fetch(request);
    if (!response.ok) {
      throw new Error(`${response.status} ${clipError(await response.text())}`);
    }

    const data = (await response.json()) as OpenAIResponse;
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("empty Kanarek router response");
    const selected = response.headers.get("x-kanarek-review-provider") ?? "free-router";
    return {
      text,
      provider: `Kanarek/${selected}`,
      model: data.model ?? KANAREK_REVIEW_MODEL,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Kanarek router timed out after ${ROUTER_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function workersAi(env: Env, messages: ChatMessage[]): Promise<ProviderResult> {
  const result = (await env.AI.run(env.WORKERS_AI_MODEL, { messages })) as {
    response?: string;
  };
  const text = result.response?.trim();
  if (!text) throw new Error("empty Workers AI response");
  return { text, provider: "Workers AI", model: env.WORKERS_AI_MODEL };
}

export async function completeWithFallback<T>(
  env: Env,
  messages: ChatMessage[],
  parse: (text: string) => T,
): Promise<CompletionResult<T>> {
  const attempts = [
    () => kanarekFreeRouter(env, messages),
    () => workersAi(env, messages),
  ];
  const errors: string[] = [];

  for (const run of attempts) {
    try {
      const result = await run();
      return {
        value: parse(result.text),
        provider: result.provider,
        model: result.model,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new AllProvidersFailedError(errors);
}

export async function chatWithFallback(env: Env, messages: ChatMessage[]) {
  const result = await completeWithFallback(env, messages, (text) => text);
  return { text: result.value, provider: result.provider, model: result.model };
}
