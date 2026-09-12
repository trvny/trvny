import { bearerAuthorized } from './auth.ts';
import { configuredOpenRouterModels } from './openrouter-models.ts';

export const REVIEW_ROUTER_PATH = '/review-router/v1/chat/completions';
export const REVIEW_ROUTER_MODELS_PATH = '/review-router/v1/models';
export const REVIEW_WORKERS_AI_OVERRIDE_HEADER = 'x-kanarek-review-workers-ai-enabled';

const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_QUOTA_COOLDOWN_MS = 10 * 60_000;
const DEFAULT_TRANSIENT_COOLDOWN_MS = 30_000;
const MIN_COOLDOWN_MS = 1_000;
const MAX_COOLDOWN_MS = 30 * 60_000;
const SOFT_FAILURE_PREVIEW_BYTES = 8_192;
const WORKERS_AI_REVIEW_MODEL = '@cf/zai-org/glm-4.7-flash' as const;
const DEFAULT_WORKERS_AI_DAILY_NEURONS = 10_000;
const MAX_WORKERS_AI_DAILY_NEURONS = 10_000;
const WORKERS_AI_INPUT_NEURONS_PER_MILLION = 5_500;
const WORKERS_AI_OUTPUT_NEURONS_PER_MILLION = 36_400;
const WORKERS_AI_MAX_OUTPUT_TOKENS = 4_096;
const WORKERS_AI_HIDDEN_OUTPUT_TOKEN_FACTOR = 2;
const WORKERS_AI_RESERVATION_SAFETY_FACTOR = 1.25;
const WORKERS_AI_BUDGET_STORAGE_KEY = 'workers-ai-neuron-budget';
const DEFAULT_REVIEW_OLLAMA_MODELS = [
  'glm-5.3-flash',
  'gpt-oss:120b',
  'gpt-oss:20b',
] as const;
const DEFAULT_REVIEW_GROQ_MODEL = 'openai/gpt-oss-120b';
const DEFAULT_REVIEW_OPENROUTER_MODELS = [
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'poolside/laguna-s-2.1:free',
  'cohere/north-mini-code:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'openrouter/free',
] as const;
const AIHUBMIX_RETRYABLE_MESSAGES = [
  'to prevent abuse of free resources',
  'accounts that have not been recharged can only try',
  'increase the free quota after recharging',
] as const;

export interface ReviewRouterEnv {
  AI?: Ai;
  KANAREK_REVIEW_ROUTER_TOKEN?: string;
  AIHUBMIX_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  ORCAROUTER_API_KEY?: string;
  OLLAMA_API_KEY?: string;
  GROQ_API_KEY?: string;
  KANAREK_REVIEW_ROUTER_TIMEOUT_MS?: string;
  KANAREK_REVIEW_WORKERS_AI_ENABLED?: string;
  KANAREK_REVIEW_WORKERS_AI_DAILY_NEURONS?: string;
  KANAREK_REVIEW_OLLAMA_MODELS?: string;
  KANAREK_REVIEW_GROQ_MODEL?: string;
  KANAREK_REVIEW_COOLDOWNS?: DurableObjectNamespace;
  KANAREK_REVIEW_QUOTA_COOLDOWN_MS?: string;
  KANAREK_REVIEW_TRANSIENT_COOLDOWN_MS?: string;
  KANAREK_REVIEW_OPENROUTER_MODELS?: string;
  KANAREK_OPENROUTER_MODELS?: string;
}

type JsonObject = Record<string, unknown>;

type ReviewProviderId = 'aihubmix' | 'openrouter' | 'orcarouter' | 'ollama' | 'groq' | 'workers-ai';

type ReviewProvider = {
  id: ReviewProviderId;
  url: string;
  model: string;
  fallbackModels?: readonly string[];
  apiKey: (env: ReviewRouterEnv) => string | undefined;
  headers?: Record<string, string>;
};

type ProviderCooldown = {
  until: number;
  category: string;
};

type WorkersAiBudgetState = {
  day: string;
  reserved: number;
  pending?: Record<string, number>;
};

function validWorkersAiReservationId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

function normalizedWorkersAiPending(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const pending: Record<string, number> = {};
  for (const [id, neurons] of Object.entries(value)) {
    if (validWorkersAiReservationId(id) && Number.isInteger(neurons) && (neurons as number) >= 1) {
      pending[id] = neurons as number;
    }
  }
  return pending;
}

function normalizedWorkersAiBudget(
  value: WorkersAiBudgetState | undefined,
  day: string,
): { reserved: number; pending: Record<string, number> } {
  if (!value || value.day !== day) return { reserved: 0, pending: {} };
  return {
    reserved: Number.isInteger(value.reserved) ? Math.max(0, value.reserved) : 0,
    pending: normalizedWorkersAiPending(value.pending),
  };
}

const COOLDOWN_STORAGE_KEY = 'cooldown';
const COOLDOWN_INTERNAL_ORIGIN = 'https://review-cooldown.internal';

function validProviderCooldown(value: unknown): value is ProviderCooldown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const cooldown = value as Partial<ProviderCooldown>;
  return (
    typeof cooldown.until === 'number' &&
    Number.isFinite(cooldown.until) &&
    typeof cooldown.category === 'string' &&
    cooldown.category.length > 0 &&
    cooldown.category.length <= 64
  );
}

function cooldownJson(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

export class ReviewProviderCooldownStore {
  private readonly state: DurableObjectState;
  private queue: Promise<void> = Promise.resolve();

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  fetch(request: Request): Promise<Response> {
    return this.enqueue(() => this.handle(request));
  }

  async alarm(): Promise<void> {
    await this.enqueue(async () => {
      const current = await this.state.storage.get<ProviderCooldown>(COOLDOWN_STORAGE_KEY);
      if (validProviderCooldown(current) && current.until > Date.now()) {
        await this.state.storage.setAlarm(current.until);
        return;
      }
      await this.state.storage.delete(COOLDOWN_STORAGE_KEY);
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async handle(request: Request): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/active' && request.method === 'GET') {
      const current = await this.state.storage.get<ProviderCooldown>(COOLDOWN_STORAGE_KEY);
      if (!validProviderCooldown(current) || current.until <= Date.now()) {
        if (current !== undefined) {
          await this.state.storage.delete(COOLDOWN_STORAGE_KEY);
          await this.state.storage.deleteAlarm();
        }
        return cooldownJson({ active: false });
      }
      return cooldownJson({ active: true, ...current });
    }

    if (pathname === '/extend' && request.method === 'POST') {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return cooldownJson({ error: 'invalid_json' }, 400);
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return cooldownJson({ error: 'invalid_cooldown' }, 400);
      }
      const input = body as { category?: unknown; durationMs?: unknown };
      if (
        typeof input.category !== 'string' ||
        !input.category ||
        input.category.length > 64 ||
        typeof input.durationMs !== 'number' ||
        !Number.isInteger(input.durationMs) ||
        input.durationMs < MIN_COOLDOWN_MS ||
        input.durationMs > MAX_COOLDOWN_MS
      ) {
        return cooldownJson({ error: 'invalid_cooldown' }, 400);
      }

      const candidate: ProviderCooldown = {
        until: Date.now() + input.durationMs,
        category: input.category,
      };
      const raw = await this.state.storage.get<ProviderCooldown>(COOLDOWN_STORAGE_KEY);
      const current = validProviderCooldown(raw) ? raw : null;
      const next = current && current.until >= candidate.until ? current : candidate;
      if (next === candidate) {
        await this.state.storage.put(COOLDOWN_STORAGE_KEY, candidate);
        await this.state.storage.setAlarm(candidate.until);
      }
      return cooldownJson({ ok: true, ...next });
    }

    if (pathname === '/reserve-neurons' && request.method === 'POST') {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return cooldownJson({ error: 'invalid_json' }, 400);
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return cooldownJson({ error: 'invalid_budget_reservation' }, 400);
      }
      const input = body as {
        day?: unknown;
        neurons?: unknown;
        limit?: unknown;
        reservationId?: unknown;
      };
      if (
        typeof input.day !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.day) ||
        typeof input.neurons !== 'number' ||
        !Number.isInteger(input.neurons) ||
        input.neurons < 1 ||
        typeof input.limit !== 'number' ||
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > MAX_WORKERS_AI_DAILY_NEURONS ||
        !validWorkersAiReservationId(input.reservationId)
      ) {
        return cooldownJson({ error: 'invalid_budget_reservation' }, 400);
      }
      const current = await this.state.storage.get<WorkersAiBudgetState>(
        WORKERS_AI_BUDGET_STORAGE_KEY,
      );
      const budget = normalizedWorkersAiBudget(current, input.day);
      const existing = budget.pending[input.reservationId];
      if (existing !== undefined) {
        if (existing !== input.neurons) {
          return cooldownJson({ error: 'reservation_conflict' }, 409);
        }
        return cooldownJson({
          allowed: true,
          day: input.day,
          reserved: budget.reserved,
          requested: input.neurons,
          reservationId: input.reservationId,
          limit: input.limit,
          deduplicated: true,
        });
      }
      if (budget.reserved + input.neurons > input.limit) {
        return cooldownJson({
          allowed: false,
          day: input.day,
          reserved: budget.reserved,
          requested: input.neurons,
          reservationId: input.reservationId,
          limit: input.limit,
        }, 429);
      }
      const next = budget.reserved + input.neurons;
      await this.state.storage.put(WORKERS_AI_BUDGET_STORAGE_KEY, {
        day: input.day,
        reserved: next,
        pending: { ...budget.pending, [input.reservationId]: input.neurons },
      } satisfies WorkersAiBudgetState);
      return cooldownJson({
        allowed: true,
        day: input.day,
        reserved: next,
        requested: input.neurons,
        reservationId: input.reservationId,
        limit: input.limit,
        deduplicated: false,
      });
    }

    if (pathname === '/settle-neurons' && request.method === 'POST') {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return cooldownJson({ error: 'invalid_json' }, 400);
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return cooldownJson({ error: 'invalid_budget_settlement' }, 400);
      }
      const input = body as {
        day?: unknown;
        reservationId?: unknown;
        actualNeurons?: unknown;
      };
      if (
        typeof input.day !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(input.day) ||
        !validWorkersAiReservationId(input.reservationId) ||
        typeof input.actualNeurons !== 'number' ||
        !Number.isInteger(input.actualNeurons) ||
        input.actualNeurons < 1 ||
        input.actualNeurons > MAX_WORKERS_AI_DAILY_NEURONS
      ) {
        return cooldownJson({ error: 'invalid_budget_settlement' }, 400);
      }
      const current = await this.state.storage.get<WorkersAiBudgetState>(
        WORKERS_AI_BUDGET_STORAGE_KEY,
      );
      const budget = normalizedWorkersAiBudget(current, input.day);
      const reservedNeurons = budget.pending[input.reservationId];
      if (reservedNeurons === undefined) {
        return cooldownJson({
          settled: false,
          missing: true,
          day: input.day,
          reserved: budget.reserved,
          reservationId: input.reservationId,
        });
      }
      const pending = { ...budget.pending };
      delete pending[input.reservationId];
      const next = Math.max(
        0,
        budget.reserved - reservedNeurons + input.actualNeurons,
      );
      await this.state.storage.put(WORKERS_AI_BUDGET_STORAGE_KEY, {
        day: input.day,
        reserved: next,
        ...(Object.keys(pending).length ? { pending } : {}),
      } satisfies WorkersAiBudgetState);
      return cooldownJson({
        settled: true,
        missing: false,
        day: input.day,
        reserved: next,
        reservationId: input.reservationId,
        reservedNeurons,
        actualNeurons: input.actualNeurons,
      });
    }

    if (pathname === '/neuron-budget' && request.method === 'GET') {
      const url = new URL(request.url);
      const day = url.searchParams.get('day');
      const rawLimit = url.searchParams.get('limit');
      const limit = rawLimit && /^\d+$/.test(rawLimit) ? Number.parseInt(rawLimit, 10) : NaN;
      if (
        !day ||
        !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > MAX_WORKERS_AI_DAILY_NEURONS
      ) {
        return cooldownJson({ error: 'invalid_budget_query' }, 400);
      }
      const current = await this.state.storage.get<WorkersAiBudgetState>(
        WORKERS_AI_BUDGET_STORAGE_KEY,
      );
      const reserved = normalizedWorkersAiBudget(current, day).reserved;
      return cooldownJson({
        day,
        limit,
        reserved,
        remaining: Math.max(0, limit - reserved),
      });
    }

    return cooldownJson({ error: 'not_found' }, 404);
  }
}

function configuredModelList(raw: string | undefined, fallback: readonly string[]): string[] {
  const configured = raw?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
  return [...new Set(configured.length > 0 ? configured : fallback)];
}

function providers(env: ReviewRouterEnv): readonly ReviewProvider[] {
  const reviewOpenRouterModels = env.KANAREK_REVIEW_OPENROUTER_MODELS?.trim();
  const sharedOpenRouterModels = env.KANAREK_OPENROUTER_MODELS?.trim();
  const openRouterModels = reviewOpenRouterModels
    ? configuredOpenRouterModels(reviewOpenRouterModels)
    : sharedOpenRouterModels
      ? configuredOpenRouterModels(sharedOpenRouterModels)
      : [...DEFAULT_REVIEW_OPENROUTER_MODELS];
  const ollamaModels = configuredModelList(
    env.KANAREK_REVIEW_OLLAMA_MODELS,
    DEFAULT_REVIEW_OLLAMA_MODELS,
  );
  return [
    {
      id: 'openrouter',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      model: openRouterModels[0],
      fallbackModels: openRouterModels.slice(1),
      apiKey: (providerEnv) => providerEnv.OPENROUTER_API_KEY,
      headers: { 'X-Title': 'Kanarek free review' },
    },
    {
      id: 'orcarouter',
      url: 'https://api.orcarouter.ai/v1/chat/completions',
      model: 'orcarouter/free',
      apiKey: (providerEnv) => providerEnv.ORCAROUTER_API_KEY,
    },
    {
      id: 'aihubmix',
      url: 'https://aihubmix.com/v1/chat/completions',
      model: 'coding-glm-5.3-free',
      apiKey: (providerEnv) => providerEnv.AIHUBMIX_API_KEY,
    },
    {
      id: 'ollama',
      url: 'https://ollama.com/v1/chat/completions',
      model: ollamaModels[0] ?? DEFAULT_REVIEW_OLLAMA_MODELS[0],
      fallbackModels: ollamaModels.slice(1),
      apiKey: (providerEnv) => providerEnv.OLLAMA_API_KEY,
    },
    {
      id: 'groq',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      model: env.KANAREK_REVIEW_GROQ_MODEL?.trim() || DEFAULT_REVIEW_GROQ_MODEL,
      apiKey: (providerEnv) => providerEnv.GROQ_API_KEY,
    },
  ];
}


function workersAiInput(input: JsonObject): ChatCompletionsInput | null {
  if (!Array.isArray(input.messages)) return null;
  const request = { ...input };
  delete request.model;
  delete request.models;
  delete request.stream_options;
  const requestedMax = typeof request.max_tokens === 'number' && Number.isFinite(request.max_tokens)
    ? request.max_tokens
    : typeof request.max_completion_tokens === 'number' && Number.isFinite(request.max_completion_tokens)
      ? request.max_completion_tokens
      : WORKERS_AI_MAX_OUTPUT_TOKENS;
  request.max_tokens = Math.min(
    Math.max(1, Math.ceil(requestedMax)),
    WORKERS_AI_MAX_OUTPUT_TOKENS,
  );
  delete request.max_completion_tokens;
  request.stream = false;
  return request as ChatCompletionsInput;
}

function workersAiFailureCategory(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'timeout';
  const value = error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : '';
  if (/\b429\b|quota|daily limit|usage limit|neuron/.test(value)) return 'soft_quota';
  if (/\b3040\b|capacity|\b503\b|temporar/.test(value)) return 'http_503';
  if (/\b403\b|\b5035\b|paid plan|billing/.test(value)) return 'http_403';
  return 'network';
}

function workersAiResponse(result: ChatCompletionsOutput): Response {
  return Response.json(
    { ...result, model: WORKERS_AI_REVIEW_MODEL },
    {
      headers: {
        'cache-control': 'no-store',
        'x-kanarek-review-provider': 'workers-ai',
      },
    },
  );
}

function diagnostic(provider: ReviewProvider | ReviewProviderId, category: string): string {
  const id = typeof provider === 'string' ? provider : provider.id;
  return `${id}:${category}`;
}

function diagnosticMessage(message: string, failures: readonly string[]): string {
  return failures.length ? `${message} (${failures.join(', ')})` : message;
}

function jsonError(message: string, code: string, status: number): Response {
  return Response.json(
    { error: { message, type: 'provider_error', code } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeProviderInput(input: JsonObject): JsonObject {
  if (!Array.isArray(input.messages)) return input;
  let changed = false;
  const messages = input.messages.map((message) => {
    if (!isObject(message) || message.role !== 'assistant' || message.refusal !== null) return message;
    const normalized = { ...message };
    delete normalized.refusal;
    changed = true;
    return normalized;
  });
  return changed ? { ...input, messages } : input;
}

function authorized(request: Request, env: ReviewRouterEnv): boolean {
  return bearerAuthorized(request, env.KANAREK_REVIEW_ROUTER_TOKEN);
}

function timeoutMs(env: ReviewRouterEnv): number {
  const raw = env.KANAREK_REVIEW_ROUTER_TIMEOUT_MS?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < MIN_TIMEOUT_MS || parsed > MAX_TIMEOUT_MS) {
    return DEFAULT_TIMEOUT_MS;
  }
  return parsed;
}

function boundedCooldownMs(raw: string | undefined, fallback: number): number {
  const value = raw?.trim();
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < MIN_COOLDOWN_MS || parsed > MAX_COOLDOWN_MS) {
    return fallback;
  }
  return parsed;
}

function cooldownDurationMs(env: ReviewRouterEnv, category: string): number | null {
  if (category === 'soft_quota' || category === 'http_402' || category === 'http_429') {
    return boundedCooldownMs(env.KANAREK_REVIEW_QUOTA_COOLDOWN_MS, DEFAULT_QUOTA_COOLDOWN_MS);
  }
  if (
    category === 'timeout' ||
    category === 'network' ||
    category === 'preview_timeout' ||
    category === 'http_408' ||
    category === 'http_409' ||
    category === 'http_425' ||
    /^http_5\d\d$/.test(category)
  ) {
    return boundedCooldownMs(
      env.KANAREK_REVIEW_TRANSIENT_COOLDOWN_MS,
      DEFAULT_TRANSIENT_COOLDOWN_MS,
    );
  }
  return null;
}

function providerCooldownStub(
  env: ReviewRouterEnv,
  provider: ReviewProviderId,
): DurableObjectStub | null {
  if (!env.KANAREK_REVIEW_COOLDOWNS) return null;
  const id = env.KANAREK_REVIEW_COOLDOWNS.idFromName(provider);
  return env.KANAREK_REVIEW_COOLDOWNS.get(id);
}

export function reviewWorkersAiExplicitlyDisabled(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === 'false' || value === '0' || value === 'no' || value === 'off';
}

function workersAiEnabled(env: ReviewRouterEnv): boolean {
  return Boolean(
    env.AI &&
    env.KANAREK_REVIEW_COOLDOWNS &&
    !reviewWorkersAiExplicitlyDisabled(env.KANAREK_REVIEW_WORKERS_AI_ENABLED)
  );
}

function workersAiDailyNeuronLimit(env: ReviewRouterEnv): number {
  const raw = env.KANAREK_REVIEW_WORKERS_AI_DAILY_NEURONS?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_WORKERS_AI_DAILY_NEURONS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return DEFAULT_WORKERS_AI_DAILY_NEURONS;
  return Math.min(parsed, MAX_WORKERS_AI_DAILY_NEURONS);
}

function workersAiNeuronReservation(input: ChatCompletionsInput): number {
  const maxTokens = typeof input.max_tokens === 'number'
    ? input.max_tokens
    : WORKERS_AI_MAX_OUTPUT_TOKENS;
  // UTF-8 bytes are deliberately used as a conservative upper bound for input tokens.
  // Over-reserving can only stop this free-tier guard earlier; under-reserving could spend.
  const conservativeInputTokens = new TextEncoder().encode(JSON.stringify(input)).byteLength;
  const inputNeurons = conservativeInputTokens * WORKERS_AI_INPUT_NEURONS_PER_MILLION / 1_000_000;
  const outputNeurons = maxTokens * WORKERS_AI_HIDDEN_OUTPUT_TOKEN_FACTOR
    * WORKERS_AI_OUTPUT_NEURONS_PER_MILLION / 1_000_000;
  return Math.max(
    1,
    Math.ceil((inputNeurons + outputNeurons) * WORKERS_AI_RESERVATION_SAFETY_FACTOR),
  );
}

type WorkersAiReservation = {
  day: string;
  neurons: number;
  reservationId: string;
};
type WorkersAiReservationResult =
  | { status: 'reserved'; reservation: WorkersAiReservation }
  | { status: 'exhausted' | 'unavailable' };
type WorkersAiBudgetStatus = { day: string; limit: number; reserved: number; remaining: number };

async function reserveWorkersAiNeurons(
  env: ReviewRouterEnv,
  input: ChatCompletionsInput,
): Promise<WorkersAiReservationResult> {
  const stub = providerCooldownStub(env, 'workers-ai');
  if (!stub) return { status: 'unavailable' };
  const reservation: WorkersAiReservation = {
    day: new Date().toISOString().slice(0, 10),
    neurons: workersAiNeuronReservation(input),
    reservationId: crypto.randomUUID(),
  };
  try {
    const response = await stub.fetch(`${COOLDOWN_INTERNAL_ORIGIN}/reserve-neurons`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        day: reservation.day,
        neurons: reservation.neurons,
        reservationId: reservation.reservationId,
        limit: workersAiDailyNeuronLimit(env),
      }),
    });
    if (response.ok) return { status: 'reserved', reservation };
    return { status: response.status === 429 ? 'exhausted' : 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}

function workersAiActualNeurons(result: unknown): number | null {
  if (!isObject(result) || !isObject(result.usage)) return null;
  const usage = result.usage;
  const promptTokens = usage.prompt_tokens ?? usage.input_tokens;
  const completionTokens = usage.completion_tokens ?? usage.output_tokens;
  if (
    typeof promptTokens !== 'number' ||
    !Number.isInteger(promptTokens) ||
    promptTokens < 0 ||
    typeof completionTokens !== 'number' ||
    !Number.isInteger(completionTokens) ||
    completionTokens < 0
  ) return null;
  const inputNeurons = promptTokens * WORKERS_AI_INPUT_NEURONS_PER_MILLION / 1_000_000;
  const outputNeurons = completionTokens * WORKERS_AI_OUTPUT_NEURONS_PER_MILLION / 1_000_000;
  return Math.max(1, Math.ceil(inputNeurons + outputNeurons));
}

async function settleWorkersAiNeurons(
  env: ReviewRouterEnv,
  reservation: WorkersAiReservation,
  actualNeurons: number,
): Promise<void> {
  const stub = providerCooldownStub(env, 'workers-ai');
  if (!stub) return;
  try {
    const response = await stub.fetch(`${COOLDOWN_INTERNAL_ORIGIN}/settle-neurons`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        day: reservation.day,
        reservationId: reservation.reservationId,
        actualNeurons,
      }),
    });
    if (!response.ok) {
      console.warn(JSON.stringify({
        kanarekReviewRouter: 'workers_ai_budget_settlement_failed',
        status: response.status,
      }));
    }
  } catch {
    console.warn(JSON.stringify({
      kanarekReviewRouter: 'workers_ai_budget_settlement_failed',
      status: null,
    }));
  }
}

async function workersAiBudgetStatus(env: ReviewRouterEnv): Promise<WorkersAiBudgetStatus | null> {
  const stub = providerCooldownStub(env, 'workers-ai');
  if (!stub) return null;
  const day = new Date().toISOString().slice(0, 10);
  const limit = workersAiDailyNeuronLimit(env);
  try {
    const response = await stub.fetch(
      `${COOLDOWN_INTERNAL_ORIGIN}/neuron-budget?day=${encodeURIComponent(day)}&limit=${limit}`,
    );
    if (!response.ok) return null;
    const payload = await response.json() as Partial<WorkersAiBudgetStatus>;
    if (
      payload.day !== day ||
      payload.limit !== limit ||
      typeof payload.reserved !== 'number' ||
      !Number.isInteger(payload.reserved) ||
      typeof payload.remaining !== 'number' ||
      !Number.isInteger(payload.remaining)
    ) return null;
    return payload as WorkersAiBudgetStatus;
  } catch {
    return null;
  }
}

async function activeProviderCooldown(
  env: ReviewRouterEnv,
  provider: ReviewProviderId,
): Promise<ProviderCooldown | null> {
  const stub = providerCooldownStub(env, provider);
  if (!stub) return null;
  try {
    const response = await stub.fetch(`${COOLDOWN_INTERNAL_ORIGIN}/active`);
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (
      payload &&
      typeof payload === 'object' &&
      !Array.isArray(payload) &&
      (payload as { active?: unknown }).active === true &&
      validProviderCooldown(payload)
    ) {
      return payload;
    }
  } catch {
    console.warn(JSON.stringify({ kanarekReviewRouter: 'cooldown_read_failed', provider }));
  }
  return null;
}

export async function reviewProviderPoolHealth(env: ReviewRouterEnv): Promise<{
  available: number;
  configured: number;
  providers: Array<{
    available: boolean;
    configured: boolean;
    cooldown?: { category: string; until: number };
    provider: ReviewProviderId;
  }>;
  ready: boolean;
}> {
  const states = await Promise.all(
    providers(env).map(async (provider) => {
      const configured = Boolean(provider.apiKey(env)?.trim());
      if (!configured) {
        return { available: false, configured: false, provider: provider.id };
      }
      const cooldown = await activeProviderCooldown(env, provider.id);
      return cooldown
        ? { available: false, configured: true, cooldown, provider: provider.id }
        : { available: true, configured: true, provider: provider.id };
    }),
  );
  const workersAiConfigured = workersAiEnabled(env);
  const [workersAiCooldown, workersAiBudget] = workersAiConfigured
    ? await Promise.all([
        activeProviderCooldown(env, 'workers-ai'),
        workersAiBudgetStatus(env),
      ])
    : [null, null];
  states.push(
    !workersAiConfigured
      ? { available: false, configured: false, provider: 'workers-ai' }
      : workersAiCooldown
        ? { available: false, configured: true, cooldown: workersAiCooldown, provider: 'workers-ai' }
        : workersAiBudget && workersAiBudget.remaining > 0
          ? { available: true, configured: true, provider: 'workers-ai' }
          : { available: false, configured: true, provider: 'workers-ai' },
  );
  const configured = states.filter((state) => state.configured).length;
  const available = states.filter((state) => state.available).length;
  return { available, configured, providers: states, ready: available > 0 };
}

async function rememberProviderCooldown(
  provider: ReviewProviderId,
  category: string,
  env: ReviewRouterEnv,
): Promise<void> {
  const durationMs = cooldownDurationMs(env, category);
  if (durationMs === null) return;
  const stub = providerCooldownStub(env, provider);
  if (!stub) return;
  try {
    const response = await stub.fetch(`${COOLDOWN_INTERNAL_ORIGIN}/extend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category, durationMs }),
    });
    if (!response.ok) {
      console.warn(JSON.stringify({
        kanarekReviewRouter: 'cooldown_write_failed', provider, status: response.status,
      }));
    }
  } catch {
    console.warn(JSON.stringify({ kanarekReviewRouter: 'cooldown_write_failed', provider }));
  }
}

function isQuotaFailure(category: string): boolean {
  const normalized = category.startsWith('cooldown_') ? category.slice('cooldown_'.length) : category;
  return normalized === 'soft_quota' || normalized === 'http_402' || normalized === 'http_429';
}

function retryableStatus(status: number): boolean {
  return (
    status === 401 ||
    status === 402 ||
    status === 403 ||
    status === 404 ||
    status === 408 ||
    status === 409 ||
    status === 413 ||
    status === 422 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

function upstreamResponse(response: Response, provider: ReviewProvider): Response {
  const headers = new Headers(response.headers);
  headers.delete('set-cookie');
  headers.delete('www-authenticate');
  headers.set('cache-control', 'no-store');
  headers.set('x-kanarek-review-provider', provider.id);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Best-effort cleanup only; never expose an upstream error body.
  }
}

function readPreviewChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  deadlineAt: number,
): Promise<ReadableStreamReadResult<Uint8Array> | null> {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, remainingMs);
    const finish = (result: ReadableStreamReadResult<Uint8Array> | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    reader.read().then((result) => finish(result), () => finish(null));
  });
}

async function responsePreview(response: Response, deadlineAt: number): Promise<string | null> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    reader = response.clone().body?.getReader();
    if (!reader) return '';
    const decoder = new TextDecoder();
    let preview = '';
    while (preview.length < SOFT_FAILURE_PREVIEW_BYTES) {
      const chunk = await readPreviewChunk(reader, deadlineAt);
      if (!chunk) return null;
      const { done, value } = chunk;
      if (done) break;
      preview += decoder.decode(value, { stream: true });
      if (/(?:\r\n|\r|\n){2}/.test(preview)) break;
    }
    return preview.slice(0, SOFT_FAILURE_PREVIEW_BYTES);
  } catch {
    return null;
  } finally {
    reader?.cancel().catch(() => {
      // Best-effort preview cleanup; do not block the original tee branch.
    });
  }
}

function isAIHubMixSoftFailure(preview: string): boolean {
  const normalized = preview.toLowerCase();
  return AIHUBMIX_RETRYABLE_MESSAGES.some((message) => normalized.includes(message));
}

type ProviderAttempt = {
  model: string;
  fallbackModels?: readonly string[];
  label: 'default' | 'model_fallback' | 'fallback_chain' | 'primary_only';
};

function providerAttempts(provider: ReviewProvider): readonly ProviderAttempt[] {
  if (provider.id === 'openrouter' && provider.fallbackModels?.length) {
    return [
      { model: provider.model, fallbackModels: provider.fallbackModels, label: 'fallback_chain' },
      { model: provider.model, label: 'primary_only' },
    ];
  }
  if (provider.id === 'ollama' && provider.fallbackModels?.length) {
    return [provider.model, ...provider.fallbackModels].map((model, index) => ({
      model,
      label: index === 0 ? 'default' : 'model_fallback',
    }));
  }
  return [{ model: provider.model, label: 'default' }];
}

function shouldTryNextAttempt(
  provider: ReviewProvider,
  status: number,
  attemptIndex: number,
  attemptCount: number,
): boolean {
  if (attemptIndex + 1 >= attemptCount) return false;
  if (provider.id === 'openrouter') return status === 400;
  if (provider.id === 'ollama') return status === 400 || status === 404;
  return false;
}

function badRequestText(preview: string): string {
  try {
    const parsed: unknown = JSON.parse(preview);
    const root: unknown = Array.isArray(parsed) ? parsed[0] : parsed;
    if (isObject(root)) {
      if (isObject(root.error) && typeof root.error.message === 'string') return root.error.message;
      if (typeof root.message === 'string') return root.message;
    }
  } catch {
    // Fall back to the bounded raw preview for non-JSON provider errors.
  }
  return preview;
}

function classifyBadRequest(preview: string | null): string {
  if (preview === null) return 'http_400_unreadable';
  if (!preview) return 'http_400';
  const normalized = badRequestText(preview).toLowerCase();
  if (
    normalized.includes('api key') &&
    (normalized.includes('not valid') || normalized.includes('invalid') ||
      normalized.includes('expired') || normalized.includes('revoked') || normalized.includes('blocked'))
  ) return 'http_400_invalid_api_key';
  if (
    normalized.includes('context length') ||
    normalized.includes('context window') ||
    normalized.includes('too many tokens') ||
    normalized.includes('token limit')
  ) return 'http_400_context_length';
  if (
    normalized.includes('models') &&
    (normalized.includes('invalid') || normalized.includes('unknown') || normalized.includes('not found'))
  ) return 'http_400_fallback_models';
  if (
    normalized.includes('model') &&
    (normalized.includes('invalid') ||
      normalized.includes('not found') ||
      normalized.includes('does not exist') ||
      normalized.includes('unavailable'))
  ) return 'http_400_invalid_model';
  if (
    normalized.includes('unsupported parameter') ||
    normalized.includes('unknown parameter') ||
    normalized.includes('unknown field') ||
    normalized.includes('stream_options')
  ) return 'http_400_unsupported_parameter';
  if (
    normalized.includes('message') &&
    (normalized.includes('invalid') || normalized.includes('required') || normalized.includes('must'))
  ) return 'http_400_invalid_message';
  if (normalized.includes('moderation') || normalized.includes('safety')) {
    return 'http_400_moderation';
  }
  return 'http_400_invalid_request';
}

function isClientBadRequestCategory(category: string): boolean {
  return category === 'http_400' ||
    category === 'http_400_context_length' ||
    category === 'http_400_unsupported_parameter' ||
    category === 'http_400_invalid_message' ||
    category === 'http_400_moderation' ||
    category === 'http_400_invalid_request';
}

export async function handleReviewRouterRequest(
  request: Request,
  env: ReviewRouterEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === REVIEW_ROUTER_MODELS_PATH) {
    if (request.method !== 'GET') return jsonError('Method not allowed', 'method_not_allowed', 405);
    if (!authorized(request, env)) return jsonError('Unauthorized', 'unauthorized', 401);
    return Response.json({
      object: 'list',
      data: [{ id: 'kanarek-review-free', object: 'model', owned_by: 'kanarek' }],
    }, { headers: { 'cache-control': 'no-store' } });
  }
  if (url.pathname !== REVIEW_ROUTER_PATH) return null;
  if (request.method !== 'POST') return jsonError('Method not allowed', 'method_not_allowed', 405);
  if (!authorized(request, env)) return jsonError('Unauthorized', 'unauthorized', 401);

  let input: JsonObject;
  try {
    const value: unknown = await request.json();
    if (!isObject(value)) return jsonError('Invalid request body', 'invalid_request', 400);
    input = normalizeProviderInput(value);
  } catch {
    return jsonError('Invalid JSON body', 'invalid_json', 400);
  }

  let configured = 0;
  let invalidRequests = 0;
  const failures: string[] = [];

  for (const provider of providers(env)) {
    const apiKey = provider.apiKey(env)?.trim();
    if (!apiKey) continue;
    configured += 1;
    const cooldown = await activeProviderCooldown(env, provider.id);
    if (cooldown) {
      const category = `cooldown_${cooldown.category}`;
      failures.push(diagnostic(provider, category));
      console.info(JSON.stringify({
        kanarekReviewRouter: 'provider_cooldown', provider: provider.id, category: cooldown.category,
      }));
      continue;
    }
    const controller = new AbortController();
    const providerTimeoutMs = timeoutMs(env);
    const deadlineAt = Date.now() + providerTimeoutMs;
    const timeout = setTimeout(() => controller.abort(), providerTimeoutMs);
    const attempts = providerAttempts(provider);
    let providerFailureCategory = 'unknown';
    let providerInvalidRequest = true;

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const attempt = attempts[attemptIndex];
      try {
        const response = await fetcher(provider.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            ...provider.headers,
          },
          body: JSON.stringify({
            ...input,
            model: attempt.model,
            ...(attempt.fallbackModels?.length ? { models: attempt.fallbackModels } : { models: undefined }),
          }),
          signal: controller.signal,
        });
        if (response.ok) {
          if (provider.id === 'aihubmix') {
            const preview = await responsePreview(response, deadlineAt);
            if (preview === null) {
              await discard(response);
              providerFailureCategory = 'preview_timeout';
              providerInvalidRequest = false;
              console.warn(JSON.stringify({
                kanarekReviewRouter: 'provider_failed', provider: provider.id, category: 'preview_timeout',
              }));
              break;
            }
            if (isAIHubMixSoftFailure(preview)) {
              await discard(response);
              providerFailureCategory = 'soft_quota';
              providerInvalidRequest = false;
              console.warn(JSON.stringify({
                kanarekReviewRouter: 'provider_failed', provider: provider.id, category: 'soft_quota',
              }));
              break;
            }
          }
          clearTimeout(timeout);
          console.info(JSON.stringify({
            kanarekReviewRouter: 'selected', provider: provider.id, attempt: attempt.label, model: attempt.model,
          }));
          return upstreamResponse(response, provider);
        }

        const status = response.status;
        const preview = status === 400 ? await responsePreview(response, deadlineAt) : null;
        providerFailureCategory = status === 400 ? classifyBadRequest(preview) : `http_${status}`;
        if (status !== 400 || !isClientBadRequestCategory(providerFailureCategory)) providerInvalidRequest = false;
        await discard(response);
        console.warn(JSON.stringify({
          kanarekReviewRouter: 'provider_failed',
          provider: provider.id,
          status,
          category: providerFailureCategory,
          attempt: attempt.label,
          model: attempt.model,
        }));

        if (shouldTryNextAttempt(provider, status, attemptIndex, attempts.length)) {
          continue;
        }
        if (status === 400 || retryableStatus(status)) break;
        clearTimeout(timeout);
        failures.push(diagnostic(provider, providerFailureCategory));
        return jsonError(
          diagnosticMessage('Review provider configuration failed', failures),
          'provider_configuration_error',
          502,
        );
      } catch (error) {
        const category = error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'network';
        providerFailureCategory = category;
        providerInvalidRequest = false;
        console.warn(JSON.stringify({
          kanarekReviewRouter: 'provider_failed', provider: provider.id, category,
          attempt: attempt.label, model: attempt.model,
        }));
        break;
      }
    }

    clearTimeout(timeout);
    await rememberProviderCooldown(provider.id, providerFailureCategory, env);
    failures.push(diagnostic(provider, providerFailureCategory));
    if (providerInvalidRequest) invalidRequests += 1;
  }


  if (workersAiEnabled(env)) {
    configured += 1;
    const provider: ReviewProviderId = 'workers-ai';
    const cooldown = await activeProviderCooldown(env, provider);
    if (cooldown) {
      failures.push(diagnostic(provider, `cooldown_${cooldown.category}`));
      console.info(JSON.stringify({
        kanarekReviewRouter: 'provider_cooldown', provider, category: cooldown.category,
      }));
    } else {
      const bindingInput = workersAiInput(input);
      if (!bindingInput) {
        failures.push(diagnostic(provider, 'invalid_request'));
        invalidRequests += 1;
      } else {
        const reservationResult = await reserveWorkersAiNeurons(env, bindingInput);
        if (reservationResult.status !== 'reserved') {
          const category = reservationResult.status === 'exhausted' ? 'soft_quota' : 'network';
          await rememberProviderCooldown(provider, category, env);
          failures.push(diagnostic(provider, category));
          console.warn(JSON.stringify({
            kanarekReviewRouter: 'provider_failed', provider, category, model: WORKERS_AI_REVIEW_MODEL,
          }));
        } else {
          const reservation = reservationResult.reservation;
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            const result = await Promise.race([
              env.AI!.run(WORKERS_AI_REVIEW_MODEL, bindingInput),
              new Promise<never>((_, reject) => {
                timeout = setTimeout(
                  () => reject(new DOMException('Workers AI timed out', 'AbortError')),
                  timeoutMs(env),
                );
              }),
            ]);
            await settleWorkersAiNeurons(
              env,
              reservation,
              workersAiActualNeurons(result) ?? reservation.neurons,
            );
            console.info(JSON.stringify({
              kanarekReviewRouter: 'selected', provider, attempt: 'binding', model: WORKERS_AI_REVIEW_MODEL,
            }));
            return workersAiResponse(result);
          } catch (error) {
            await settleWorkersAiNeurons(env, reservation, reservation.neurons);
            const category = workersAiFailureCategory(error);
            await rememberProviderCooldown(provider, category, env);
            failures.push(diagnostic(provider, category));
            console.warn(JSON.stringify({
              kanarekReviewRouter: 'provider_failed', provider, category, model: WORKERS_AI_REVIEW_MODEL,
            }));
          } finally {
            if (timeout) clearTimeout(timeout);
          }
        }
      }
    }
  }

  if (!configured) {
    return jsonError('Review router is not configured', 'review_router_unconfigured', 503);
  }
  if (invalidRequests === configured) {
    return jsonError(diagnosticMessage('Invalid review request', failures), 'invalid_request', 400);
  }
  return jsonError(
    diagnosticMessage('Review providers unavailable', failures),
    'review_router_exhausted',
    failures.length > 0 && failures.every((failure) => isQuotaFailure(failure.split(':', 2)[1] ?? ''))
      ? 429
      : 502,
  );
}
