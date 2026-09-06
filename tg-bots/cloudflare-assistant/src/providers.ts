import type { ChatMessage, Env } from "./types";

const EXTERNAL_PROVIDER_TIMEOUT_MS = 8_000;

type ProviderAttempt = {
  name: string;
  model: string;
  run: () => Promise<string>;
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
  choices?: Array<{ message?: { content?: string } }>;
};

function clipError(text: string): string {
  return text.replace(/\s+/g, " ").slice(0, 240);
}

async function openAiCompatible(
  url: string,
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  headers: Record<string, string> = {},
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTERNAL_PROVIDER_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({ model, messages, temperature: 0.5 }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${clipError(await response.text())}`);
    }

    const data = (await response.json()) as OpenAIResponse;
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("empty response");
    return content;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`request timed out after ${EXTERNAL_PROVIDER_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function workersAi(env: Env, messages: ChatMessage[]): Promise<string> {
  const result = (await env.AI.run(env.WORKERS_AI_MODEL, { messages })) as {
    response?: string;
  };
  const content = result.response?.trim();
  if (!content) throw new Error("empty Workers AI response");
  return content;
}

function providerAttempts(env: Env, messages: ChatMessage[]): ProviderAttempt[] {
  const attempts: ProviderAttempt[] = [];

  if (env.ORCAROUTER_API_KEY) {
    attempts.push({
      name: "OrcaRouter",
      model: env.ORCAROUTER_MODEL,
      run: () =>
        openAiCompatible(
          "https://api.orcarouter.ai/v1/chat/completions",
          env.ORCAROUTER_API_KEY!,
          env.ORCAROUTER_MODEL,
          messages,
        ),
    });
  }

  if (env.OLLAMA_API_KEY) {
    attempts.push({
      name: "Ollama Cloud",
      model: env.OLLAMA_MODEL,
      run: () =>
        openAiCompatible(
          "https://ollama.com/v1/chat/completions",
          env.OLLAMA_API_KEY!,
          env.OLLAMA_MODEL,
          messages,
        ),
    });
  }

  if (env.OPENROUTER_API_KEY) {
    attempts.push({
      name: "OpenRouter",
      model: env.OPENROUTER_MODEL,
      run: () =>
        openAiCompatible(
          "https://openrouter.ai/api/v1/chat/completions",
          env.OPENROUTER_API_KEY!,
          env.OPENROUTER_MODEL,
          messages,
          { "X-Title": "travny-tg-assistant" },
        ),
    });
  }

  attempts.push({
    name: "Workers AI",
    model: env.WORKERS_AI_MODEL,
    run: () => workersAi(env, messages),
  });

  return attempts;
}

export async function completeWithFallback<T>(
  env: Env,
  messages: ChatMessage[],
  parse: (text: string) => T,
): Promise<CompletionResult<T>> {
  const errors: string[] = [];

  for (const attempt of providerAttempts(env, messages)) {
    try {
      const text = await attempt.run();
      return {
        value: parse(text),
        provider: attempt.name,
        model: attempt.model,
      };
    } catch (error) {
      errors.push(
        `${attempt.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  throw new AllProvidersFailedError(errors);
}

export async function chatWithFallback(env: Env, messages: ChatMessage[]) {
  const result = await completeWithFallback(env, messages, (text) => text);
  return { text: result.value, provider: result.provider, model: result.model };
}
