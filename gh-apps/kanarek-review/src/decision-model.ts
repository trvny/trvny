import { bearerAuthorized } from '../../kanarek-companion/src/auth.ts';
import { REVIEW_DECISION_PATH } from '../../kanarek-companion/src/review-service-protocol.ts';
import {
  activeProviderCooldown,
  rememberProviderCooldown,
  taskProviderTimeoutMs,
  type ReviewRouterEnv,
} from './review-router.ts';

const DECISION_MODEL = 'decision-model-preview';
const DECISION_ENDPOINT = 'https://aihubmix.com/v1/systemone';
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_QUESTIONS = 16;

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
  const raw = env.KANAREK_REVIEW_ROUTER_TIMEOUT_MS?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed >= MIN_TIMEOUT_MS && parsed <= MAX_TIMEOUT_MS
    ? parsed
    : DEFAULT_TIMEOUT_MS;
}

export function decisionProviderTimeoutMs(env: DecisionModelEnv): number {
  return taskProviderTimeoutMs(timeoutMs(env), 'judge');
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

function validResponse(value: unknown, questionIds: readonly string[]): value is Record<string, unknown> {
  if (!plainObject(value)) return false;
  const answers = value.answers;
  if (!plainObject(answers)) return false;
  if (value.model !== DECISION_MODEL) return false;
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

  const apiKey = env.AIHUBMIX_API_KEY?.trim();
  if (!apiKey) return jsonError('Decision provider unavailable', 'provider_unavailable', 503);

  const cooldown = await activeProviderCooldown(env, 'aihubmix');
  if (cooldown) {
    return jsonError(
      'Decision provider cooling down',
      'provider_unavailable',
      503,
      `cooldown_${diagnosticToken(cooldown.category) ?? 'active'}`,
    );
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

  const questionIds = Object.keys(input.questions);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), decisionProviderTimeoutMs(env));

  try {
    const response = await fetcher(DECISION_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DECISION_MODEL,
        state: input.state,
        questions: input.questions,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      await rememberProviderCooldown('aihubmix', `http_${response.status}`, env);
      const reason = await providerErrorReason(response);
      return jsonError(
        `Decision provider failed with HTTP ${response.status}`,
        'provider_error',
        502,
        reason,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return jsonError(
        'Decision provider returned invalid JSON',
        'invalid_provider_response',
        502,
        'invalid_provider_json',
      );
    }
    if (!validResponse(payload, questionIds)) {
      return jsonError(
        'Decision provider returned an invalid response',
        'invalid_provider_response',
        502,
        'invalid_provider_response',
      );
    }

    return Response.json(payload, {
      headers: {
        'cache-control': 'no-store',
        'x-kanarek-review-provider': 'aihubmix-decision',
        'x-kanarek-review-model': DECISION_MODEL,
      },
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError';
    await rememberProviderCooldown('aihubmix', timedOut ? 'timeout' : 'network', env);
    return jsonError(
      timedOut ? 'Decision provider timed out' : 'Decision provider request failed',
      timedOut ? 'provider_timeout' : 'provider_error',
      502,
      timedOut ? 'provider_timeout' : 'provider_network',
    );
  } finally {
    clearTimeout(timeout);
  }
}
