import { GROK_CACHE_ID, GROK_PAID_MODEL, GROK_REVIEW_SCHEMA } from '../../../core/xai-review.ts';

type JsonObject = Record<string, unknown>;

export interface XaiReviewRpcResult {
  status: number;
  payload: JsonObject;
  retryAfter?: string;
}

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject : {};
}

function error(status: number, code: string, retryAfter?: string): XaiReviewRpcResult {
  return { status, payload: { error: { code, message: code } },
    ...(retryAfter ? { retryAfter } : {}) };
}

export function grokReviewRequest(input: unknown): JsonObject | null {
  const value = objectValue(input);
  if (value.model !== GROK_PAID_MODEL || !Array.isArray(value.messages) ||
    value.messages.length < 1 || value.messages.length > 12 || value.stream === true ||
    JSON.stringify(value.messages).length > 1_800_000) return null;
  const messages: JsonObject[] = [];
  for (const message of value.messages) {
    const item = objectValue(message);
    if (!['system', 'developer', 'user', 'assistant'].includes(String(item.role)) ||
      typeof item.content !== 'string') return null;
    messages.push({ role: item.role, content: item.content });
  }
  const wanted = typeof value.max_tokens === 'number' &&
    Number.isFinite(value.max_tokens) ? Math.floor(value.max_tokens) : 36_864;
  return {
    model: GROK_PAID_MODEL,
    store: false,
    prompt_cache_key: GROK_CACHE_ID,
    reasoning: { effort: 'high' },
    max_output_tokens: Math.max(8_192, Math.min(131_072, wanted)),
    input: messages,
    text: { format: {
      type: 'json_schema', name: 'kanarek_code_review',
      strict: true, schema: GROK_REVIEW_SCHEMA,
    } },
  };
}

export async function requestGrokReview(
  input: unknown,
  apiKey: string | undefined,
  fetcher: typeof fetch = fetch,
  deadlineAt = Date.now() + 240_000,
): Promise<XaiReviewRpcResult> {
  const request = grokReviewRequest(input);
  if (!request) return error(400, 'invalid_review_request');
  if (!apiKey) return error(503, 'xai_not_configured');

  const timeLeft = deadlineAt - Date.now() - 5_000;
  if (!Number.isFinite(timeLeft) || timeLeft <= 0) return error(504, 'xai_deadline_expired');
  let upstream: Response;
  try {
    upstream = await fetcher('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(Math.min(240_000, timeLeft)),
    });
  } catch {
    return error(502, 'xai_network_or_timeout');
  }
  if (!upstream.ok) {
    const retryAfter = upstream.headers.get('retry-after') || undefined;
    await upstream.body?.cancel();
    return error(upstream.status, 'xai_http_' + upstream.status, retryAfter);
  }
  let data: JsonObject;
  try {
    data = objectValue(await upstream.json());
  } catch {
    return error(502, 'xai_invalid_response');
  }
  if (data.status !== 'completed' || !Array.isArray(data.output)) {
    return error(502, 'xai_incomplete');
  }
  const text = data.output.flatMap((entry) => {
    const content = objectValue(entry).content;
    return Array.isArray(content) ? content : [];
  }).map(objectValue).filter((part) => part.type === 'output_text' &&
    typeof part.text === 'string').map((part) => part.text as string).join('\n');
  if (!text.trim()) return error(502, 'xai_empty_response');
  const usage = objectValue(data.usage);
  return {
    status: 200,
    payload: {
      object: 'chat.completion',
      model: typeof data.model === 'string' ? data.model : GROK_PAID_MODEL,
      choices: [{ index: 0, message: { role: 'assistant', content: text },
        finish_reason: 'stop' }],
      usage: {
        prompt_tokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : 0,
        completion_tokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
      },
    },
  };
}
