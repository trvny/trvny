import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateBestShitpost, JUDGE_MODEL, parseContent, parseJudgePick, parseJudgeRevision } from '../generate.mjs';

const parse = (content) => parseContent(content, { mode: 'text' });

function routerFake({ texts, judge, failAfter = Infinity }) {
  const calls = [];
  const providers = ['aihubmix', 'vercel', 'groq', 'openrouter'];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    const exclude = init.headers['x-kanarek-review-exclude-provider'] ?? '';
    calls.push({ model: body.model, exclude });
    if (body.model === JUDGE_MODEL) {
      if (judge instanceof Error) throw judge;
      return new Response(JSON.stringify({ model: 'judge-m', choices: [{ message: { content: judge } }] }), {
        status: 200, headers: { 'x-kanarek-review-provider': 'groq' },
      });
    }
    const index = calls.filter((call) => call.model !== JUDGE_MODEL).length - 1;
    if (index >= failAfter) return new Response('Review providers unavailable', { status: 429 });
    return new Response(JSON.stringify({
      model: `m${index}`,
      choices: [{ message: { content: JSON.stringify({ kind: 'text', text: texts[index] }) } }],
    }), { status: 200, headers: { 'x-kanarek-review-provider': providers[index] } });
  };
  return { calls, fetchImpl };
}

test('best-of asks distinct providers, then publishes the judge pick', async () => {
  const fake = routerFake({ texts: ['meh', 'better', 'best'], judge: '{"pick":2,"why":"sharpest turn"}' });
  const lines = [];
  const result = await generateBestShitpost({
    endpoint: 'https://example.test', token: 't', messages: [], parse, fetchImpl: fake.fetchImpl, log: (l) => lines.push(l),
  });
  assert.equal(result.content.text, 'best');
  assert.equal(result.provider, 'groq');
  assert.deepEqual(fake.calls.map((call) => call.exclude), ['', 'aihubmix', 'aihubmix,vercel', '']);
  assert.equal(fake.calls.at(-1).model, JUDGE_MODEL);
  assert.match(lines[0], /candidates=3 pick=2/);
});

test('an invalid or failed judge falls back to the first candidate', async () => {
  for (const judge of ['{"pick":7}', 'not json', new TypeError('fetch failed')]) {
    const fake = routerFake({ texts: ['first', 'second', 'third'], judge });
    const result = await generateBestShitpost({
      endpoint: 'https://example.test', token: 't', messages: [], parse, fetchImpl: fake.fetchImpl,
      sleepImpl: async () => {}, log: () => {},
    });
    assert.equal(result.content.text, 'first');
  }
});

test('an exhausted router stops collecting; one candidate skips the judge', async () => {
  const fake = routerFake({ texts: ['only'], judge: '{"pick":0}', failAfter: 1 });
  const result = await generateBestShitpost({
    endpoint: 'https://example.test', token: 't', messages: [], parse, fetchImpl: fake.fetchImpl, log: () => {},
  });
  assert.equal(result.content.text, 'only');
  assert.equal(fake.calls.length, 2);
  assert.ok(fake.calls.every((call) => call.model !== JUDGE_MODEL));
});

test('no candidate rethrows the first router failure for the Bacon fallback', async () => {
  const fake = routerFake({ texts: [], judge: '{"pick":0}', failAfter: 0 });
  await assert.rejects(generateBestShitpost({
    endpoint: 'https://example.test', token: 't', messages: [], parse, fetchImpl: fake.fetchImpl, log: () => {},
  }), /^Error: router_failed:429:/);
});

test('judge pick parsing tolerates fences and rejects out-of-range picks', () => {
  assert.deepEqual(parseJudgePick('```json\n{"pick":1,"why":"x"}\n```', 2), { pick: 1, why: 'x' });
  assert.equal(parseJudgePick('{"pick":2}', 2), null);
  assert.equal(parseJudgePick('{"pick":"1"}', 2), null);
});

test('the judge can polish its pick without discarding the original finalists', async () => {
  const fake = routerFake({
    texts: ['raw first', 'raw second', 'raw third'],
    judge: JSON.stringify({
      pick: 1, why: 'best premise',
      revision: { kind: 'text', title: 'A sharper headline', text: 'polished second' },
    }),
  });
  const result = await generateBestShitpost({
    endpoint: 'https://example.test', token: 't', messages: [], parse, fetchImpl: fake.fetchImpl,
    log: () => {},
  });
  assert.equal(result.content.text, 'polished second');
  assert.equal(result.editorial.candidates.length, 3);
  assert.equal(result.editorial.candidates[1].content.text, 'raw second');
  assert.equal(result.editorial.pick, 1);
  assert.equal(result.editorial.revised, true);
  assert.equal(fake.calls.length, 4);
});

test('transient 502 exhaustion retries without using up a candidate slot', async () => {
  const sleeps = [];
  const calls = [];
  let candidateCalls = 0;
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.model === JUDGE_MODEL) {
      return Response.json({ model: 'judge', choices: [{ message: { content: '{"pick":2}' } }] });
    }
    const attempt = candidateCalls++;
    calls.push(init.headers['x-kanarek-review-exclude-provider'] || '');
    if (attempt === 1 || attempt === 2) return new Response('router exhausted', { status: 502 });
    const index = attempt === 0 ? 0 : attempt - 2;
    return new Response(JSON.stringify({ model: 'm' + index,
      choices: [{ message: { content: JSON.stringify({ kind: 'text', text: 'candidate ' + index }) } }] }), {
      status: 200, headers: { 'x-kanarek-review-provider': ['aihubmix', 'vercel', 'groq'][index] },
    });
  };
  const result = await generateBestShitpost({
    endpoint: 'https://example.test', token: 't', messages: [], parse, fetchImpl,
    sleepImpl: async (ms) => { sleeps.push(ms); }, log: () => {},
  });
  assert.equal(result.content.text, 'candidate 2');
  assert.equal(result.editorial.candidates.length, 3);
  assert.deepEqual(calls, ['', 'aihubmix', 'aihubmix', 'aihubmix', 'aihubmix,vercel']);
  assert.deepEqual(sleeps, [2_000, 5_000]);
});

test('judge revision never changes the selected output kind', () => {
  const selected = { content: { kind: 'text', text: 'original' } };
  assert.equal(parseJudgeRevision(JSON.stringify({ revision: { kind: 'meme', template: 'bihw',
    top_text: 'a', bottom_text: 'b' } }), selected, parse), null);
  assert.equal(parseJudgeRevision('{"revision":{"kind":"text","text":""}}', selected, parse), null);
});
