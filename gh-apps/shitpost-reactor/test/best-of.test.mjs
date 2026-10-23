import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateBestShitpost, JUDGE_MODEL, parseContent, parseJudgePick } from '../generate.mjs';

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
