import assert from 'node:assert/strict';
import test from 'node:test';

import { grokDispatchTarget } from '../src/companion/grok-review-dispatch.ts';

const sha = 'a'.repeat(40);

function payload(overrides: Record<string, unknown> = {}) {
  return {
    action: 'synchronize',
    repository: { full_name: 'travnie/aistee' },
    number: 42,
    pull_request: {
      draft: false,
      user: { login: 'trvny' },
      head: { sha, repo: { full_name: 'travnie/aistee' } },
      labels: [],
      ...overrides,
    },
  };
}

test('only review-worthy pull requests reach central dispatch', () => {
  assert.deepEqual(grokDispatchTarget('pull_request', payload()), {
    repository: 'travnie/aistee',
    number: 42,
    head_sha: sha,
  });
  assert.equal(grokDispatchTarget('issues', payload()), null);
  assert.equal(grokDispatchTarget('pull_request', { ...payload(), action: 'closed' }), null);
  for (const action of ['opened', 'reopened', 'ready_for_review']) {
    assert.ok(grokDispatchTarget('pull_request', { ...payload(), action }));
  }
});

test('never dispatch untrusted or unreviewable heads', () => {
  const invalid = [
    { draft: true },
    { user: { login: 'dependabot[bot]' } },
    { head: { sha, repo: { full_name: 'another/fork' } } },
    { head: { sha: 'bad', repo: { full_name: 'travnie/aistee' } } },
    { labels: [{ name: 'no-goblin' }] },
  ];
  for (const value of invalid) {
    assert.equal(grokDispatchTarget('pull_request', payload(value)), null);
  }
  assert.equal(grokDispatchTarget('pull_request',
    { ...payload(), repository: { full_name: 'random-org/other' } }), null);
  assert.equal(grokDispatchTarget('pull_request', { ...payload(), number: -1 }), null);
});
