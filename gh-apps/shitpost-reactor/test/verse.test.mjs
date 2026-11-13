import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildMessages,
  judgeMessages,
  parseContent,
  renderMarkdown,
  resolveGenerationPlan,
} from '../generate.mjs';

test('occasional verse suggestion is deterministic and only applies to auto', () => {
  const results = Array.from({ length: 120 }, (_, index) =>
    resolveGenerationPlan('auto', 'seed', String(index + 1)).shortVerseHint);
  assert.deepEqual(results, Array.from({ length: 120 }, (_, index) =>
    resolveGenerationPlan('auto', 'seed', String(index + 1)).shortVerseHint));
  const count = results.filter(Boolean).length;
  assert.ok(count >= 8 && count <= 34, `short verse picks: ${count}`);
  assert.equal(resolveGenerationPlan('auto', 'seed', '12').limerickLanguage, null);
  assert.equal(resolveGenerationPlan('text', 'seed', '12').shortVerseHint, false);
  assert.equal(resolveGenerationPlan('meme', 'seed', '12').shortVerseHint, false);
});

test('verse nudge has its own loose form without replacing regular prose or memes', () => {
  const hinted = buildMessages('# style', 'a curious local headline', 'seed', 'auto',
    null, { shortVerseHint: true });
  assert.match(hinted[0].content, /3–6 short lines/);
  assert.match(hinted[0].content, /NOT the formal AABBA limerick/);
  assert.match(hinted[0].content, /Choose normal prose or a meme/);
  assert.match(hinted[0].content, /Do not copy bot review poems/);
  const normal = buildMessages('# style', 'headline', 'seed', 'auto');
  assert.doesNotMatch(normal[0].content, /pocket verse of 3–6/);
  assert.match(normal[0].content, /1–3句/);
  assert.match(hinted[0].content, /"kind":"meme"/);
  const judge = judgeMessages([{ content: { kind: 'text', text: 'line' } }], {});
  assert.match(judge[0].content, /保留有意义的换行与节奏/);
});

test('text drafts retain poem line breaks across JSON and Markdown', () => {
  const body = 'One detail stays awake.\nAnother files a report.\nThe ceiling applies for a passport.';
  const content = parseContent(JSON.stringify({ kind: 'text', title: 'Inspection', text: body }),
    { mode: 'auto' });
  assert.equal(content.text, body);
  const markdown = renderMarkdown({
    content, provider: 'test', model: 'test', generated_at: '2026-11-13T20:00:00Z',
  });
  assert.match(markdown, /> One detail stays awake\.\n> Another files a report\.\n> The ceiling applies for a passport\./);
});
