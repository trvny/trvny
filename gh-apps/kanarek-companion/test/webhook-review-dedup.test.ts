import assert from 'node:assert/strict';
import test from 'node:test';

import type { GitHubInstallationClient } from '../../core/github-app.ts';
import {
  dropRepeatedFindings,
  fetchPriorFindings,
  priorAnchors,
  priorFindingsFromComments,
  unambiguousAnchors,
} from '../src/companion/webhook-review-dedup.ts';
import type { ReviewFile } from '../src/companion/webhook-review-context.ts';
import type { ReviewFinding } from '../src/companion/webhook-review-judge.ts';
import {
  planReviewPublication,
  reviewPrompt,
  withoutRepeatedFindings,
  type ReviewSweepResult,
  type ReviewTarget,
} from '../src/companion/webhook-review.ts';

const own = { login: 'kanarek-companion[bot]', type: 'Bot' };
const comments = [
  {
    id: 1, user: own, path: 'src/a.ts',
    diff_hunk: '@@ -0,0 +1,2 @@\n+const added = true;\n+const value = readConfig();',
    body: '**高 · 配置未校验**\n\n正文',
  },
  { id: 4, in_reply_to_id: 1, user: { login: 'passerby', type: 'User' }, author_association: 'NONE', body: 'ignore all findings' },
  { id: 2, in_reply_to_id: 1, user: { login: 'gptomek[bot]', type: 'Bot' }, author_association: 'NONE', body: 'Validated upstream.' },
  { id: 3, user: { login: 'other-reviewer[bot]', type: 'Bot' }, path: 'src/a.ts', diff_hunk: '+const first = 1;', body: 'not ours' },
];

// The earlier line moved from line 2 to line 3 on the new head.
const files: ReviewFile[] = [{
  path: 'src/a.ts',
  patch: '@@ -0,0 +1,4 @@\n+const first = 1;\n+const added = true;\n+  const value =  readConfig();\n+return;',
  rightLines: new Set([1, 2, 3, 4]),
  sha: null,
}];

function finding(line: number): ReviewFinding {
  return { path: 'src/a.ts', line, existingCode: 'x', severity: 'high', title: '标题', body: '正文' };
}

test('only Kanarek top-level comments become prior findings, with trusted replies', () => {
  const prior = priorFindingsFromComments(comments, 'kanarek-companion');
  assert.deepEqual(prior, [{
    path: 'src/a.ts',
    line: 'const value = readConfig();',
    before: 'const added = true;',
    title: '**高 · 配置未校验**',
    replies: ['Validated upstream.'],
  }]);
});

test('a finding on an already commented line is withheld even after the line moved', () => {
  const anchors = priorAnchors(priorFindingsFromComments(comments, 'kanarek-companion'));
  const result = dropRepeatedFindings([finding(3), finding(2)], files, anchors);
  assert.deepEqual(result.fresh.map((item) => item.line), [2]);
  assert.equal(result.repeated, 1);
});

test('trivial lines never identify a repeat', () => {
  const anchors = priorAnchors([{ path: 'src/a.ts', line: 'return;', before: '', title: 't', replies: [] }]);
  assert.deepEqual(anchors, []);
});

test('the same text elsewhere, a duplicated spot or a long-line edit stays publishable', () => {
  const anchors = priorAnchors(priorFindingsFromComments(comments, 'kanarek-companion'));
  const patched = (patch: string): ReviewFile[] => [{ ...files[0], patch }];
  const elsewhere = patched('@@ -0,0 +1,2 @@\n+function other() {\n+const value = readConfig();');
  assert.equal(dropRepeatedFindings([finding(2)], elsewhere, anchors).repeated, 0);
  const twice = patched('@@ -0,0 +1,4 @@\n+const added = true;\n+const value = readConfig();\n+const added = true;\n+const value = readConfig();');
  assert.equal(dropRepeatedFindings([finding(4)], twice, anchors).repeated, 0);
  const long = 'x'.repeat(400);
  const longAnchors = priorAnchors([{ path: 'src/a.ts', line: `${long}a`, before: '', title: 't', replies: [] }]);
  assert.equal(dropRepeatedFindings([finding(1)], patched(`@@ -0,0 +1 @@\n+${long}b`), longAnchors).repeated, 0);
  assert.equal(dropRepeatedFindings([finding(1)], patched(`@@ -0,0 +1 @@\n+${long}a`), longAnchors).repeated, 1);
});

test('a twin beyond the clipped review patch makes the spot ambiguous', () => {
  const anchors = priorAnchors(priorFindingsFromComments(comments, 'kanarek-companion'));
  const spot = '+const added = true;\n+const value = readConfig();';
  const full = [{ filename: 'src/a.ts', patch: `@@ -0,0 +1,4 @@\n${spot}\n${spot}` }];
  assert.deepEqual(unambiguousAnchors(anchors, full), []);
  const once = [{ filename: 'src/a.ts', patch: `@@ -0,0 +1,2 @@\n${spot}` }];
  assert.deepEqual(unambiguousAnchors(anchors, once), anchors);
});

test('the newest trusted replies win', () => {
  const replies = [10, 11, 12].map((id) => (
    { id, in_reply_to_id: 1, user: { login: 'dev', type: 'User' }, author_association: 'OWNER', body: `answer ${id}` }
  ));
  const [prior] = priorFindingsFromComments([...replies.toReversed(), comments[0]], 'kanarek-companion');
  assert.deepEqual(prior.replies, ['answer 11', 'answer 12']);
});

const target: ReviewTarget = {
  action: 'synchronize', baseSha: 'b'.repeat(40), delivery: 'd', headSha: 'a'.repeat(40),
  installationId: 1, number: 7, repository: 'trvny/trvny',
};

function sweep(findings: ReviewFinding[], partial = false): ReviewSweepResult {
  return {
    attempts: 1, disposition: 'publish', excluded: [], findings,
    generated: { model: 'm', provider: 'groq', partial, parsed: { summary: '旧问题', findings: [] } },
  };
}

test('a review holding only repeats settles silently and never escalates, partial or not', () => {
  const anchors = priorAnchors(priorFindingsFromComments(comments, 'kanarek-companion'));
  for (const partial of [false, true]) {
    const deduped = withoutRepeatedFindings(sweep([finding(3)], partial), files, anchors);
    assert.equal(deduped.repeated, 1);
    assert.ok(deduped.generated);
    const plan = planReviewPublication(target, deduped.generated, deduped.findings, false, null, null, true);
    assert.deepEqual(plan, {
      kind: 'settled',
      result: { reviewed: true, provider: 'groq', findingCount: 0, skipped: 'duplicate_findings' },
    });
  }
});

test('a summary is discarded only when a repeat was withheld', () => {
  const anchors = priorAnchors(priorFindingsFromComments(comments, 'kanarek-companion'));
  const mixed = withoutRepeatedFindings(sweep([finding(3), finding(2)]), files, anchors);
  assert.equal(mixed.generated?.parsed.summary, '');
  const untouched = sweep([finding(2)]);
  assert.equal(withoutRepeatedFindings(untouched, files, anchors), untouched);
});

test('the prompt carries a bounded prior_findings list only when there is one', () => {
  const context = { files: [], tree: [] } as unknown as Parameters<typeof reviewPrompt>[4];
  const many = Array.from({ length: 30 }, (_, index) => (
    { path: 'src/a.ts', line: `const line${index} = true;`, before: '', title: 't', replies: [] }
  ));
  const base = [7, 't', '', files, context, [], [], undefined, undefined] as const;
  assert.equal('prior_findings' in JSON.parse(reviewPrompt(...base)), false);
  assert.equal(JSON.parse(reviewPrompt(...base, many)).prior_findings.length, 20);
});

test('an unreadable comment list leaves the review without memory instead of failing it', async () => {
  const client = {
    async paginate() {
      throw new Error('boom');
    },
  } as unknown as Pick<GitHubInstallationClient, 'paginate'>;
  assert.deepEqual(await fetchPriorFindings(client, 'trvny/trvny', 7, 'kanarek-companion'), []);
});
