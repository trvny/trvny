import assert from 'node:assert/strict';
import test from 'node:test';

import {
  commandMarker,
  handleGptomekControl,
  isGptomekControlPr,
} from '../src/gptomek.ts';
import type { CompanionEnv, CompanionTarget, PullRequest } from '../src/companion-types.ts';

const target: CompanionTarget = {
  delivery: 'delivery-1',
  installationId: 1,
  pullRequestNumber: 999,
  repository: 'trvny/trvny',
  sourceEvent: 'pull_request',
};

const controlPr: PullRequest = {
  additions: 1,
  auto_merge: null,
  base: { ref: 'main', sha: 'a'.repeat(40) },
  body: 'GPTomek control channel.',
  changed_files: 1,
  deletions: 0,
  draft: true,
  head: {
    ref: 'gptomek/control',
    repo: { full_name: 'trvny/trvny' },
    sha: 'b'.repeat(40),
  },
  labels: [],
  mergeable: true,
  mergeable_state: 'clean',
  merged: false,
  number: 999,
  state: 'open',
  title: 'GPTomek control channel',
  user: { login: 'trvny' },
};

test('recognizes only the private GPTomek control PR', () => {
  assert.equal(isGptomekControlPr(target, controlPr), true);
  assert.equal(
    isGptomekControlPr(
      { ...target, repository: 'trvny/feeds' },
      controlPr,
    ),
    false,
  );
  assert.equal(
    isGptomekControlPr(target, { ...controlPr, user: { login: 'someone' } }),
    false,
  );
});

test('keeps an idle control PR out of normal Kanarek handling', async () => {
  const result = await handleGptomekControl(
    target,
    controlPr,
    {} as CompanionEnv,
  );
  assert.deepEqual(result, { control: true, handled: false });
});

test('encodes commands in a single hidden marker', () => {
  const marker = commandMarker({
    id: 'test-1',
    op: 'comment',
    repository: 'trvny/feeds',
    pullRequestNumber: 12,
    body: 'hello',
  });
  assert.match(marker, /^<!-- gptomek-command:[A-Za-z0-9_-]+ -->$/);
  assert.equal(marker.includes('hello'), false);
});
