import { OUTPUT_LANGUAGES } from './languages.mjs';
import { SHITPOST_TEXT_HARD_MAX_CHARS } from './limits.mjs';

export const MAX_PENDING = 40;
export const SUBMISSION_PREFIX = 'submissions/pending/';
const INDEX_KEY = 'submissions/pending-index.json';
const MAX_BODY_BYTES = 32 * 1024;
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
  if (!text || [...text].length > SHITPOST_TEXT_HARD_MAX_CHARS) throw Error('invalid_text');
  const title = typeof value.title === 'string' ? value.title.replace(/\s+/gu, ' ').trim() : '';
  if ([...title].length > 120) throw Error('invalid_title');
  const agent = typeof value.agent === 'string' ? value.agent.replace(/\s+/gu, ' ').trim() : '';
  if ([...agent].length > 80) throw Error('invalid_agent');
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

// R2 strong consistency + conditional ETag writes serialize the global cap.
// All public accepts first reserve an index slot. Failed conflicts retry.
async function mutateIndex(env, update) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const previous = await env.FEED.get(INDEX_KEY);
    const ids = previous ? await previous.json() : [];
    if (!Array.isArray(ids) || ids.some((v) => !SUBMISSION_ID.test(v))) {
      throw Error('submission_index_invalid');
    }
    const next = await update(ids);
    if (next === null) return false;
    const result = await env.FEED.put(INDEX_KEY, JSON.stringify(next) + '\n', {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
      onlyIf: previous ? { etagMatches: previous.etag } : new Headers({ 'if-none-match': '*' }),
    });
    if (result !== null) return true;
  }
  throw Error('submission_index_conflict');
}

export async function releaseSlot(env, id) {
  return mutateIndex(env, (ids) => ids.filter((item) => item !== id));
}

async function reserveSlot(env, id) {
  return mutateIndex(env, async (ids) => {
    let active = ids;
    // Self-heal a failed slot release. Probe only when at the hard cap.
    if (ids.length >= MAX_PENDING) {
      // In-flight reservations have no draft object yet; never reclaim those.
      // A missing object is stale only after its creation-day safety window.
      const safeDay = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().slice(0, 10).replaceAll('-', '');
      const present = await Promise.all(ids.map(async (key) =>
        key.slice(2, 10) >= safeDay ? true : env.FEED.head(submissionKey(key))));
      active = ids.filter((_, index) => present[index] !== null);
    }
    return active.length >= MAX_PENDING ? null : [...active, id];
  });
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
  const submittedAt = new Date().toISOString();
  const id = 's-' + submittedAt.slice(0, 10).replaceAll('-', '') + '-' + crypto.randomUUID();
  try {
    if (!await reserveSlot(env, id)) return publicJson({ error: 'moderation_queue_full' }, 429);
  } catch {
    return publicJson({ error: 'submission_service_unavailable' }, 503);
  }
  try {
    await env.FEED.put(submissionKey(id), JSON.stringify({
      id, status: 'pending_review', submitted_at: submittedAt, ...source,
    }) + '\n', {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
    });
  } catch {
    await releaseSlot(env, id).catch(() => undefined);
    return publicJson({ error: 'submission_service_unavailable' }, 503);
  }
  return publicJson({ ok: true, id, status: 'pending_review', published: false }, 202);
}

export async function listProposals(env) {
  const index = await env.FEED.get(INDEX_KEY);
  const ids = index ? await index.json() : [];
  if (!Array.isArray(ids) || ids.length > MAX_PENDING) throw Error('submission_index_invalid');
  const items = (await Promise.all(ids.map(async (id) => {
    const value = await getProposal(env, id);
    if (!value) return null;
    return {
      id: value.id, submitted_at: value.submitted_at,
      title: value.title, language: value.language, agent: value.agent,
      status: value.status || 'pending_review',
    };
  }))).filter(Boolean);
  return { pending: items, total: items.length };
}

export async function getProposal(env, id) {
  const key = submissionKey(id);
  if (!key) return null;
  const object = await env.FEED.get(key);
  return object ? { ...await object.json(), _etag: object.etag } : null;
}

// Reject only an untouched pending proposal. An interrupted approval must
// finish approval (or be repaired privately), never become a rejected public post.
export async function rejectProposal(env, proposal, claims) {
  const id = proposal.id;
  if (proposal.status === 'approving') return publicJson({ error: 'approval_in_progress' }, 409);
  if (proposal.status !== 'rejected') {
    if (proposal.status !== 'pending_review') return publicJson({ error: 'moderation_conflict' }, 409);
    const updated = { ...proposal, status: 'rejected' };
    delete updated._etag;
    const cas = await env.FEED.put(submissionKey(id), JSON.stringify(updated) + '\n', {
      onlyIf: { etagMatches: proposal._etag },
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
    });
    if (cas === null) return publicJson({ error: 'moderation_conflict' }, 409);
  }
  await env.FEED.put('submissions/decisions/' + id + '.json', JSON.stringify({
    id, decision: 'rejected', decided_at: new Date().toISOString(),
    run_id: String(claims.run_id),
  }) + '\n', { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
  await env.FEED.delete(submissionKey(id));
  await releaseSlot(env, id);
  return publicJson({ ok: true, id, status: 'rejected' });
}
