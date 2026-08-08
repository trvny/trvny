import assert from 'node:assert/strict';
import test from 'node:test';

import { reactionForState, syncReaction } from '../src/companion-reactions.ts';
import type { GitHubInstallationClient } from '../src/github-app.ts';

test('maps PR states to restrained reactions', () => {
  assert.equal(reactionForState('draft'), 'eyes');
  assert.equal(reactionForState('waiting'), 'eyes');
  assert.equal(reactionForState('blocked'), 'eyes');
  assert.equal(reactionForState('ready'), 'rocket');
  assert.equal(reactionForState('merged'), 'hooray');
  assert.equal(reactionForState('closed'), null);
  assert.equal(reactionForState('disabled'), null);
});

test('replaces the previous companion reaction', async () => {
  const created: Array<{ body?: BodyInit | null; method?: string; operation: string; path: string }> = [];
  const deleted: string[] = [];
  const client = {
    async paginate() {
      return [
        { id: 1, content: 'eyes', user: { login: 'kanarek-companion[bot]', type: 'Bot' } },
        { id: 2, content: 'heart', user: { login: 'kanarek-companion[bot]', type: 'Bot' } },
        { id: 3, content: 'rocket', user: { login: 'someone', type: 'User' } },
      ];
    },
    async json(path: string, operation: string, init: RequestInit = {}) {
      created.push({ body: init.body, method: init.method, operation, path });
      return {};
    },
    async void(path: string) {
      deleted.push(path);
    },
  } as unknown as GitHubInstallationClient;

  assert.equal(
    await syncReaction(client, 'kanarek-companion', 'trvny/trvny', 160, 'ready'),
    true,
  );
  assert.deepEqual(deleted, ['/repos/trvny/trvny/issues/160/reactions/1']);
  assert.deepEqual(created, [
    {
      body: JSON.stringify({ content: 'rocket' }),
      method: 'POST',
      operation: 'create_pull_request_reaction',
      path: '/repos/trvny/trvny/issues/160/reactions',
    },
  ]);
});

test('keeps an already synchronized reaction without another POST', async () => {
  let created = false;
  let deleted = false;
  const client = {
    async paginate() {
      return [
        { id: 1, content: 'rocket', user: { login: 'kanarek-companion[bot]', type: 'Bot' } },
      ];
    },
    async json() {
      created = true;
      return {};
    },
    async void() {
      deleted = true;
    },
  } as unknown as GitHubInstallationClient;

  assert.equal(
    await syncReaction(client, 'kanarek-companion', 'trvny/trvny', 160, 'ready'),
    false,
  );
  assert.equal(created, false);
  assert.equal(deleted, false);
});

test('clears managed reactions when Kanarek is disabled', async () => {
  const deleted: string[] = [];
  const client = {
    async paginate() {
      return [
        { id: 7, content: 'eyes', user: { login: 'kanarek-companion[bot]', type: 'Bot' } },
      ];
    },
    async json() {
      throw new Error('should_not_create');
    },
    async void(path: string) {
      deleted.push(path);
    },
  } as unknown as GitHubInstallationClient;

  assert.equal(
    await syncReaction(client, 'kanarek-companion', 'trvny/trvny', 160, 'disabled'),
    true,
  );
  assert.deepEqual(deleted, ['/repos/trvny/trvny/issues/160/reactions/7']);
});
