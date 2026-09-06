import type { ChatMessage, Env } from "./types";

type ProviderAttempt = {
  name: string;
  model: string;
  run: () => Promise<string>;
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
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ model, messages, temperature: 0.5 }),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${clipError(await response.text())}`);
  }

  const data = (await response.json()) as OpenAIResponse;
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("empty response");
  return content;
}

async function workersAi(env: Env, messages: ChatMessage[]): Promise<string> {
  const result = (await env.AI.run(env.WORKERS_AI_MODEL, { messages })) as {
    response?: string;
  };
  const content = result.response?.trim();
  if (!content) throw new Error("empty Workers AI response");
  return content;
}

export async function chatWithFallback(env: Env, messages: ChatMessage[]) {
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

  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      return {
        text: await attempt.run(),
        provider: attempt.name,
        model: attempt.model,
      };
    } catch (error) {
      errors.push(`${attempt.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`All providers failed: ${errors.join(" | ")}`);
}
