import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildMessages, editorMessages, loadStyleReference, parseContent,
  parseEditorRevision, renderMarkdown, resolveGenerationPlan,
} from '../generate.mjs';

const draft = (text) => JSON.stringify({ kind: 'text', text });

test('auto cycle has balanced forms with no long verse drought', () => {
  const plans = Array.from({ length: 40 }, (_, i) => resolveGenerationPlan('auto', 'seed', String(i + 1)));
  const count = Object.fromEntries(['prose', 'meme', 'verse', 'limerick', 'dialogue', 'parody']
    .map((form) => [form, plans.slice(0, 20).filter((plan) => plan.form === form).length]));
  assert.deepEqual(count, { prose: 7, meme: 4, verse: 2, limerick: 2, dialogue: 3, parody: 2 });
  assert.deepEqual(plans.slice(0, 20), plans.slice(20));
  assert.ok(plans.every((plan, i) => !i || plan.form !== plans[i - 1].form));
  assert.ok(plans.every((plan, i) => i % 5 !== 0 || ['verse', 'limerick'].includes(plan.form)));
  for (const form of ['text', 'meme', 'prose', 'verse', 'limerick', 'dialogue', 'parody']) {
    assert.deepEqual(resolveGenerationPlan(form, 'seed', '12'), { mode: form === 'meme' ? 'meme' : 'text', form });
  }
});

test('selected form is mandatory and scoped style excludes optional verse elsewhere', async () => {
  const style = await loadStyleReference();
  const prompt = (form) => {
    const plan = resolveGenerationPlan(form);
    return buildMessages(style, 'headline', 'seed', plan.mode, null, { form: plan.form })[0].content;
  };
  assert.match(prompt('verse'), /3–6行/);
  assert.match(prompt('verse'), /Original pocket verse/);
  assert.doesNotMatch(prompt('verse'), /"kind":"meme"/);
  assert.match(prompt('limerick'), /AABBA/);
  assert.match(prompt('dialogue'), /至少两个不同角色/);
  assert.match(prompt('parody'), /至少三行/);
  assert.doesNotMatch(prompt('prose'), /Original pocket verse/);
  assert.doesNotMatch(prompt('meme'), /Original pocket verse/);
  assert.match(editorMessages([], { content: { kind: 'text', text: 'line' } }, null, 'limerick')[0].content, /AABBA/);
});

test('strict form validation also rejects editor revisions that collapse a verse', () => {
  const body = 'One detail stays awake.\nAnother files a report.\nThe ceiling applies for a passport.';
  const parse = (raw) => parseContent(raw, { mode: 'text', form: 'verse' });
  const content = parse(draft(body));
  assert.equal(content.text, body);
  assert.throws(() => parse(draft('One line.')), /content_invalid_verse_lines/);
  assert.throws(() => parse(draft('A\n\nB\nC')), /content_invalid_verse_lines/);
  assert.equal(parseEditorRevision(JSON.stringify({ revision: { kind: 'text', text: 'One line.' } }), { content }, parse), null);
  assert.throws(() => parseContent(draft(body), { mode: 'text', form: 'limerick' }), /content_invalid_limerick_lines/);
  assert.doesNotThrow(() => parseContent(draft('A\nB\nC\nD\nE'), { mode: 'text', form: 'limerick' }));
  assert.doesNotThrow(() => parseContent(draft('A: What?\nB：A passport.'), { mode: 'text', form: 'dialogue' }));
  assert.doesNotThrow(() => parseContent(draft('AI (offscreen): Approved.\nClerk: It was a sandwich.'), { mode: 'text', form: 'dialogue' }));
  assert.throws(() => parseContent(draft('A: One\nA: Two'), { mode: 'text', form: 'dialogue' }), /content_invalid_dialogue_lines/);
  assert.throws(() => parseContent(draft('https://a.test\nhttps://b.test'), { mode: 'text', form: 'dialogue' }), /content_invalid_dialogue_lines/);
  assert.doesNotThrow(() => parseContent(draft('Deputy Commissioner for Procedural Compliance: Approved.\nClerk: It was a sandwich.'), { mode: 'text', form: 'dialogue' }));
  assert.throws(() => parseContent(draft('A\n\nB\nC\nD\nE'), { mode: 'text', form: 'limerick' }), /content_invalid_limerick_lines/);
  assert.throws(() => parseContent(draft('Notice.'), { mode: 'text', form: 'parody' }), /content_invalid_parody_lines/);
  assert.doesNotThrow(() => parseContent(draft(body), { mode: 'text', form: 'parody' }));
  const markdown = renderMarkdown({ content, provider: 'test', model: 'test', generated_at: '2026-11-13T20:00:00Z' });
  assert.ok(markdown.includes('> One detail stays awake.  \n> Another files a report.  \n> The ceiling applies for a passport.'));
});
