import assert from 'node:assert/strict';
import test from 'node:test';
import { liveReviewBadge } from '../src/companion/companion-review-threads.ts';

const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const slug = 'kanarek-companion';
const findings = 'AI review 🐤 findings';
const posted = 'AI review ✅ posted';
const resolved = 'AI review ✅ resolved';

function thread(isResolved: boolean, sha = head, login = slug, kind = 'Bot', marker = true) {
  return {
    isResolved,
    comments: { nodes: [{ pullRequestReview: {
      author: { login, __typename: kind },
      body: marker ? `<!-- kanarek-review:${sha}:${base} -->\nsummary` : 'Other review',
      commit: { oid: sha },
    } }] },
  };
}

function page(nodes: unknown[], next: string | null = null, sha = head) {
  return { data: { repository: { pullRequest: {
    headRefOid: sha,
    reviewThreads: { nodes, pageInfo: { hasNextPage: next !== null, endCursor: next } },
  } } } };
}

async function query(pages: unknown[], fallback: string | null = findings) {
  const cursors: Array<string | null> = [];
  const queue = [...pages];
  const client = {
    json: async <T>(path: string, operation: string, init?: RequestInit): Promise<T> => {
      assert.equal(path, '/graphql');
      assert.equal(operation, 'companion_review_threads');
      assert.equal(init?.method, 'POST');
      const input = JSON.parse(String(init?.body));
      assert.equal(input.variables.owner, 'travnie');
      assert.equal(input.variables.name, 'Autka');
      assert.equal(input.variables.number, 289);
      cursors.push(input.variables.after);
      assert.ok(queue.length);
      return queue.shift() as T;
    },
  };
  const badge = await liveReviewBadge(client, 'travnie/Autka', 289, head, slug, fallback);
  return { badge, cursors };
}

test('all current Kanarek threads resolved; ignore other reviewers and older heads', async () => {
  const state = await query([page([
    thread(true), thread(true, head, slug + '[bot]'),
    thread(false, base), thread(false, head, 'some-other-bot'),
    thread(false, head, slug, 'User'), thread(false, head, slug, 'Bot', false),
  ])]);
  assert.deepEqual(state, { badge: resolved, cursors: [null] });
});

test('unresolved current finding restores warning; recovered posted outcome is reconciled too', async () => {
  assert.equal((await query([page([thread(true), thread(false)])])).badge, findings);
  assert.equal((await query([page([thread(false)])], posted)).badge, findings);
  assert.equal((await query([page([thread(true)])], posted)).badge, resolved);
});

test('scan every page before declaring resolution', async () => {
  assert.deepEqual(await query([page([thread(true)], 'next'), page([thread(false)])]),
    { badge: findings, cursors: [null, 'next'] });
  assert.deepEqual(await query([page([thread(true)], 'next'), page([thread(true)])]),
    { badge: resolved, cursors: [null, 'next'] });
});

test('missing, malformed, stale or partial data never claims resolution', async () => {
  assert.equal((await query([page([])])).badge, findings);
  assert.equal((await query([page([thread(true)], null, base)])).badge, findings);
  assert.equal((await query([{ ...page([thread(true)]), errors: [{ message: 'partial' }] }])).badge, findings);
  assert.equal((await query([page([thread(true)], 'same'), page([], 'same')])).badge, findings);
  assert.equal((await query([page([null])])).badge, findings);
  assert.equal((await query([undefined])).badge, findings);
  const down = { json: async () => { throw new Error('offline'); } };
  assert.equal(await liveReviewBadge(down, 'travnie/Autka', 289, head, slug, findings), findings);
});

test('clean, running and unavailable jobs do not fetch review threads', async () => {
  for (const badge of [null, 'AI review ✅ clean', 'AI review 🔄 running', 'AI review ⚠️ unavailable']) {
    assert.deepEqual(await query([], badge), { badge, cursors: [] });
  }
});
