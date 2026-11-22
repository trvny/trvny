import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { approveProposal } from '../worker.mjs';
import { MAX_PENDING, getProposal, listProposals, rejectProposal, submitProposal, validateSubmission } from '../submissions.mjs';
import { AGENT_SKILL } from '../agent-discovery.mjs';

function makeBucket() {
  const store = new Map();
  let revision = 0;
  const bucket = {
    store,
    async get(key) {
      const object = store.get(key);
      return object ? {
        json: async () => JSON.parse(object.body),
        text: async () => object.body,
        customMetadata: object.customMetadata,
        etag: object.etag,
      } : null;
    },
    async head(key) { return store.has(key) ? {} : null; },
    async put(key, body, options = {}) {
      const current = store.get(key);
      const condition = options.onlyIf;
      if (condition instanceof Headers && condition.get('if-none-match') === '*' && current) return null;
      if (condition && !(condition instanceof Headers) && condition.etagMatches !== current?.etag) return null;
      store.set(key, { body: String(body), customMetadata: options.customMetadata, etag: String(++revision) });
      return {};
    },
    async list({ prefix, limit }) {
      const entries = [...store.entries()].filter(([key]) => key.startsWith(prefix));
      return {
        objects: entries.slice(0, limit).map(([key, value]) => ({ key, customMetadata: value.customMetadata })),
        truncated: entries.length > limit,
      };
    },
    async delete(key) { store.delete(key); },
  };
  return bucket;
}
const payload = { language: 'en', text: 'The committee approved the emergency meeting about meetings.', title: 'Meeting season', agent: 'CuriousAgent/1' };
function request(body = payload, headers = {}) {
  return new Request('https://shitpost.bartek.lol/api/submissions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.2', ...headers },
    body: JSON.stringify(body),
  });
}

test('proposal validation limits fields and published languages', () => {
  assert.deepEqual(validateSubmission(payload), payload);
  assert.throws(() => validateSubmission({ ...payload, language: 'de' }), /invalid_language/);
  assert.throws(() => validateSubmission({ ...payload, text: ' ' }), /invalid_text/);
  assert.throws(() => validateSubmission({ ...payload, text: 'a'.repeat(2401) }), /invalid_text/);
  assert.throws(() => validateSubmission({ ...payload, unexpected: true }), /unexpected_fields/);
});

test('agent proposal is private and only queued after validation', async () => {
  const FEED = makeBucket();
  const env = { FEED, SUBMISSION_LIMIT: { limit: async ({ key }) => ({ success: key === '198.51.100.2' }) } };
  const posted = await submitProposal(request(), env);
  assert.equal(posted.status, 202);
  const result = await posted.json();
  assert.equal(result.published, false);
  assert.equal(result.status, 'pending_review');
  assert.match(result.id, /^s-\d{8}-[0-9a-f-]{36}$/u);
  assert.equal((await getProposal(env, result.id)).text, payload.text);
  assert.equal((await listProposals(env)).total, 1);
  assert.deepEqual(JSON.parse(FEED.store.get('submissions/pending-index.json').body), [result.id]);
  assert.equal(FEED.store.has('index.json'), false);
  assert.equal([...FEED.store.keys()].filter((x) => x.startsWith('posts/')).length, 0);
  const unauthenticated = await worker.fetch(new Request('https://shitpost.bartek.lol/api/submissions'), env);
  assert.equal(unauthenticated.status, 401);
  const deniedReview = await worker.fetch(
    new Request('https://shitpost.bartek.lol/api/submissions/' + result.id + '/approve', { method: 'POST' }), env);
  assert.equal(deniedReview.status, 401);
});

test('proposal fails closed without rate limiter; blocks CSRF, flood and extra inputs', async () => {
  const FEED = makeBucket();
  assert.equal((await submitProposal(request(), { FEED })).status, 503);
  assert.equal((await submitProposal(request({}, { origin: 'https://evil.example' }), {
    FEED, SUBMISSION_LIMIT: { limit: async () => ({ success: true }) },
  })).status, 403);
  const limited = { FEED, SUBMISSION_LIMIT: { limit: async () => ({ success: false }) } };
  assert.equal((await submitProposal(request(), limited)).status, 429);
  const env = { FEED, SUBMISSION_LIMIT: { limit: async () => ({ success: true }) } };
  assert.equal((await submitProposal(request({ ...payload, forged: true }), env)).status, 400);
  const fakeIds = Array.from({ length: MAX_PENDING }, (_, i) =>
    's-20261122-12345678-1234-1234-1234-' + i.toString(16).padStart(12, '0'));
  await FEED.put('submissions/pending-index.json', JSON.stringify(fakeIds));
  assert.equal((await submitProposal(request(), env)).status, 429);
});

test('owner-reviewed proposal publishes once through the normal post index', async () => {
  const FEED = makeBucket();
  const env = { FEED, SUBMISSION_LIMIT: { limit: async () => ({ success: true }) } };
  const created = await (await submitProposal(request(), env)).json();
  const proposal = await getProposal(env, created.id);
  const claims = { run_id: '98123', run_attempt: '1' };
  const approved = await approveProposal(env, proposal, claims);
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).url, 'https://shitpost.bartek.lol/posts/gh-98123-1');
  assert.equal(await getProposal(env, created.id), null);
  const post = JSON.parse(FEED.store.get('posts/gh-98123-1.json').body);
  assert.equal(post.content.text, payload.text);
  assert.equal(post.submission.id, created.id);
  assert.deepEqual(JSON.parse(FEED.store.get('index.json').body).map((x) => x.id), ['gh-98123-1']);
  assert.equal(JSON.parse(FEED.store.get('submissions/decisions/' + created.id + '.json').body).decision, 'approved');
  const publicFeed = await worker.fetch(new Request('https://shitpost.bartek.lol/feed.json'), env);
  assert.equal((await publicFeed.json()).items[0].summary, payload.text);
});

test('concurrent anonymous submissions cannot overflow the shared R2 CAS index', async () => {
  const FEED = makeBucket();
  const env = { FEED, SUBMISSION_LIMIT: { limit: async () => ({ success: true }) } };
  const seed = Array.from({ length: MAX_PENDING - 1 }, (_, i) =>
    's-20261122-12345678-1234-1234-1234-' + i.toString(16).padStart(12, '0'));
  await FEED.put('submissions/pending-index.json', JSON.stringify(seed));
  const responses = await Promise.all(Array.from({ length: 10 }, () => submitProposal(request(), env)));
  assert.equal(responses.filter((x) => x.status === 202).length, 1);
  assert.equal(responses.filter((x) => x.status === 429).length, 9);
  assert.equal(JSON.parse(FEED.store.get('submissions/pending-index.json').body).length, MAX_PENDING);
});

test('reject refuses an interrupted approval and a retry completes its original post id', async () => {
  const FEED = makeBucket();
  const env = { FEED, SUBMISSION_LIMIT: { limit: async () => ({ success: true }) } };
  const created = await (await submitProposal(request(), env)).json();
  const proposal = await getProposal(env, created.id);
  const originalPut = FEED.put;
  let denied = 6;
  FEED.put = async (key, ...args) => {
    if (key === 'index.json' && denied-- > 0) return null;
    return originalPut(key, ...args);
  };
  await assert.rejects(approveProposal(env, proposal, { run_id: '900', run_attempt: '1' }), /archive_index_update_conflict/);
  const interrupted = await getProposal(env, created.id);
  assert.equal(interrupted.status, 'approving');
  const rejected = await rejectProposal(env, interrupted, { run_id: '901' });
  assert.equal(rejected.status, 409);
  assert.equal((await getProposal(env, created.id)).status, 'approving');
  FEED.put = originalPut;
  const retry = await approveProposal(env, await getProposal(env, created.id), { run_id: '902', run_attempt: '1' });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).url, 'https://shitpost.bartek.lol/posts/gh-900-1');
  assert.equal((await listProposals(env)).total, 0);
});

test('API discovery does not advertise remote MCP and skill digest matches served bytes', async () => {
  const base = 'https://shitpost.bartek.lol';
  const ard = await (await worker.fetch(new Request(base + '/.well-known/ard.json'), {})).json();
  assert.equal(ard.specVersion, '0.9');
  assert.equal(ard.entries[0].url, base + '/.well-known/api-catalog');
  const catalog = await worker.fetch(new Request(base + '/.well-known/api-catalog', { method: 'HEAD' }), {});
  assert.equal(catalog.status, 200);
  assert.equal(catalog.headers.get('link'), '</.well-known/api-catalog>; rel="api-catalog"');
  assert.match(catalog.headers.get('content-type'), /^application\/linkset\+json/u);
  assert.equal(await catalog.text(), '');
  const index = await (await worker.fetch(new Request(base + '/.well-known/agent-skills/index.json'), {})).json();
  const skill = await (await worker.fetch(new Request(base + '/.well-known/agent-skills/reactor-propose-post/SKILL.md'), {})).text();
  assert.equal(skill, AGENT_SKILL);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(skill));
  const expected = [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, '0')).join('');
  assert.equal(index.skills[0].digest, 'sha256:' + expected);
});
