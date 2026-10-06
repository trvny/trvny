import { bearerAuthorized } from '../../kanarek-companion/src/auth.ts';
import { REVIEW_DECISION_PATH } from '../../kanarek-companion/src/review-service-protocol.ts';
import {
  activeProviderCooldown,
  rememberProviderCooldown,
  REVIEW_ROUTER_TUNING_DEFAULTS,
  type ProviderCooldownId,
  type ReviewRouterEnv,
} from './review-router.ts';

type DecisionProviderId = 'aihubmix' | 'openrouter' | 'qwencloud' | 'vercel';

type DecisionProvider = {
  id: DecisionProviderId;
  cooldownId: ProviderCooldownId;
  endpoint: string;
  models: readonly string[];
  apiKey: (env: DecisionModelEnv) => string | undefined;
};

const DECISION_PROVIDERS: Record<DecisionProviderId, DecisionProvider> = {
  aihubmix: {
    id: 'aihubmix',
    cooldownId: 'aihubmix-decision',
    endpoint: 'https://aihubmix.com/v1/systemone',
    models: ['decision-model-preview'],
    apiKey: (env) => env.AIHUBMIX_API_KEY,
  },
  openrouter: {
    id: 'openrouter',
    cooldownId: 'openrouter-decision',
    endpoint: 'https://openrouter.ai/api/alpha/decisions',
    models: [
      'inception/mercury-decide:free',
      'respan/span-01-lite:free',
    ],
    apiKey: (env) => env.OPENROUTER_API_KEY,
  },
  qwencloud: {
    id: 'qwencloud',
    cooldownId: 'qwencloud-decision',
    endpoint: 'https://trial.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/systemone',
    models: ['decision-model-preview'],
    apiKey: (env) => env.QWEN_API_KEY,
  },
  vercel: {
    id: 'vercel',
    cooldownId: 'vercel-decision',
    endpoint: 'https://ai-gateway.vercel.sh/typesafe/v1/systemone',
    models: ['convaiinnovations/laya-free'],
    apiKey: (env) => env.AI_GATEWAY_API_KEY,
  },
};
const DECISION_PROVIDER_IDS = new Set<DecisionProviderId>(
  Object.keys(DECISION_PROVIDERS) as DecisionProviderId[],
);
const DEFAULT_TIMEOUT_MS = Number(REVIEW_ROUTER_TUNING_DEFAULTS.KANAREK_REVIEW_DECISION_TIMEOUT_MS);
const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_QUESTIONS = 16;
const MIN_LATER_PROVIDER_RESERVE_MS = 5_000;
const MIN_LATER_MODEL_RESERVE_MS = 3_000;

export type DecisionModelEnv = ReviewRouterEnv;

type DecisionQuestion = {
  criteria?: unknown;
  instructions?: unknown;
  type?: unknown;
};

const DECISION_ERROR_HEADER = 'x-kanarek-review-decision-error';

function diagnosticToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized ? normalized.slice(0, 64) : null;
}

function jsonError(
  message: string,
  error: string,
  status: number,
  decisionError = error,
): Response {
  return Response.json(
    { error: { message, type: error } },
    {
      status,
      headers: {
        'cache-control': 'no-store',
        [DECISION_ERROR_HEADER]: diagnosticToken(decisionError) ?? 'unknown',
      },
    },
  );
}

async function providerErrorReason(response: Response): Promise<string> {
  let detail: string | null = null;
  try {
    const payload: unknown = await response.json();
    if (plainObject(payload)) {
      const error = plainObject(payload.error) ? payload.error : payload;
      detail = diagnosticToken(error.code) ?? diagnosticToken(error.type);
    }
  } catch {
    // HTTP status remains sufficient and avoids surfacing upstream response text.
  }
  return `provider_http_${response.status}${detail ? `_${detail}` : ''}`;
}

function timeoutMs(env: DecisionModelEnv): number {
  const raw = env.KANAREK_REVIEW_DECISION_TIMEOUT_MS?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed >= MIN_TIMEOUT_MS && parsed <= MAX_TIMEOUT_MS
    ? parsed
    : DEFAULT_TIMEOUT_MS;
}

export function decisionProviderTimeoutMs(env: DecisionModelEnv): number {
  return timeoutMs(env);
}

function configuredDecisionProviderOrder(env: DecisionModelEnv): DecisionProviderId[] {
  const fallback = REVIEW_ROUTER_TUNING_DEFAULTS.KANAREK_REVIEW_DECISION_PROVIDER_ORDER
    .split(',') as DecisionProviderId[];
  const configured = env.KANAREK_REVIEW_DECISION_PROVIDER_ORDER
    ?.split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is DecisionProviderId =>
      DECISION_PROVIDER_IDS.has(value as DecisionProviderId)
    ) ?? [];
  return [...new Set(configured.length ? configured : fallback)];
}

function stableDecisionHash(value: unknown): number {
  const text = JSON.stringify(value) ?? '';
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function decisionProviderOrder(
  input: Record<string, unknown>,
  env: DecisionModelEnv,
): DecisionProviderId[] {
  const order = configuredDecisionProviderOrder(env);
  if (order.length < 2) return order;
  const offset = stableDecisionHash(input.state) % order.length;
  return [...order.slice(offset), ...order.slice(0, offset)];
}

export function decisionProviderBudgetMs(
  remainingMs: number,
  laterProviders: number,
): number {
  const safeRemainingMs = Math.max(0, Math.floor(remainingMs));
  if (safeRemainingMs <= 0) return 0;
  const reserveMs = Math.min(
    safeRemainingMs,
    Math.max(0, laterProviders) * MIN_LATER_PROVIDER_RESERVE_MS,
  );
  return Math.max(1, safeRemainingMs - reserveMs);
}

export function decisionModelAttemptTimeoutMs(
  providerRemainingMs: number,
  poolRemainingMs: number,
  laterModels: number,
): number {
  const providerMs = Math.max(0, Math.floor(providerRemainingMs));
  const poolMs = Math.max(0, Math.floor(poolRemainingMs));
  const ceilingMs = Math.min(providerMs, poolMs);
  if (ceilingMs <= 0) return 0;
  const reserveMs = Math.min(
    providerMs,
    Math.max(0, laterModels) * MIN_LATER_MODEL_RESERVE_MS,
  );
  const rawAttemptMs = Math.max(1, providerMs - reserveMs);
  return Math.min(ceilingMs, Math.max(1_000, rawAttemptMs));
}

type DecisionDeadlineResult<T> =
  | { timedOut: false; value: T }
  | { timedOut: true };

export async function withinDecisionDeadline<T>(
  deadlineAt: number,
  operation: () => Promise<T>,
): Promise<DecisionDeadlineResult<T>> {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) return { timedOut: true };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation()
        .then((value) => ({ timedOut: false as const, value }))
        .catch(() => ({ timedOut: true as const })),
      new Promise<DecisionDeadlineResult<T>>((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), remainingMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validChoiceCriteria(value: unknown): boolean {
  if (!plainObject(value)) return false;
  const entries = Object.entries(value);
  return entries.length >= 1 && entries.length <= 255 &&
    entries.every(([key, description]) =>
      key.length >= 1 &&
      key.length <= 128 &&
      typeof description === 'string' &&
      description.length >= 1 &&
      description.length <= 1_000
    );
}

function validNoulCriteria(value: unknown): boolean {
  if (value === undefined) return true;
  if (!plainObject(value)) return false;
  return Object.entries(value).every(([key, description]) =>
    (key === 'true' || key === 'false') &&
    typeof description === 'string' &&
    description.length >= 1 &&
    description.length <= 1_000
  );
}

function validScoreCriteria(value: unknown): boolean {
  return Array.isArray(value) &&
    value.length >= 2 &&
    value.length <= 255 &&
    value.every((description) =>
      typeof description === 'string' &&
      description.length >= 1 &&
      description.length <= 1_000
    );
}

function validQuestion(value: unknown): value is DecisionQuestion {
  if (!plainObject(value)) return false;
  const type = value.type;
  if (value.instructions !== undefined &&
      (typeof value.instructions !== 'string' || value.instructions.length > 4_000)) {
    return false;
  }
  if (type === 'choice') return validChoiceCriteria(value.criteria);
  if (type === 'noul') return validNoulCriteria(value.criteria);
  if (type === 'score') return validScoreCriteria(value.criteria);
  return false;
}

function validQuestions(value: unknown): value is Record<string, DecisionQuestion> {
  if (!plainObject(value)) return false;
  const entries = Object.entries(value);
  return entries.length >= 1 &&
    entries.length <= MAX_QUESTIONS &&
    entries.every(([key, question]) =>
      /^[A-Za-z0-9_.-]{1,64}$/.test(key) && validQuestion(question)
    );
}

function validAnswer(value: unknown): boolean {
  if (!plainObject(value) || typeof value.type !== 'string') return false;
  if (value.type === 'noul') {
    return typeof value.noul === 'number' &&
      Number.isFinite(value.noul) &&
      value.noul >= 0 &&
      value.noul <= 1;
  }
  if (value.type === 'choice') {
    return typeof value.choice === 'string' &&
      typeof value.confidence === 'number' &&
      Number.isFinite(value.confidence) &&
      value.confidence >= 0 &&
      value.confidence <= 1 &&
      plainObject(value.probabilities);
  }
  if (value.type === 'score') {
    return typeof value.score === 'number' &&
      Number.isFinite(value.score) &&
      typeof value.confidence === 'number' &&
      Number.isFinite(value.confidence) &&
      value.confidence >= 0 &&
      value.confidence <= 1 &&
      plainObject(value.probabilities);
  }
  return false;
}

function responseModelMatches(actual: unknown, expected: string): actual is string {
  if (typeof actual !== 'string' || !actual.trim()) return false;
  if (actual === expected) return true;
  const expectedBase = expected.replace(/:free$/, '');
  return actual === expectedBase || actual.startsWith(`${expectedBase}-`);
}

function validResponse(
  value: unknown,
  questionIds: readonly string[],
  expectedModel: string,
): value is Record<string, unknown> {
  if (!plainObject(value)) return false;
  const answers = value.answers;
  if (!plainObject(answers)) return false;
  if (!responseModelMatches(value.model, expectedModel)) return false;
  return questionIds.every((id) => validAnswer(answers[id]));
}

export async function handleDecisionModelRequest(
  request: Request,
  env: DecisionModelEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== REVIEW_DECISION_PATH) return null;
  if (request.method !== 'POST') return jsonError('Method not allowed', 'method_not_allowed', 405);
  if (!bearerAuthorized(request, env.KANAREK_REVIEW_ROUTER_TOKEN)) {
    return jsonError('Unauthorized', 'unauthorized', 401);
  }

  let input: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!plainObject(parsed)) return jsonError('Invalid JSON body', 'invalid_request', 400);
    input = parsed;
  } catch {
    return jsonError('Invalid JSON body', 'invalid_request', 400);
  }

  if (input.state === undefined || !validQuestions(input.questions)) {
    return jsonError('Invalid decision request', 'invalid_request', 400);
  }

  const configuredCandidates = decisionProviderOrder(input, env)
    .map((id) => DECISION_PROVIDERS[id])
    .filter((provider) => Boolean(provider.apiKey(env)?.trim()));
  if (!configuredCandidates.length) {
    return jsonError('Decision providers unavailable', 'provider_unavailable', 503);
  }

  const questionIds = Object.keys(input.questions);
  const deadlineAt = Date.now() + decisionProviderTimeoutMs(env);
  const failures: string[] = [];
  const candidates: DecisionProvider[] = [];

  for (const provider of configuredCandidates) {
    const cooldownRead = await withinDecisionDeadline(
      deadlineAt,
      () => activeProviderCooldown(env, provider.cooldownId),
    );
    if (cooldownRead.timedOut) {
      failures.push(`${provider.id}:pool_timeout`);
      break;
    }
    const cooldown = cooldownRead.value;
    if (cooldown) {
      failures.push(
        `${provider.id}:cooldown_${diagnosticToken(cooldown.category) ?? 'active'}`,
      );
      continue;
    }
    candidates.push(provider);
  }

  if (!candidates.length) {
    return jsonError(
      'Decision providers unavailable',
      'provider_unavailable',
      503,
      `pool_exhausted_${failures.join('_')}`,
    );
  }

  for (let index = 0; index < candidates.length; index += 1) {
    const provider = candidates[index];
    const apiKey = provider.apiKey(env)?.trim();
    if (!apiKey) continue;

    const remainingMs = Math.max(0, deadlineAt - Date.now());
    if (remainingMs <= 0) {
      failures.push(`${provider.id}:pool_timeout`);
      break;
    }

    const laterProviders = candidates.length - index - 1;
    const providerBudgetMs = decisionProviderBudgetMs(remainingMs, laterProviders);
    const providerDeadlineAt = Date.now() + providerBudgetMs;

    let providerFailureCategory = 'provider_error';
    let providerFailureReason = 'provider_error';
    let attempted = false;

    for (let modelIndex = 0; modelIndex < provider.models.length; modelIndex += 1) {
      const model = provider.models[modelIndex];
      const providerRemainingMs = Math.max(0, providerDeadlineAt - Date.now());
      const poolRemainingMs = Math.max(0, deadlineAt - Date.now());
      if (providerRemainingMs <= 0 || poolRemainingMs <= 0) {
        providerFailureCategory = 'timeout';
        providerFailureReason = 'pool_timeout';
        break;
      }

      const laterModels = provider.models.length - modelIndex - 1;
      const attemptTimeoutMs = decisionModelAttemptTimeoutMs(
        providerRemainingMs,
        poolRemainingMs,
        laterModels,
      );
      if (attemptTimeoutMs <= 0) {
        providerFailureCategory = 'timeout';
        providerFailureReason = 'pool_timeout';
        break;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);
      attempted = true;

      try {
        const response = await fetcher(provider.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            state: input.state,
            questions: input.questions,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          providerFailureCategory = `http_${response.status}`;
          providerFailureReason = await providerErrorReason(response);
          continue;
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          providerFailureCategory = 'invalid_response';
          providerFailureReason = 'invalid_provider_json';
          continue;
        }

        if (!validResponse(payload, questionIds, model)) {
          providerFailureCategory = 'invalid_response';
          providerFailureReason = 'invalid_provider_response';
          continue;
        }

        const actualModel = String(payload.model);
        console.info(JSON.stringify({
          kanarekDecisionPool: 'selected',
          provider: provider.id,
          model: actualModel,
          attempt: index + 1,
          modelAttempt: modelIndex + 1,
          primary: index === 0 && modelIndex === 0,
        }));
        return Response.json(payload, {
          headers: {
            'cache-control': 'no-store',
            'x-kanarek-review-provider': `${provider.id}-decision`,
            'x-kanarek-review-model': actualModel,
          },
        });
      } catch (error) {
        const timedOut = error instanceof DOMException && error.name === 'AbortError';
        providerFailureCategory = timedOut ? 'timeout' : 'network';
        providerFailureReason = timedOut ? 'provider_timeout' : 'provider_network';
      } finally {
        clearTimeout(timeout);
      }
    }

    if (attempted) {
      await withinDecisionDeadline(
        deadlineAt,
        () => rememberProviderCooldown(provider.cooldownId, providerFailureCategory, env),
      );
    }
    failures.push(`${provider.id}:${providerFailureReason}`);
  }

  const coolingDown = failures.length > 0 &&
    failures.every((failure) => failure.includes(':cooldown_'));
  return jsonError(
    'Decision providers unavailable',
    coolingDown ? 'provider_unavailable' : 'provider_error',
    coolingDown ? 503 : 502,
    `pool_exhausted_${failures.join('_')}`,
  );
}
