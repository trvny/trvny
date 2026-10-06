import { bearerAuthorized } from '../../kanarek-companion/src/auth.ts';
import {
  REVIEW_PROVIDER_EXCLUDE_HEADER,
  REVIEW_ROUTER_CODE_REVIEW_MODEL,
  REVIEW_ROUTER_FREE_MODEL,
  REVIEW_ROUTER_JUDGE_MODEL,
  REVIEW_ROUTER_MODELS_PATH,
  REVIEW_ROUTER_QUIP_MODEL,
  REVIEW_ROUTER_SHITPOST_MODEL,
  REVIEW_ROUTER_PATH,
  REVIEW_ROUTER_REVIEW_MODEL,
  REVIEW_ROUTER_PAID_MODEL,
  REVIEW_ROUTER_WORK_MODEL,
} from '../../kanarek-companion/src/review-service-protocol.ts';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_FREE_PROBE_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_WORK_PROVIDER_TIMEOUT_MS = 5 * 60_000;
const REVIEW_TASK_MIN_PROVIDER_TIMEOUT_MS = 60_000;
const SHITPOST_TASK_MIN_PROVIDER_TIMEOUT_MS = 120_000;
const DEFAULT_QUOTA_COOLDOWN_MS = 10 * 60_000;
const DEFAULT_TRANSIENT_COOLDOWN_MS = 30_000;
const MIN_COOLDOWN_MS = 1_000;
const MAX_COOLDOWN_MS = 30 * 60_000;
const SOFT_FAILURE_PREVIEW_BYTES = 8_192;
const DEFAULT_WORKERS_AI_DAILY_NEURONS = 10_000;
const MAX_WORKERS_AI_DAILY_NEURONS = 10_000;
const WORKERS_AI_INPUT_NEURONS_PER_MILLION = 5_500;
const WORKERS_AI_OUTPUT_NEURONS_PER_MILLION = 36_400;
const WORKERS_AI_HIDDEN_OUTPUT_TOKEN_FACTOR = 2;
const WORKERS_AI_RESERVATION_SAFETY_FACTOR = 1.25;
// Fallbacks for a missing var. wrangler.jsonc is the source of truth; a test
// keeps these equal to it.
export const REVIEW_ROUTER_MODEL_DEFAULTS = {
  KANAREK_REVIEW_AIHUBMIX_MODELS: [
    'xiaomi-mimo-v2.6-flash-free',
    'coding-kimi-k3-free',
    'dots-3-note-preview-free',
    'nemotron-3.5-lightning-free',
    'hy3-free',
    'minimax-m2.7-free',
    'ling-3.0-flash-free',
    'lfm-2.5-2.6b-free',
  ],
  KANAREK_REVIEW_ORCAROUTER_MODELS: ['orcarouter/auto'],
  KANAREK_REVIEW_OLLAMA_MODELS: ['gpt-oss:120b', 'gpt-oss:20b'],
  KANAREK_REVIEW_GROQ_MODEL: 'openai/gpt-oss-120b',
  KANAREK_REVIEW_VERCEL_MODELS: [
    'tencent/hy3',
    'alibaba/qwen3.8-omni-flash',
    'alibaba/qwen3-coder-30b-a3b',
    'inclusionai/ling-3.1-flash-free',
    'poolside/laguna-s-2.1-free',
  ],
  KANAREK_REVIEW_HUGGINGFACE_MODEL: 'speakleash/Bielik-11B-v3.0-Instruct:publicai',
  KANAREK_REVIEW_DEEPSEEK_MODEL: 'deepseek-flash',
  KANAREK_REVIEW_GEMINI_MODEL: 'gemini-3.8-flash',
  KANAREK_REVIEW_WORKERS_AI_MODEL: '@cf/zai-org/glm-4.7-flash',
  KANAREK_REVIEW_OPENROUTER_MODELS: [
    'stealth/space-bunny-alpha',
    'nvidia/nemotron-3.5-lightning:free',
    'qwen/qwen3.8-27b:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'cohere/north-mini-code:free',
    'openrouter/free',
  ],
} as const;
export const REVIEW_ROUTER_TUNING_DEFAULTS = {
  KANAREK_REVIEW_WORK_TIMEOUT_MS: '300000',
  KANAREK_REVIEW_WORKERS_AI_MAX_OUTPUT_TOKENS: '16384',
  KANAREK_REVIEW_REASONING_MIN_MAX_TOKENS: '16384',
  KANAREK_REVIEW_REASONING_EFFORT: 'high',
  KANAREK_REVIEW_VERCEL_HY3_TEMPERATURE: '0.9',
  KANAREK_REVIEW_VERCEL_HY3_TOP_P: '1',
  KANAREK_REVIEW_GROQ_REASONING_EFFORT: 'high',
  KANAREK_REVIEW_DECISION_PROVIDER_ORDER: 'aihubmix,openrouter,qwencloud,vercel',
  KANAREK_REVIEW_DECISION_TIMEOUT_MS: '25000',
  KANAREK_REVIEW_PAID_PROVIDER_ORDER: 'deepseek,gemini-flex',
  KANAREK_REVIEW_DEEPSEEK_THINKING: 'enabled',
  KANAREK_REVIEW_DEEPSEEK_REASONING_EFFORT: 'max',
  KANAREK_REVIEW_DEEPSEEK_MAX_TOKENS: '131072',
  KANAREK_REVIEW_GEMINI_SERVICE_TIER: 'flex',
} as const;
const DEFAULT_REVIEW_AIHUBMIX_MODELS = REVIEW_ROUTER_MODEL_DEFAULTS.KANAREK_REVIEW_AIHUBMIX_MODELS;
const DEFAULT_WORKERS_AI_REVIEW_MODEL = REVIEW_ROUTER_MODEL_DEFAULTS.KANAREK_REVIEW_WORKERS_AI_MODEL;
const DEFAULT_REVIEW_ORCAROUTER_MODELS = REVIEW_ROUTER_MODEL_DEFAULTS.KANAREK_REVIEW_ORCAROUTER_MODELS;
const DEFAULT_REVIEW_OLLAMA_MODELS = REVIEW_ROUTER_MODEL_DEFAULTS.KANAREK_REVIEW_OLLAMA_MODELS;
const DEFAULT_REVIEW_GROQ_MODEL = REVIEW_ROUTER_MODEL_DEFAULTS.KANAREK_REVIEW_GROQ_MODEL;
const DEFAULT_REVIEW_VERCEL_MODELS = REVIEW_ROUTER_MODEL_DEFAULTS.KANAREK_REVIEW_VERCEL_MODELS;
const VERCEL_HY3_MODEL = 'tencent/hy3';
const DEFAULT_REVIEW_HUGGINGFACE_MODEL = REVIEW_ROUTER_MODEL_DEFAULTS.KANAREK_REVIEW_HUGGINGFACE_MODEL;
const DEFAULT_REVIEW_DEEPSEEK_MODEL = REVIEW_ROUTER_MODEL_DEFAULTS.KANAREK_REVIEW_DEEPSEEK_MODEL;
const DEFAULT_REVIEW_GEMINI_MODEL = REVIEW_ROUTER_MODEL_DEFAULTS.KANAREK_REVIEW_GEMINI_MODEL;
const DEFAULT_REVIEW_OPENROUTER_MODELS = REVIEW_ROUTER_MODEL_DEFAULTS.KANAREK_REVIEW_OPENROUTER_MODELS;
const DEFAULT_FREE_PROVIDER_ORDER = [
  'aihubmix',
  'openrouter',
  'ollama',
  'groq',
  'vercel',
  'orcarouter',
  'huggingface-publicai',
] as const;
type FreeReviewProviderId = (typeof DEFAULT_FREE_PROVIDER_ORDER)[number];
type FreeTaskProfileId = 'general' | 'quip' | 'review' | 'judge' | 'shitpost';

const HIGH_REASONING_TASKS = new Set<FreeTaskProfileId>(['review', 'judge', 'shitpost']);
const VERCEL_REASONING_MODELS = new Set<string>([
  'tencent/hy3',
  'alibaba/qwen3.8-omni-flash',
  'inclusionai/ling-3.1-flash-free',
  'poolside/laguna-s-2.1-free',
]);
const VERCEL_MODEL_MAX_OUTPUT_TOKENS = new Map<string, number>([
  ['alibaba/qwen3.8-omni-flash', 131_072],
  ['alibaba/qwen3-coder-30b-a3b', 8_192],
  ['inclusionai/ling-3.1-flash-free', 32_768],
  ['poolside/laguna-s-2.1-free', 32_768],
]);
const OPENROUTER_REASONING_MODELS = new Set<string>([
  'stealth/space-bunny-alpha',
]);
const GROQ_GPT_OSS_CONTEXT_TOKENS = 131_072;
const GROQ_GPT_OSS_MAX_OUTPUT_TOKENS = 65_536;
const PROVIDER_CONTEXT_BYTES_PER_TOKEN = 1;
const PROVIDER_CONTEXT_SAFETY_TOKENS = 4_096;

const DEFAULT_FREE_TASK_PROVIDER_ORDER = {
  quip: ['aihubmix', 'groq', 'vercel', 'openrouter', 'orcarouter', 'ollama', 'huggingface-publicai'],
  review: ['openrouter', 'aihubmix', 'groq', 'vercel', 'orcarouter', 'ollama', 'huggingface-publicai'],
  judge: ['aihubmix', 'groq', 'vercel', 'openrouter', 'ollama', 'orcarouter', 'huggingface-publicai'],
  shitpost: ['aihubmix', 'vercel', 'groq', 'openrouter', 'orcarouter', 'ollama', 'huggingface-publicai'],
} as const satisfies Record<Exclude<FreeTaskProfileId, 'general'>, readonly FreeReviewProviderId[]>;

const AIHUBMIX_TASK_MODEL_PREFERENCES: Record<FreeTaskProfileId, readonly string[]> = {
  general: DEFAULT_REVIEW_AIHUBMIX_MODELS,
  quip: ['xiaomi-mimo-v2.6-flash-free', 'minimax-m2.7-free', 'dots-3-note-preview-free', 'hy3-free', 'nemotron-3.5-lightning-free', 'coding-kimi-k3-free'],
  review: ['coding-kimi-k3-free', 'nemotron-3.5-lightning-free', 'hy3-free', 'minimax-m2.7-free', 'xiaomi-mimo-v2.6-flash-free', 'dots-3-note-preview-free'],
  judge: ['nemotron-3.5-lightning-free', 'dots-3-note-preview-free', 'minimax-m2.7-free', 'hy3-free', 'xiaomi-mimo-v2.6-flash-free', 'coding-kimi-k3-free'],
  shitpost: ['minimax-m2.7-free', 'xiaomi-mimo-v2.6-flash-free', 'dots-3-note-preview-free', 'hy3-free', 'nemotron-3.5-lightning-free', 'coding-kimi-k3-free'],
};

const VERCEL_TASK_MODEL_PREFERENCES: Record<FreeTaskProfileId, readonly string[]> = {
  general: DEFAULT_REVIEW_VERCEL_MODELS,
  quip: ['inclusionai/ling-3.1-flash-free', 'poolside/laguna-s-2.1-free', 'alibaba/qwen3.8-omni-flash', 'tencent/hy3', 'alibaba/qwen3-coder-30b-a3b'],
  review: ['tencent/hy3', 'alibaba/qwen3-coder-30b-a3b', 'alibaba/qwen3.8-omni-flash', 'inclusionai/ling-3.1-flash-free', 'poolside/laguna-s-2.1-free'],
  judge: ['tencent/hy3', 'alibaba/qwen3.8-omni-flash', 'inclusionai/ling-3.1-flash-free', 'poolside/laguna-s-2.1-free', 'alibaba/qwen3-coder-30b-a3b'],
  shitpost: ['alibaba/qwen3.8-omni-flash', 'inclusionai/ling-3.1-flash-free', 'tencent/hy3', 'poolside/laguna-s-2.1-free', 'alibaba/qwen3-coder-30b-a3b'],
};

const DEFAULT_PAID_PROVIDER_ORDER = ['deepseek', 'gemini-flex'] as const;
type PaidReviewProviderId = (typeof DEFAULT_PAID_PROVIDER_ORDER)[number];
export type ReviewProviderBudgetClass = 'free-quota' | 'monthly-free-credit' | 'daily-neurons' | 'paid-reserve';
const REVIEW_PROVIDER_BUDGET_CLASS: Record<ReviewProviderId, ReviewProviderBudgetClass> = {
  aihubmix: 'free-quota',
  openrouter: 'free-quota',
  orcarouter: 'free-quota',
  ollama: 'free-quota',
  groq: 'free-quota',
  vercel: 'monthly-free-credit',
  'huggingface-publicai': 'free-quota',
  deepseek: 'paid-reserve',
  'gemini-flex': 'paid-reserve',
  'workers-ai': 'daily-neurons',
};
const GROQ_REASONING_EFFORTS = new Set(['low', 'medium', 'high']);
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
  QWEN_API_KEY?: string;
  ORCAROUTER_API_KEY?: string;
  OLLAMA_API_KEY?: string;
  GROQ_API_KEY?: string;
  AI_GATEWAY_API_KEY?: string;
  HUGGINGFACE_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  GEMINI_API_KEY?: string;
  KANAREK_REVIEW_ROUTER_TIMEOUT_MS?: string;
  KANAREK_REVIEW_WORK_TIMEOUT_MS?: string;
  KANAREK_REVIEW_FREE_PROBE_TIMEOUT_MS?: string;
  KANAREK_REVIEW_PROVIDER_ORDER?: string;
  KANAREK_REVIEW_DECISION_PROVIDER_ORDER?: string;
  KANAREK_REVIEW_DECISION_TIMEOUT_MS?: string;
  KANAREK_REVIEW_PAID_PROVIDER_ORDER?: string;
  KANAREK_REVIEW_WORKERS_AI_ENABLED?: string;
  KANAREK_REVIEW_WORKERS_AI_DAILY_NEURONS?: string;
  KANAREK_REVIEW_WORKERS_AI_MODEL?: string;
  KANAREK_REVIEW_WORKERS_AI_MAX_OUTPUT_TOKENS?: string;
  KANAREK_REVIEW_AIHUBMIX_MODELS?: string;
  KANAREK_REVIEW_AIHUBMIX_MODEL?: string;
  KANAREK_REVIEW_ORCAROUTER_MODELS?: string;
  KANAREK_REVIEW_OLLAMA_MODELS?: string;
  KANAREK_REVIEW_GROQ_MODEL?: string;
  KANAREK_REVIEW_GROQ_REASONING_EFFORT?: string;
  KANAREK_REVIEW_VERCEL_MODELS?: string;
  KANAREK_REVIEW_REASONING_MIN_MAX_TOKENS?: string;
  KANAREK_REVIEW_REASONING_EFFORT?: string;
  KANAREK_REVIEW_VERCEL_HY3_TEMPERATURE?: string;
  KANAREK_REVIEW_VERCEL_HY3_TOP_P?: string;
  KANAREK_REVIEW_HUGGINGFACE_MODEL?: string;
  KANAREK_REVIEW_DEEPSEEK_MODEL?: string;
  KANAREK_REVIEW_DEEPSEEK_THINKING?: string;
  KANAREK_REVIEW_DEEPSEEK_REASONING_EFFORT?: string;
  KANAREK_REVIEW_DEEPSEEK_MAX_TOKENS?: string;
  KANAREK_REVIEW_GEMINI_MODEL?: string;
  KANAREK_REVIEW_GEMINI_SERVICE_TIER?: string;
  KANAREK_REVIEW_COOLDOWNS?: DurableObjectNamespace;
  KANAREK_REVIEW_QUOTA_COOLDOWN_MS?: string;
  KANAREK_REVIEW_TRANSIENT_COOLDOWN_MS?: string;
  KANAREK_REVIEW_OPENROUTER_MODELS?: string;
  KANAREK_OPENROUTER_MODELS?: string;
}

type JsonObject = Record<string, unknown>;

type ReviewProviderId = 'aihubmix' | 'openrouter' | 'orcarouter' | 'ollama' | 'groq' | 'vercel' | 'huggingface-publicai' | 'deepseek' | 'gemini-flex' | 'workers-ai';
export type ProviderCooldownId =
  | ReviewProviderId
  | 'aihubmix-decision'
  | 'openrouter-decision'
  | 'qwencloud-decision'
  | 'vercel-decision';

const REVIEW_PROVIDER_IDS: ReadonlySet<string> = new Set<ReviewProviderId>([
  'aihubmix',
  'openrouter',
  'orcarouter',
  'ollama',
  'groq',
  'vercel',
  'huggingface-publicai',
  'deepseek',
  'gemini-flex',
  'workers-ai',
]);

// Comma-separated so a caller can sweep the pool one provider at a time; a
// single id (the judge's independence exclusion) is the one-element case.
export function excludedProviders(request: Request): ReadonlySet<ReviewProviderId> {
  const excluded = new Set<ReviewProviderId>();
  for (const raw of request.headers.get(REVIEW_PROVIDER_EXCLUDE_HEADER)?.split(',') ?? []) {
    const value = raw.trim().toLowerCase();
    if (REVIEW_PROVIDER_IDS.has(value)) excluded.add(value as ReviewProviderId);
  }
  return excluded;
}

type ReviewProvider = {
  id: ReviewProviderId;
  url: string;
  model: string;
  fallbackModels?: readonly string[];
  apiKey: (env: ReviewRouterEnv) => string | undefined;
  headers?: Record<string, string>;
  requestFields?: JsonObject;
  timeoutMs?: number;
};

export type ProviderCooldown = {
  until: number;
  category: string;
};
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

function configuredModelList(raw: string | undefined, fallback: readonly string[]): string[] {
  const configured = raw?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
  return [...new Set(configured.length > 0 ? configured : fallback)];
}

function orderedTaskModels(configured: readonly string[], preferred: readonly string[]): string[] {
  const allowed = new Set(configured);
  const ordered = preferred.filter((model) => allowed.has(model));
  for (const model of configured) if (!ordered.includes(model)) ordered.push(model);
  return ordered;
}

export function reviewRouterTaskProfile(model: unknown): FreeTaskProfileId {
  if (model === REVIEW_ROUTER_QUIP_MODEL) return 'quip';
  if (
    model === REVIEW_ROUTER_CODE_REVIEW_MODEL ||
    model === REVIEW_ROUTER_REVIEW_MODEL ||
    model === REVIEW_ROUTER_PAID_MODEL
  ) return 'review';
  if (model === REVIEW_ROUTER_JUDGE_MODEL) return 'judge';
  if (model === REVIEW_ROUTER_SHITPOST_MODEL) return 'shitpost';
  return 'general';
}

function freeCompletionContract(model: unknown): boolean {
  return model === REVIEW_ROUTER_FREE_MODEL ||
    model === REVIEW_ROUTER_QUIP_MODEL ||
    model === REVIEW_ROUTER_CODE_REVIEW_MODEL ||
    model === REVIEW_ROUTER_JUDGE_MODEL ||
    model === REVIEW_ROUTER_SHITPOST_MODEL;
}

function configuredText(raw: string | undefined, fallback: string): string {
  return raw?.trim() || fallback;
}

function configuredGroqReasoningEffort(raw: string | undefined, fallback: string): string {
  const normalized = raw?.trim().toLowerCase();
  return normalized && GROQ_REASONING_EFFORTS.has(normalized) ? normalized : fallback;
}

function groqSupportsReasoningEffort(model: string): boolean {
  return /(?:^|\/)gpt-oss(?:-|$)/i.test(model) || /^qwen\/qwen3\.8-27b$/i.test(model);
}

function configuredReasoningMinimumMaxTokens(env: ReviewRouterEnv): number {
  return configuredInteger(
    env.KANAREK_REVIEW_REASONING_MIN_MAX_TOKENS,
    Number(REVIEW_ROUTER_TUNING_DEFAULTS.KANAREK_REVIEW_REASONING_MIN_MAX_TOKENS),
    1,
    131_072,
  );
}

function configuredReasoningEffort(env: ReviewRouterEnv): string {
  return configuredText(
    env.KANAREK_REVIEW_REASONING_EFFORT,
    REVIEW_ROUTER_TUNING_DEFAULTS.KANAREK_REVIEW_REASONING_EFFORT,
  );
}

function taskUsesHighReasoning(task: FreeTaskProfileId): boolean {
  return HIGH_REASONING_TASKS.has(task);
}

function configuredInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = raw?.trim();
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function configuredFloat(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = raw?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function taskProviderTimeoutMs(
  baseMs: number,
  task: 'general' | 'quip' | 'review' | 'judge' | 'shitpost',
): number {
  if (task === 'shitpost') return Math.max(baseMs, SHITPOST_TASK_MIN_PROVIDER_TIMEOUT_MS);
  if (task === 'review' || task === 'judge') {
    return Math.max(baseMs, REVIEW_TASK_MIN_PROVIDER_TIMEOUT_MS);
  }
  return baseMs;
}

function workProviderTimeoutMs(env: ReviewRouterEnv): number {
  return configuredInteger(
    env.KANAREK_REVIEW_WORK_TIMEOUT_MS,
    DEFAULT_WORK_PROVIDER_TIMEOUT_MS,
    MIN_TIMEOUT_MS,
    10 * 60_000,
  );
}

function workersAiModel(env: ReviewRouterEnv): string {
  return configuredText(env.KANAREK_REVIEW_WORKERS_AI_MODEL, DEFAULT_WORKERS_AI_REVIEW_MODEL);
}

function workersAiMaxOutputTokens(env: ReviewRouterEnv): number {
  return configuredInteger(
    env.KANAREK_REVIEW_WORKERS_AI_MAX_OUTPUT_TOKENS,
    Number(REVIEW_ROUTER_TUNING_DEFAULTS.KANAREK_REVIEW_WORKERS_AI_MAX_OUTPUT_TOKENS),
    1,
    131_072,
  );
}

function configuredFreeProviderOrder(raw: string | undefined): FreeReviewProviderId[] {
  const allowed = new Set<string>(DEFAULT_FREE_PROVIDER_ORDER);
  const ordered: FreeReviewProviderId[] = [];
  const seen = new Set<FreeReviewProviderId>();
  for (const value of raw?.split(',') ?? []) {
    const normalized = value.trim().toLowerCase();
    if (!allowed.has(normalized)) continue;
    const provider = normalized as FreeReviewProviderId;
    if (seen.has(provider)) continue;
    seen.add(provider);
    ordered.push(provider);
  }
  for (const provider of DEFAULT_FREE_PROVIDER_ORDER) {
    if (!seen.has(provider)) ordered.push(provider);
  }
  return ordered;
}

function configuredTaskFreeProviderOrder(
  env: ReviewRouterEnv,
  task: FreeTaskProfileId,
): FreeReviewProviderId[] {
  if (task === 'general') return configuredFreeProviderOrder(env.KANAREK_REVIEW_PROVIDER_ORDER);
  return [...DEFAULT_FREE_TASK_PROVIDER_ORDER[task]];
}

function freeProviderOrder(
  env: ReviewRouterEnv,
  task: FreeTaskProfileId = 'general',
): ReviewProviderId[] {
  return [...configuredTaskFreeProviderOrder(env, task), 'workers-ai'];
}

function configuredPaidProviderOrder(raw: string | undefined): PaidReviewProviderId[] {
  const allowed = new Set<string>(DEFAULT_PAID_PROVIDER_ORDER);
  const ordered: PaidReviewProviderId[] = [];
  const seen = new Set<PaidReviewProviderId>();
  for (const value of raw?.split(',') ?? []) {
    const normalized = value.trim().toLowerCase();
    if (!allowed.has(normalized)) continue;
    const provider = normalized as PaidReviewProviderId;
    if (seen.has(provider)) continue;
    seen.add(provider);
    ordered.push(provider);
  }
  for (const provider of DEFAULT_PAID_PROVIDER_ORDER) {
    if (!seen.has(provider)) ordered.push(provider);
  }
  return ordered;
}

function providers(
  env: ReviewRouterEnv,
  includePaidReserves = false,
  task: FreeTaskProfileId = 'general',
): readonly ReviewProvider[] {
  const reviewOpenRouterModels = env.KANAREK_REVIEW_OPENROUTER_MODELS?.trim();
  const sharedOpenRouterModels = env.KANAREK_OPENROUTER_MODELS?.trim();
  const openRouterModels = configuredModelList(
    reviewOpenRouterModels || sharedOpenRouterModels,
    DEFAULT_REVIEW_OPENROUTER_MODELS,
  );
  const aihubMixConfigured = configuredModelList(
    env.KANAREK_REVIEW_AIHUBMIX_MODELS?.trim() || env.KANAREK_REVIEW_AIHUBMIX_MODEL?.trim(),
    DEFAULT_REVIEW_AIHUBMIX_MODELS,
  );
  const aihubMixModels = orderedTaskModels(
    aihubMixConfigured,
    AIHUBMIX_TASK_MODEL_PREFERENCES[task],
  );
  const orcaRouterModels = configuredModelList(
    env.KANAREK_REVIEW_ORCAROUTER_MODELS,
    DEFAULT_REVIEW_ORCAROUTER_MODELS,
  );
  const ollamaModels = configuredModelList(
    env.KANAREK_REVIEW_OLLAMA_MODELS,
    DEFAULT_REVIEW_OLLAMA_MODELS,
  );
  const vercelConfigured = configuredModelList(
    env.KANAREK_REVIEW_VERCEL_MODELS,
    DEFAULT_REVIEW_VERCEL_MODELS,
  );
  const vercelModels = orderedTaskModels(
    vercelConfigured,
    VERCEL_TASK_MODEL_PREFERENCES[task],
  );
  const unorderedFreeProviders: ReviewProvider[] = [
    {
      id: 'aihubmix',
      url: 'https://aihubmix.com/v1/chat/completions',
      model: aihubMixModels[0] ?? DEFAULT_REVIEW_AIHUBMIX_MODELS[0],
      fallbackModels: aihubMixModels.slice(1),
      apiKey: (providerEnv) => providerEnv.AIHUBMIX_API_KEY,
      timeoutMs: reviewFreeProbeTimeoutMs(
        env.KANAREK_REVIEW_FREE_PROBE_TIMEOUT_MS,
        timeoutMs(env),
      ),
    },
    {
      id: 'openrouter',
      url: 'https://openrouter.ai/api/v1/chat/completions',
      model: openRouterModels[0],
      fallbackModels: openRouterModels.slice(1),
      apiKey: (providerEnv) => providerEnv.OPENROUTER_API_KEY,
      headers: { 'X-Title': `Kanarek ${task}` },
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
    {
      id: 'vercel',
      url: 'https://ai-gateway.vercel.sh/v1/chat/completions',
      model: vercelModels[0] ?? DEFAULT_REVIEW_VERCEL_MODELS[0],
      fallbackModels: vercelModels.slice(1),
      apiKey: (providerEnv) => providerEnv.AI_GATEWAY_API_KEY,
    },
    {
      // Tried before the credit-backed HF reserve. The workspace-owned orcarouter/auto
      // route is the maintained resolver for the current free-model set, so this code does not
      // pin rotating model aliases. Cost policy is configured on the OrcaRouter workspace.
      id: 'orcarouter',
      url: 'https://api.orcarouter.ai/v1/chat/completions',
      model: orcaRouterModels[0] ?? DEFAULT_REVIEW_ORCAROUTER_MODELS[0],
      fallbackModels: orcaRouterModels.slice(1),
      apiKey: (providerEnv) => providerEnv.ORCAROUTER_API_KEY,
      timeoutMs: reviewFreeProbeTimeoutMs(env.KANAREK_REVIEW_FREE_PROBE_TIMEOUT_MS),
    },
    {
      // Final HTTP reserve. The :publicai suffix prevents HF from silently selecting
      // another inference provider when the Public AI route is unavailable.
      id: 'huggingface-publicai',
      url: 'https://router.huggingface.co/v1/chat/completions',
      model: env.KANAREK_REVIEW_HUGGINGFACE_MODEL?.trim() || DEFAULT_REVIEW_HUGGINGFACE_MODEL,
      apiKey: (providerEnv) => providerEnv.HUGGINGFACE_API_KEY,
    },
  ];
  const freeProviders = configuredTaskFreeProviderOrder(env, task)
    .map((id) => unorderedFreeProviders.find((provider) => provider.id === id))
    .filter((provider): provider is ReviewProvider => Boolean(provider));
  if (!includePaidReserves) return freeProviders;
  return [...freeProviders, ...paidProviders(env)];
}

function deepSeekPaidProvider(
  env: ReviewRouterEnv,
  mode: 'review' | 'work',
): ReviewProvider {
  return {
    id: 'deepseek',
    url: 'https://api.deepseek.com/chat/completions',
    model: env.KANAREK_REVIEW_DEEPSEEK_MODEL?.trim() || DEFAULT_REVIEW_DEEPSEEK_MODEL,
    apiKey: (providerEnv) => providerEnv.DEEPSEEK_API_KEY,
    timeoutMs: mode === 'work' ? workProviderTimeoutMs(env) : MAX_TIMEOUT_MS,
    requestFields: {
      thinking: {
        type: configuredText(
          env.KANAREK_REVIEW_DEEPSEEK_THINKING,
          REVIEW_ROUTER_TUNING_DEFAULTS.KANAREK_REVIEW_DEEPSEEK_THINKING,
        ),
      },
      reasoning_effort: configuredText(
        env.KANAREK_REVIEW_DEEPSEEK_REASONING_EFFORT,
        REVIEW_ROUTER_TUNING_DEFAULTS.KANAREK_REVIEW_DEEPSEEK_REASONING_EFFORT,
      ),
      max_tokens: configuredInteger(
        env.KANAREK_REVIEW_DEEPSEEK_MAX_TOKENS,
        Number(REVIEW_ROUTER_TUNING_DEFAULTS.KANAREK_REVIEW_DEEPSEEK_MAX_TOKENS),
        1,
        131_072,
      ),
      ...(mode === 'review' ? { response_format: { type: 'json_object' } } : {}),
    },
  };
}

function geminiPaidProvider(env: ReviewRouterEnv): ReviewProvider {
  return {
    id: 'gemini-flex',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    model: env.KANAREK_REVIEW_GEMINI_MODEL?.trim() || DEFAULT_REVIEW_GEMINI_MODEL,
    apiKey: (providerEnv) => providerEnv.GEMINI_API_KEY,
    timeoutMs: MAX_TIMEOUT_MS,
    requestFields: {
      service_tier: configuredText(
        env.KANAREK_REVIEW_GEMINI_SERVICE_TIER,
        REVIEW_ROUTER_TUNING_DEFAULTS.KANAREK_REVIEW_GEMINI_SERVICE_TIER,
      ),
    },
  };
}

function paidProvidersForMode(
  env: ReviewRouterEnv,
  mode: 'review' | 'work',
): readonly ReviewProvider[] {
  const providersById: Record<PaidReviewProviderId, ReviewProvider> = {
    deepseek: deepSeekPaidProvider(env, mode),
    'gemini-flex': geminiPaidProvider(env),
  };
  return configuredPaidProviderOrder(env.KANAREK_REVIEW_PAID_PROVIDER_ORDER)
    .map((id) => providersById[id]);
}

function paidProviders(env: ReviewRouterEnv): readonly ReviewProvider[] {
  return paidProvidersForMode(env, 'review');
}

function workProviders(env: ReviewRouterEnv): readonly ReviewProvider[] {
  return paidProvidersForMode(env, 'work');
}


function workersAiInput(input: JsonObject, env: ReviewRouterEnv): ChatCompletionsInput | null {
  if (!Array.isArray(input.messages)) return null;
  const request = { ...input };
  delete request.model;
  delete request.models;
  delete request.stream_options;
  const requestedMax = typeof request.max_tokens === 'number' && Number.isFinite(request.max_tokens)
    ? request.max_tokens
    : typeof request.max_completion_tokens === 'number' && Number.isFinite(request.max_completion_tokens)
      ? request.max_completion_tokens
      : workersAiMaxOutputTokens(env);
  request.max_tokens = Math.min(
    Math.max(1, Math.ceil(requestedMax)),
    workersAiMaxOutputTokens(env),
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

function workersAiResponse(result: ChatCompletionsOutput, model: string): Response {
  return Response.json(
    { ...result, model },
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

function usableFreeCompletionPayload(value: unknown): boolean {
  if (!isObject(value) || !Array.isArray(value.choices)) return false;
  return value.choices.some((choice) => {
    if (!isObject(choice) || !isObject(choice.message)) return false;
    const message = choice.message;
    if (typeof message.content === 'string' && message.content.trim()) return true;
    if (typeof message.refusal === 'string' && message.refusal.trim()) return true;
    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return true;
    return isObject(message.function_call);
  });
}

async function usableFreeCompletionResponse(response: Response, input: JsonObject): Promise<boolean> {
  if (!freeCompletionContract(input.model) || input.stream === true) return true;
  try {
    return usableFreeCompletionPayload(await response.clone().json());
  } catch {
    return false;
  }
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

export function reviewFreeProbeTimeoutMs(
  raw: string | undefined,
  routerTimeoutMs = DEFAULT_TIMEOUT_MS,
): number {
  const value = raw?.trim();
  let configured = DEFAULT_FREE_PROBE_TIMEOUT_MS;
  if (value && /^\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    if (
      Number.isSafeInteger(parsed)
      && parsed >= MIN_TIMEOUT_MS
      && parsed <= DEFAULT_TIMEOUT_MS
    ) {
      configured = parsed;
    }
  }
  return Math.min(configured, routerTimeoutMs);
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
  if (
    category === 'soft_quota' ||
    category === 'http_401' ||
    category === 'http_402' ||
    category === 'http_403' ||
    category === 'http_429'
  ) {
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
  provider: ProviderCooldownId,
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

function workersAiNeuronReservation(input: ChatCompletionsInput, env: ReviewRouterEnv): number {
  const maxTokens = typeof input.max_tokens === 'number'
    ? input.max_tokens
    : workersAiMaxOutputTokens(env);
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
    neurons: workersAiNeuronReservation(input, env),
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

export async function activeProviderCooldown(
  env: ReviewRouterEnv,
  provider: ProviderCooldownId,
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
    budgetClass: ReviewProviderBudgetClass;
    configured: boolean;
    cooldown?: { category: string; until: number };
    provider: ReviewProviderId;
  }>;
  ready: boolean;
  freeOrder: ReviewProviderId[];
  taskOrders: Record<FreeTaskProfileId, ReviewProviderId[]>;
}> {
  const states = await Promise.all(
    providers(env, true).map(async (provider) => {
      const configured = Boolean(provider.apiKey(env)?.trim());
      if (!configured) {
        return {
          available: false,
          budgetClass: REVIEW_PROVIDER_BUDGET_CLASS[provider.id],
          configured: false,
          provider: provider.id,
        };
      }
      const cooldown = await activeProviderCooldown(env, provider.id);
      return cooldown
        ? {
            available: false,
            budgetClass: REVIEW_PROVIDER_BUDGET_CLASS[provider.id],
            configured: true,
            cooldown,
            provider: provider.id,
          }
        : {
            available: true,
            budgetClass: REVIEW_PROVIDER_BUDGET_CLASS[provider.id],
            configured: true,
            provider: provider.id,
          };
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
      ? {
          available: false,
          budgetClass: REVIEW_PROVIDER_BUDGET_CLASS['workers-ai'],
          configured: false,
          provider: 'workers-ai',
        }
      : workersAiCooldown
        ? {
            available: false,
            budgetClass: REVIEW_PROVIDER_BUDGET_CLASS['workers-ai'],
            configured: true,
            cooldown: workersAiCooldown,
            provider: 'workers-ai',
          }
        : workersAiBudget && workersAiBudget.remaining > 0
          ? {
              available: true,
              budgetClass: REVIEW_PROVIDER_BUDGET_CLASS['workers-ai'],
              configured: true,
              provider: 'workers-ai',
            }
          : {
              available: false,
              budgetClass: REVIEW_PROVIDER_BUDGET_CLASS['workers-ai'],
              configured: true,
              provider: 'workers-ai',
            },
  );
  const configured = states.filter((state) => state.configured).length;
  const available = states.filter((state) => state.available).length;
  return {
    available,
    configured,
    providers: states,
    ready: available > 0,
    freeOrder: freeProviderOrder(env),
    taskOrders: {
      general: freeProviderOrder(env, 'general'),
      quip: freeProviderOrder(env, 'quip'),
      review: freeProviderOrder(env, 'review'),
      judge: freeProviderOrder(env, 'judge'),
      shitpost: freeProviderOrder(env, 'shitpost'),
    },
  };
}

export async function rememberProviderCooldown(
  provider: ProviderCooldownId,
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
  minimumMaxTokens?: number;
  maximumMaxTokens?: number;
  maximumContextTokens?: number;
  requestFields?: JsonObject;
};

function conservativeProviderInputTokens(input: JsonObject): number {
  const bytes = new TextEncoder().encode(JSON.stringify(input)).byteLength;
  return Math.ceil(bytes / PROVIDER_CONTEXT_BYTES_PER_TOKEN) + PROVIDER_CONTEXT_SAFETY_TOKENS;
}

export function fitProviderAttemptTokenBudget(
  input: JsonObject,
  attempt: Pick<ProviderAttempt, 'minimumMaxTokens' | 'maximumMaxTokens' | 'maximumContextTokens'>,
): JsonObject | null {
  const request = { ...input };
  const requestedMaxTokens = Math.max(
    typeof request.max_tokens === 'number' && Number.isFinite(request.max_tokens)
      ? request.max_tokens
      : 0,
    typeof request.max_completion_tokens === 'number' &&
        Number.isFinite(request.max_completion_tokens)
      ? request.max_completion_tokens
      : 0,
  );
  const minimum = attempt.minimumMaxTokens ?? 1;
  let maximum = attempt.maximumMaxTokens ?? Number.MAX_SAFE_INTEGER;

  if (attempt.maximumContextTokens) {
    const available = attempt.maximumContextTokens - conservativeProviderInputTokens(request);
    if (available < minimum) return null;
    maximum = Math.min(maximum, available);
  }

  if (requestedMaxTokens > 0 || attempt.minimumMaxTokens) {
    let effective = Math.max(minimum, Math.ceil(requestedMaxTokens || minimum));
    effective = Math.min(effective, maximum);
    if (effective < minimum) return null;
    request.max_tokens = effective;
    delete request.max_completion_tokens;
  }
  return request;
}

function groqTokenLimits(model: string): {
  maximumContextTokens?: number;
  maximumMaxTokens?: number;
} {
  if (model === 'openai/gpt-oss-120b' || model === 'openai/gpt-oss-20b') {
    return {
      maximumContextTokens: GROQ_GPT_OSS_CONTEXT_TOKENS,
      maximumMaxTokens: GROQ_GPT_OSS_MAX_OUTPUT_TOKENS,
    };
  }
  return {};
}

function providerAttempts(
  provider: ReviewProvider,
  env: ReviewRouterEnv,
  task: FreeTaskProfileId,
): readonly ProviderAttempt[] {
  if (provider.id === 'groq') {
    // The legacy/general lane keeps provider defaults for backward compatibility.
    // Task-specific aliases are the only place where this router adds reasoning_effort.
    if (task === 'general') return [{ model: provider.model, label: 'default' }];
    const supportsReasoning = groqSupportsReasoningEffort(provider.model);
    const effort = task === 'review'
      ? configuredGroqReasoningEffort(
          env.KANAREK_REVIEW_GROQ_REASONING_EFFORT,
          REVIEW_ROUTER_TUNING_DEFAULTS.KANAREK_REVIEW_GROQ_REASONING_EFFORT,
        )
      : task === 'judge' || task === 'shitpost'
        ? 'high'
        : task === 'quip'
          ? 'low'
          : 'medium';
    return [{
      model: provider.model,
      label: 'default',
      ...groqTokenLimits(provider.model),
      ...(supportsReasoning
        ? {
            minimumMaxTokens: configuredReasoningMinimumMaxTokens(env),
            requestFields: { reasoning_effort: effort },
          }
        : {}),
    }];
  }
  if (provider.id === 'openrouter') {
    const fallbackModels = provider.fallbackModels ?? [];
    const useReasoning = taskUsesHighReasoning(task);
    const primaryReasoning = useReasoning && OPENROUTER_REASONING_MODELS.has(provider.model);
    const reasoningEffort = configuredReasoningEffort(env);
    const primaryAttempt: ProviderAttempt = {
      model: provider.model,
      label: fallbackModels.length ? 'primary_only' : 'default',
      ...(primaryReasoning
        ? {
            minimumMaxTokens: configuredReasoningMinimumMaxTokens(env),
            requestFields: { reasoning: { effort: reasoningEffort } },
          }
        : {}),
    };
    if (!fallbackModels.length) return [primaryAttempt];
    return [
      {
        model: provider.model,
        fallbackModels,
        label: 'fallback_chain',
      },
      primaryAttempt,
    ];
  }
  if (
    (provider.id === 'aihubmix' || provider.id === 'orcarouter' || provider.id === 'ollama')
    && provider.fallbackModels?.length
  ) {
    return [provider.model, ...provider.fallbackModels].map((model, index) => ({
      model,
      label: index === 0 ? 'default' : 'model_fallback',
    }));
  }
  if (provider.id === 'vercel') {
    return [provider.model, ...(provider.fallbackModels ?? [])].map((model, index) => {
      const useReasoning = taskUsesHighReasoning(task) && VERCEL_REASONING_MODELS.has(model);
      const maximumMaxTokens = VERCEL_MODEL_MAX_OUTPUT_TOKENS.get(model);
      return {
        model,
        label: index === 0 ? 'default' : 'model_fallback',
        ...(maximumMaxTokens ? { maximumMaxTokens } : {}),
        ...(useReasoning
          ? {
              minimumMaxTokens: configuredReasoningMinimumMaxTokens(env),
              requestFields: {
                reasoning: { effort: configuredReasoningEffort(env) },
                ...(model === VERCEL_HY3_MODEL
                  ? {
                      temperature: configuredFloat(
                        env.KANAREK_REVIEW_VERCEL_HY3_TEMPERATURE,
                        Number(REVIEW_ROUTER_TUNING_DEFAULTS.KANAREK_REVIEW_VERCEL_HY3_TEMPERATURE),
                        0,
                        2,
                      ),
                      top_p: configuredFloat(
                        env.KANAREK_REVIEW_VERCEL_HY3_TOP_P,
                        Number(REVIEW_ROUTER_TUNING_DEFAULTS.KANAREK_REVIEW_VERCEL_HY3_TOP_P),
                        0,
                        1,
                      ),
                    }
                  : {}),
              },
            }
          : {}),
      };
    });
  }
  if (provider.id === 'gemini-flex') {
    return [{
      model: provider.model,
      label: 'default',
      minimumMaxTokens: configuredReasoningMinimumMaxTokens(env),
      requestFields: { reasoning_effort: configuredReasoningEffort(env) },
    }];
  }
  return [{ model: provider.model, label: 'default' }];
}

function shouldTryNextAttempt(
  provider: ReviewProvider,
  status: number,
  category: string,
  attemptIndex: number,
  attemptCount: number,
): boolean {
  if (attemptIndex + 1 >= attemptCount) return false;
  if (provider.id === 'openrouter') return status === 400;
  if (provider.id === 'aihubmix') {
    if (status === 400) {
      return category === 'http_400_invalid_model' ||
        category === 'http_400_unsupported_parameter';
    }
    return status === 402 || status === 404 || status === 408 || status === 409 ||
      status === 425 || status === 429 || status >= 500;
  }
  if (provider.id === 'orcarouter') {
    return status === 402 || status === 404 || status === 408 || status === 409 ||
      status === 425 || status === 429 || status >= 500;
  }
  if (provider.id === 'ollama') {
    return status === 400 || status === 402 || status === 404 || status === 408 ||
      status === 409 || status === 425 || status === 429 || status >= 500;
  }
  if (provider.id === 'vercel') {
    if (status === 400) {
      return category === 'http_400_invalid_model' ||
        category === 'http_400_unsupported_parameter';
    }
    return status === 402 || status === 404 || status === 408 || status === 409 ||
      status === 425 || status === 429 || status >= 500;
  }
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
      data: [
        { id: REVIEW_ROUTER_FREE_MODEL, object: 'model', owned_by: 'kanarek' },
        { id: REVIEW_ROUTER_QUIP_MODEL, object: 'model', owned_by: 'kanarek' },
        { id: REVIEW_ROUTER_CODE_REVIEW_MODEL, object: 'model', owned_by: 'kanarek' },
        { id: REVIEW_ROUTER_JUDGE_MODEL, object: 'model', owned_by: 'kanarek' },
        { id: REVIEW_ROUTER_SHITPOST_MODEL, object: 'model', owned_by: 'kanarek' },
        { id: REVIEW_ROUTER_REVIEW_MODEL, object: 'model', owned_by: 'kanarek' },
        { id: REVIEW_ROUTER_PAID_MODEL, object: 'model', owned_by: 'kanarek' },
        { id: REVIEW_ROUTER_WORK_MODEL, object: 'model', owned_by: 'kanarek' },
      ],
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

  const paidOnly = input.model === REVIEW_ROUTER_PAID_MODEL;
  const workOnly = input.model === REVIEW_ROUTER_WORK_MODEL;
  const includePaidReserves = input.model === REVIEW_ROUTER_REVIEW_MODEL;
  const task = reviewRouterTaskProfile(input.model);
  const excluded = excludedProviders(request);
  let configured = 0;
  let invalidRequests = 0;
  const failures: string[] = [];

  const selectedProviders = workOnly
    ? workProviders(env)
    : paidOnly
      ? paidProviders(env)
      : providers(env, includePaidReserves, task);
  for (const provider of selectedProviders) {
    if (excluded.has(provider.id)) {
      console.info(JSON.stringify({
        kanarekReviewRouter: 'provider_excluded', provider: provider.id,
      }));
      continue;
    }
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
    const providerTimeoutMs = taskProviderTimeoutMs(
      provider.timeoutMs ?? timeoutMs(env),
      task,
    );
    const providerDeadlineAt = Date.now() + providerTimeoutMs;
    const attempts = providerAttempts(provider, env, task);
    let providerFailureCategory = 'unknown';
    let providerInvalidRequest = true;

    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const attempt = attempts[attemptIndex];
      const remainingProviderMs = Math.max(0, providerDeadlineAt - Date.now());
      const attemptTimeoutMs = remainingProviderMs;
      if (attemptTimeoutMs <= 0) {
        providerFailureCategory = 'timeout';
        providerInvalidRequest = false;
        break;
      }
      const controller = new AbortController();
      const deadlineAt = Date.now() + attemptTimeoutMs;
      const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);
      try {
        const providerInput: JsonObject = {
          ...input,
          ...provider.requestFields,
          ...attempt.requestFields,
          model: attempt.model,
          ...(attempt.fallbackModels?.length ? { models: attempt.fallbackModels } : { models: undefined }),
        };
        const fittedProviderInput = fitProviderAttemptTokenBudget(providerInput, attempt);
        if (!fittedProviderInput) {
          providerFailureCategory = 'context_budget';
          providerInvalidRequest = false;
          console.info(JSON.stringify({
            kanarekReviewRouter: 'provider_skipped',
            provider: provider.id,
            category: providerFailureCategory,
            attempt: attempt.label,
            model: attempt.model,
          }));
          continue;
        }
        const response = await fetcher(provider.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            ...provider.headers,
          },
          body: JSON.stringify(fittedProviderInput),
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
          if (!(await usableFreeCompletionResponse(response, input))) {
            await discard(response);
            providerFailureCategory = 'invalid_response';
            providerInvalidRequest = false;
            console.warn(JSON.stringify({
              kanarekReviewRouter: 'provider_failed',
              provider: provider.id,
              category: providerFailureCategory,
              attempt: attempt.label,
              model: attempt.model,
            }));
            if (
              (provider.id === 'aihubmix' || provider.id === 'vercel' || provider.id === 'openrouter')
              && attemptIndex + 1 < attempts.length
            ) continue;
            break;
          }
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

        if (shouldTryNextAttempt(
          provider,
          status,
          providerFailureCategory,
          attemptIndex,
          attempts.length,
        )) {
          continue;
        }
        if (status === 400 || retryableStatus(status)) break;
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
        if (
          provider.id === 'aihubmix'
          && category !== 'timeout'
          && attemptIndex + 1 < attempts.length
          && Date.now() < providerDeadlineAt
        ) continue;
        if (
          provider.id === 'vercel'
          && category !== 'timeout'
          && attemptIndex + 1 < attempts.length
          && Date.now() < providerDeadlineAt
        ) continue;
        break;
      } finally {
        clearTimeout(timeout);
      }
    }
    await rememberProviderCooldown(provider.id, providerFailureCategory, env);
    failures.push(diagnostic(provider, providerFailureCategory));
    if (providerInvalidRequest) invalidRequests += 1;
  }


  if (!paidOnly && !workOnly && workersAiEnabled(env) && !excluded.has('workers-ai')) {
    configured += 1;
    const provider: ReviewProviderId = 'workers-ai';
    const workersModel = workersAiModel(env);
    const cooldown = await activeProviderCooldown(env, provider);
    if (cooldown) {
      failures.push(diagnostic(provider, `cooldown_${cooldown.category}`));
      console.info(JSON.stringify({
        kanarekReviewRouter: 'provider_cooldown', provider, category: cooldown.category,
      }));
    } else {
      const bindingInput = workersAiInput(input, env);
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
            kanarekReviewRouter: 'provider_failed', provider, category, model: workersModel,
          }));
        } else {
          const reservation = reservationResult.reservation;
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            const result = await Promise.race([
              env.AI!.run(workersModel, bindingInput),
              new Promise<never>((_, reject) => {
                timeout = setTimeout(
                  () => reject(new DOMException('Workers AI timed out', 'AbortError')),
                  taskProviderTimeoutMs(timeoutMs(env), task),
                );
              }),
            ]) as ChatCompletionsOutput;
            await settleWorkersAiNeurons(
              env,
              reservation,
              workersAiActualNeurons(result) ?? reservation.neurons,
            );
            console.info(JSON.stringify({
              kanarekReviewRouter: 'selected', provider, attempt: 'binding', model: workersModel,
            }));
            return workersAiResponse(result, workersModel);
          } catch (error) {
            await settleWorkersAiNeurons(env, reservation, reservation.neurons);
            const category = workersAiFailureCategory(error);
            await rememberProviderCooldown(provider, category, env);
            failures.push(diagnostic(provider, category));
            console.warn(JSON.stringify({
              kanarekReviewRouter: 'provider_failed', provider, category, model: workersModel,
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
