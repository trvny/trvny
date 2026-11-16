import assert from 'node:assert/strict';
import test from 'node:test';
import { commentWireFormat, decodeGptomekComment } from '../src/gptomek/gptomek-comment.ts';

const envelope = (value: unknown) => '```gptomek\n' + JSON.stringify(value) + '\n```';
const boundary = 'example_123';
const marker = `\n--${boundary}--\n`;
const raw = (header: unknown, ...blocks: string[]) =>
  `\`\`\`gptomek\nraw-v1 ${boundary}\n${JSON.stringify(header)}${blocks.length ? marker + blocks.join(marker) + marker.slice(0, -1) : ''}\n\`\`\``;
const common = { id: 'example', repository: 'trvny/trvny', branch: 'feat/test', expectedHeadSha: 'a'.repeat(40), message: 'test' };

test('legacy JSON and raw multi-file commands decode identically', () => {
  const content = ['const x = "hello";\r\n\\path\n', '', '\ufeffno final newline', 'ends in CR\r', '```\n```gptomek\n雪\n\n'];
  const files = content.map((text, i) => ({ path: `file-${i}`, content: text }));
  const legacy = { ...common, op: 'commit_files', files: [...files, { path: 'removed', content: null }] };
  const hybrid = { ...legacy, files: [...files.map((f, i) => ({ ...f, content: { raw: i + 1 } })), { path: 'removed', content: null }] };
  assert.deepEqual(decodeGptomekComment(raw(hybrid, ...content)), decodeGptomekComment(envelope(legacy)));
});

test('patch, review reply and batch hydrate only supported slots', () => {
  const patch = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n';
  const body = 'fixed\n```js\n"x"\n```';
  const command = { id: 'batch', repository: 'trvny/trvny', op: 'batch', steps: [
    { op: 'review_fix', patch: { raw: 2 }, replyBody: { raw: 1 } },
    { op: 'reply_review', body: 'inline' },
    { op: 'operator_action', body: { raw: 42 } },
  ] };
  const expected = { ...command, steps: [{ op: 'review_fix', patch, replyBody: body }, ...command.steps.slice(1)] };
  assert.deepEqual(decodeGptomekComment(raw(command, body, patch)), expected);
  for (const op of ['apply_patch', 'branch_from_patch']) {
    assert.deepEqual(decodeGptomekComment(raw({ ...common, op, patch: { raw: 1 } }, patch)), { ...common, op, patch });
  }
});

test('bad references, unused slots, collision and extra text fail closed', () => {
  const patch = (ref: unknown) => ({ ...common, op: 'apply_patch', patch: ref });
  for (const ref of [{ raw: 0 }, { raw: 2 }, { raw: 1.5 }, { raw: '1' }, { raw: 1, other: true }]) {
    assert.throws(() => decodeGptomekComment(raw(patch(ref), 'text')), /invalid_comment_raw_reference/);
  }
  assert.throws(() => decodeGptomekComment(raw(patch('inline'), 'extra')), /invalid_comment_raw_unused_block/);
  assert.throws(() => decodeGptomekComment(raw(patch({ raw: 1 }), `a${marker}b`)), /invalid_comment_raw_unused_block/);
  assert.throws(() => decodeGptomekComment(raw({ ...common, op: 'commit_files', files: [{ content: { raw: 1 } }, { content: { raw: 1 } }] }, 'text')), /invalid_comment_raw_reference/);
  assert.throws(() => decodeGptomekComment(raw(patch({ raw: 1 }), 'text').replace(marker.slice(0, -1) + '\n```', '\n```')), /invalid_comment_raw_framing/);
  assert.throws(() => decodeGptomekComment(raw(patch({ raw: 1 }), 'text') + '\nextra'), /invalid_comment_command/);
  assert.throws(() => decodeGptomekComment('```gptomek\nnot JSON\n```'), /invalid_comment_command_json/);
});

test('header-only commands and deletion-only files use the same raw-v1 format', () => {
  for (const command of [
    { ...common, op: 'react_issue_comment', commentId: 123, reaction: 'eyes' },
    { ...common, op: 'delete_branch' },
    { ...common, op: 'commit_files', files: [{ path: 'old', content: null }] },
    { ...common, op: 'operator_action', body: { raw: 42 } },
    { ...common, op: 'batch', steps: [{ op: 'react_review_comment', commentId: 123, reaction: '+1' }] },
  ]) {
    assert.deepEqual(decodeGptomekComment(raw(command)), decodeGptomekComment(envelope(command)));
  }
  assert.throws(() => decodeGptomekComment(raw({ ...common, op: 'apply_patch', patch: { raw: 1 } })), /invalid_comment_raw_reference/);
});

test('CRLF framing preserves arbitrary block endings without normalizing content', () => {
  const content = ['mixed\nline\r\n', 'ends in CR\r', '', 'no newline'];
  const header = { ...common, op: 'commit_files', files: content.map((_, i) => ({ path: 'file-' + i, content: { raw: i + 1 } })) };
  const crMarker = '\r\n--' + boundary + '--\r\n';
  const framed = '```gptomek\r\nraw-v1 ' + boundary + '\r\n' + JSON.stringify(header) + crMarker + content.join(crMarker) + crMarker + '```';
  assert.deepEqual(decodeGptomekComment(framed), decodeGptomekComment(raw(header, ...content)));
  assert.deepEqual(decodeGptomekComment(raw(common).replaceAll('\n', '\r\n')), common);
});

test('bounds and dangling delimiters are rejected before execution', () => {
  for (const invalid of ['short', 'a'.repeat(65), 'bad boundary']) {
    assert.throws(() => decodeGptomekComment(raw(common).replace(boundary, invalid)), /invalid_comment_raw_framing/);
  }
  assert.throws(() => decodeGptomekComment(raw(common, ...Array(321).fill('x'))), /invalid_comment_raw_framing/);
  assert.throws(() => decodeGptomekComment(raw(common).replace('\n```', marker + 'unterminated\n```')), /invalid_comment_raw_framing/);
});

test('audit identifies valid envelopes and malformed raw preambles', () => {
  assert.equal(commentWireFormat(envelope(common)), 'legacy-json');
  assert.equal(commentWireFormat(raw(common)), 'raw-v1');
  assert.equal(commentWireFormat(raw(common).replace(boundary, 'short')), 'raw-v1');
  assert.equal(commentWireFormat(raw(common).replaceAll('\n', '\r\n')), 'raw-v1');
  assert.equal(commentWireFormat(raw(common) + '\nextra'), 'unknown');
  assert.equal(commentWireFormat('unrelated comment'), 'unknown');
});

test('one redundant marker on a header-only command is harmless', () => {
  const command = { ...common, op: 'commit_tree', entries: [{ path: 'x', sha: 'b'.repeat(40) }] };
  const marked = raw(command).replace('\n```', marker + '```');
  assert.deepEqual(decodeGptomekComment(marked), command);
  assert.deepEqual(decodeGptomekComment(marked.replaceAll('\n', '\r\n')), command);
  const missing = raw({ ...common, op: 'apply_patch', patch: { raw: 1 } }).replace('\n```', marker + '```');
  assert.throws(() => decodeGptomekComment(missing), /invalid_comment_raw_reference/);
  assert.throws(() => decodeGptomekComment(raw(command, '')), /invalid_comment_raw_unused_block/);
  assert.throws(() => decodeGptomekComment(marked.replace('\n```', marker + '```')), /invalid_comment_raw_framing/);
});
