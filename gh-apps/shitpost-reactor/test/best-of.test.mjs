import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_MODEL, EDITOR_MODEL, generateEditedShitpost, parseContent,
  parseEditorRevision, parseDraftForRun, buildMessages, resolveGenerationPlan,
} from '../generate.mjs';

const textDraft = (text) => JSON.stringify({ kind: 'text', text });
const edit = (text) => JSON.stringify({ why: 'sharper turn', revision: { kind: 'text', text } });
const parse = (content) => parseContent(content, { mode: 'text' });

function routerFake(responses) {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    const response = responses[calls.length];
    calls.push({ model: body.model, messages: body.messages, exclude: init.headers['x-kanarek-review-exclude-provider'] || '' });
    if (!response) throw Error('unexpected_call');
    if (response instanceof Error) throw response;
    if (response.status) return new Response('router exhausted', { status: response.status });
    return new Response(JSON.stringify({
      model: response.model || 'm-' + response.provider,
      choices: [{ message: { content: response.content } }],
    }), { headers: { 'x-kanarek-review-provider': response.provider } });
  };
  return { calls, fetchImpl };
}
const author = { provider: 'aihubmix', content: textDraft('first draft') };
const editor = (content, provider = 'groq') => ({ provider, content });
const run = (fake, options = {}) => generateEditedShitpost({
  endpoint: 'https://example.test', token: 't', messages: [], parse,
  fetchImpl: fake.fetchImpl, sleepImpl: async () => {}, log: () => {}, ...options,
});

test('one author and one distinct editor cooperate on the same draft', async () => {
  const fake = routerFake([author, editor(edit('final joke'))]);
  const result = await run(fake);
  assert.deepEqual(fake.calls.map(({ model, exclude }) => [model, exclude]), [
    [DEFAULT_MODEL, ''], [EDITOR_MODEL, 'aihubmix'],
  ]);
  assert.match(fake.calls[1].messages[1].content, /first draft/);
  assert.equal(result.content.text, 'final joke');
  assert.equal(result.provider, 'groq');
  assert.equal(result.editorial.pick, 1);
  assert.equal(result.editorial.candidates[0].content.text, 'first draft');
  assert.equal(result.editorial.candidates[1].content.text, 'final joke');
  assert.equal(result.editorial.revised, true);
  assert.equal(result.editorial.judge.provider, 'groq');
});

test('keep, invalid editor, same provider, unknown provider or quota leaves author intact', async () => {
  for (const response of [
    editor('{"why":"already good","revision":null}'),
    editor(edit('first draft')),
    editor('invalid json'),
    editor(edit('wrong provider'), 'aihubmix'),
    editor(edit('unknown provider'), 'unknown'),
    { status: 429 },
  ]) {
    const fake = routerFake([author, response]);
    const result = await run(fake);
    assert.equal(result.content.text, 'first draft');
    assert.equal(result.provider, 'aihubmix');
    assert.equal(result.editorial.candidates.length, 1);
    assert.equal(result.editorial.revised, false);
    assert.equal(fake.calls.length, 2);
  }
});

test('unknown author identity skips optional editor', async () => {
  const fake = routerFake([{ ...author, provider: 'unknown' }]);
  assert.equal((await run(fake)).content.text, 'first draft');
  assert.equal(fake.calls.length, 1);
});

test('invalid author consumes second stage for rescue, never invokes editor', async () => {
  const fake = routerFake([{ ...author, content: 'bad json' }, editor(textDraft('rescue'))]);
  const result = await run(fake);
  assert.equal(result.content.text, 'rescue');
  assert.deepEqual(fake.calls.map(({ model, exclude }) => [model, exclude]), [
    [DEFAULT_MODEL, ''], [DEFAULT_MODEL, 'aihubmix'],
  ]);
  assert.equal(result.editorial.candidates.length, 1);
});

test('no valid author preserves router error for Bacon fallback', async () => {
  const fake = routerFake([{ status: 429 }]);
  await assert.rejects(run(fake), /router_failed:429:/);
  assert.equal(fake.calls.length, 1);
});

test('scheduled limerick author and editor receive the same form and source context', async () => {
  const { mode, form } = resolveGenerationPlan('auto', 'seed', '6');
  assert.equal(form, 'limerick');
  const parse = (raw) => parseContent(raw, { mode, form });
  const body = 'A cat found a chair\nThe chair filed a prayer\nA clerk with a pen\nDeclared it a hen\nAnd taxed the remaining air';
  const messages = buildMessages('# style', 'local headline', 'seed', mode, null, { form });
  const fake = routerFake([{ ...author, content: textDraft(body) }, editor(edit('one line'))]);
  const result = await run(fake, { messages, parse, form });
  assert.match(fake.calls[0].messages[0].content, /AABBA/);
  assert.match(fake.calls[1].messages[0].content, /AABBA/);
  assert.match(fake.calls[1].messages[1].content, /local headline/);
  assert.equal(result.content.text, body);
  assert.equal(result.editorial.candidates.length, 1);
});

test('editor cannot change meme template or output kind', () => {
  const original = { content: { kind: 'meme', template: 'bad', top_text: 'a', bottom_text: 'b' } };
  const parse = (raw) => parseContent(raw, { mode: 'meme' });
  assert.equal(parseEditorRevision(JSON.stringify({ revision: { kind: 'meme', template: 'rollsafe', top_text: 'a', bottom_text: 'b' } }), original, parse), null);
  assert.equal(parseEditorRevision(edit('text'), original, parse), null);
});

test('invalid rescue preserves the original content failure, but auth errors propagate', async () => {
  const parse = (raw) => parseDraftForRun(raw, { mode: 'meme', form: 'meme', seed: 'test' });
  const invalid = { ...author, content: textDraft('wrong kind') };
  const brokenMeme = editor(JSON.stringify({ kind: 'meme', template: 'nonexistent', top_text: 'a', bottom_text: 'b' }));
  await assert.rejects(run(routerFake([invalid, brokenMeme]), { parse }), /content_unexpected_kind/);
  await assert.rejects(run(routerFake([invalid, { status: 401 }]), { parse }), /router_failed:401:/);
});

test('font-only meme edits do not archive duplicate content; changed captions do', async () => {
  const parse = (raw) => parseDraftForRun(raw, { mode: 'meme', form: 'meme', seed: 'test' });
  const meme = { kind: 'meme', template: 'bad', top_text: 'a', bottom_text: 'b', font: 'impact' };
  const original = { ...author, content: JSON.stringify(meme) };
  const revision = (change) => editor(JSON.stringify({ revision: { ...meme, ...change } }));
  const kept = await run(routerFake([original, revision({ font: 'kalam' })]), { parse });
  assert.equal(kept.provider, 'aihubmix');
  assert.equal(kept.editorial.candidates.length, 1);
  const revised = await run(routerFake([original, revision({ top_text: 'better', font: 'unsupported-font' })]), { parse });
  assert.equal(revised.content.top_text, 'better');
  assert.equal(revised.editorial.candidates.length, 2);
  assert.equal(revised.content.font, kept.content.font);
});

test('truncated title normalization is idempotent', () => {
  const parse = (raw) => parseDraftForRun(raw, { mode: 'meme', form: 'meme', seed: 'test' });
  const original = parse(JSON.stringify({ kind: 'meme', template: 'bad', top_text: 'a', bottom_text: 'b', title: 'x'.repeat(119) + ' more' }));
  assert.equal(original.title, 'x'.repeat(119));
  assert.deepEqual(parse(JSON.stringify(original)), original);
});
