import { OUTPUT_LANGUAGES } from './languages.mjs';
import { SHITPOST_TEXT_HARD_MAX_CHARS } from './limits.mjs';

export const MAX_PENDING = 40;
export const SUBMISSION_PREFIX = 'submissions/pending/';
const MAX_BODY_BYTES = 8 * 1024;
const SUBMISSION_ID = /^s-\d{8}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const LANGUAGES = new Set(OUTPUT_LANGUAGES.map(({ code }) => code));

export function submissionKey(id) {
  return SUBMISSION_ID.test(id || '') ? SUBMISSION_PREFIX + id + '.json' : null;
}

export function publicJson(body, status = 200) {
  return new Response(JSON.stringify(body) + '\n', {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export function validateSubmission(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('invalid_submission');
  const text = typeof value.text === 'string' ? value.text.trim() : '';
  if (!text || text.length > SHITPOST_TEXT_HARD_MAX_CHARS) throw Error('invalid_text');
  const title = typeof value.title === 'string' ? value.title.replace(/\s+/gu, ' ').trim() : '';
  if (title.length > 120) throw Error('invalid_title');
  const agent = typeof value.agent === 'string' ? value.agent.replace(/\s+/gu, ' ').trim() : '';
  if (agent.length > 80) throw Error('invalid_agent');
  if (!LANGUAGES.has(value.language)) throw Error('invalid_language');
  if (Object.keys(value).some((key) => !['title', 'text', 'language', 'agent'].includes(key))) {
    throw Error('unexpected_fields');
  }
  return { title, text, language: value.language, agent };
}

async function readBoundedBody(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) throw Error('payload_too_large');
  const reader = request.body?.getReader();
  if (!reader) throw Error('empty_body');
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value?.byteLength || 0;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw Error('payload_too_large');
      }
      if (value?.byteLength) chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export async function submitProposal(request, env) {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    return publicJson({ error: 'content_type_required' }, 415);
  }
  const origin = request.headers.get('origin');
  if (origin && !['https://shitpost.bartek.lol', 'https://shitpost-reactor.travny.workers.dev'].includes(origin)) {
    return publicJson({ error: 'forbidden_origin' }, 403);
  }
  if (!env.FEED || !env.SUBMISSION_LIMIT?.limit) return publicJson({ error: 'submission_service_unavailable' }, 503);
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const limited = await env.SUBMISSION_LIMIT.limit({ key: ip });
  if (!limited?.success) return publicJson({ error: 'rate_limited' }, 429);
  let source;
  try {
    source = validateSubmission(JSON.parse(await readBoundedBody(request)));
  } catch (error) {
    return publicJson({ error: error?.message === 'payload_too_large' ? 'payload_too_large' : 'invalid_submission' },
      error?.message === 'payload_too_large' ? 413 : 400);
  }
  const pending = await env.FEED.list({ prefix: SUBMISSION_PREFIX, limit: MAX_PENDING });
  if (pending.truncated || pending.objects.length >= MAX_PENDING) {
    return publicJson({ error: 'moderation_queue_full' }, 429);
  }
  const submittedAt = new Date().toISOString();
  const id = 's-' + submittedAt.slice(0, 10).replaceAll('-', '') + '-' + crypto.randomUUID();
  await env.FEED.put(submissionKey(id), JSON.stringify({
    id, submitted_at: submittedAt, ...source,
  }) + '\n', {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  });
  return publicJson({ ok: true, id, status: 'pending_review', published: false }, 202);
}

export async function listProposals(env) {
  const pending = await env.FEED.list({ prefix: SUBMISSION_PREFIX, limit: MAX_PENDING });
  const items = (await Promise.all(pending.objects.map(async ({ key }) => {
    const object = await env.FEED.get(key);
    if (!object) return null;
    const value = await object.json();
    return {
      id: value.id, submitted_at: value.submitted_at,
      title: value.title, language: value.language, agent: value.agent,
    };
  }))).filter(Boolean);
  return { pending: items, total: items.length };
}

export async function getProposal(env, id) {
  const key = submissionKey(id);
  if (!key) return null;
  const object = await env.FEED.get(key);
  return object ? object.json() : null;
}

export async function rejectProposal(env, proposal, claims) {
  const id = proposal.id;
  await env.FEED.put('submissions/decisions/' + id + '.json', JSON.stringify({
    id, decision: 'rejected', decided_at: new Date().toISOString(),
    run_id: String(claims.run_id),
  }) + '\n', { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
  await env.FEED.delete(submissionKey(id));
  return publicJson({ ok: true, id, status: 'rejected' });
}
