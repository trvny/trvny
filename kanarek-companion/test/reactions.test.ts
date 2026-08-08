import assert from 'node:assert/strict';
import test from 'node:test';

import { reactForState, reactionForState } from '../src/companion-reactions.ts';
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

test('posts the mapped reaction to the PR issue endpoint', async () => {
  const calls: Array<{ body?: BodyInit | null; method?: string; operation: string; path: string }> = [];
  const client = {
    async json(
      path: string,
      operation: string,
      init: RequestInit = {},
    ) {
      calls.push({ body: init.body, method: init.method, operation, path });
      return {};
    },
  } as unknown as GitHubInstallationClient;

  assert.equal(await reactForState(client, 'trvny/trvny', 160, 'ready'), true);
  assert.deepEqual(calls, [
    {
      body: JSON.stringify({ content: 'rocket' }),
      method: 'POST',
      operation: 'create_pull_request_reaction',
      path: '/repos/trvny/trvny/issues/160/reactions',
    },
  ]);
});

test('skips states without a reaction', async () => {
  let called = false;
  const client = {
    async json() {
      called = true;
      return {};
    },
  } as unknown as GitHubInstallationClient;

  assert.equal(await reactForState(client, 'trvny/trvny', 160, 'closed'), false);
  assert.equal(called, false);
});
