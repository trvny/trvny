import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareGroqFreeReview } from '../src/groq-review.ts';

function reviewInput(diff: string, context: unknown = { files: [], callers: [], dependency_evidence: [] }) {
  return {
    model: 'openai/gpt-oss-120b',
    max_tokens: 36_864,
    messages: [
      { role: 'system', content: 'Review this pull request carefully.' },
      { role: 'user', content: JSON.stringify({ diff, repository_context: context }) },
    ],
  };
}

test('Groq keeps a complete small review and caps reasoning output within free TPM', () => {
  const original = reviewInput('### main.ts\n@@ -0,0 +1 @@\n+const x = 1;');
  const prepared = prepareGroqFreeReview(original);
  assert.ok(prepared);
  assert.equal(prepared.partial, false);
  assert.ok((prepared.input.max_tokens as number) >= 2_048);
  assert.ok((prepared.input.max_tokens as number) <= 4_096);
  assert.equal(original.max_tokens, 36_864);
  const user = (prepared.input.messages as Array<{ content: string }>)[1];
  const payload = JSON.parse(user.content) as { diff: string };
  assert.equal(payload.diff, '### main.ts\n@@ -0,0 +1 @@\n+const x = 1;');
});

test('Groq removes excess repository context before reducing the diff', () => {
  const diff = '### main.ts\n@@ -0,0 +1 @@\n+const x = 1;';
  const prepared = prepareGroqFreeReview(reviewInput(diff, {
    files: [{ path: 'context.ts', content: 'x'.repeat(80_000) }],
    callers: [{ content: 'y'.repeat(2_000) }],
  }));
  assert.ok(prepared);
  assert.equal(prepared.partial, false);
  const user = (prepared.input.messages as Array<{ content: string }>)[1];
  const payload = JSON.parse(user.content) as {
    diff: string;
    repository_context: { files: unknown[]; callers: unknown[] };
  };
  assert.equal(payload.diff, diff);
  assert.deepEqual(payload.repository_context.files, []);
  assert.deepEqual(payload.repository_context.callers, []);
});

test('Groq marks a large review as partial instead of pretending it saw all files', () => {
  const diff = [
    '### a.ts\n@@ -1 +1 @@\n+' + 'a'.repeat(7_000),
    '### b.ts\n@@ -1 +1 @@\n+' + 'b'.repeat(7_000),
    '### c.ts\n@@ -1 +1 @@\n+' + 'c'.repeat(7_000),
  ].join('\n\n');
  const prepared = prepareGroqFreeReview(reviewInput(diff));
  assert.ok(prepared);
  assert.equal(prepared.partial, true);
  const payload = JSON.parse(
    (prepared.input.messages as Array<{ content: string }>)[1].content,
  ) as { diff: string; review_scope: string };
  assert.ok(payload.diff.length > 0);
  assert.ok(payload.diff.length < diff.length);
  assert.match(payload.review_scope, /partial_free_tier/);
  assert.ok((prepared.input.max_tokens as number) >= 2_048);
});

test('Groq skips unstructured oversized input without silently dropping it', () => {
  assert.equal(prepareGroqFreeReview({
    messages: [{ role: 'user', content: 'x'.repeat(80_000) }],
    max_tokens: 36_864,
  }), null);
});
