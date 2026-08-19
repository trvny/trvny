import assert from 'node:assert/strict';
import test from 'node:test';

import {
  commandMarker,
  handleGptomekControl,
} from '../src/gptomek.ts';
import type { CompanionEnv, CompanionTarget, PullRequest } from '../src/companion-types.ts';

const target: CompanionTarget = {
  delivery: 'delivery-encoding',
  installationId: 1,
  pullRequestNumber: 176,
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
  merged: true,
  number: 176,
  state: 'closed',
  title: 'GPTomek control channel',
  user: { login: 'trvny' },
};

const command = {
  id: 'encoding-1',
  op: 'comment',
  repository: 'trvny/trvny',
  pullRequestNumber: 176,
  body: 'hello',
};

function paddedStandardMarker(): string {
  const token = commandMarker(command).match(/gptomek-command:([^\s]+)/)?.[1];
  assert.ok(token);
  const standard = token.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (standard.length % 4)) % 4);
  return `<!-- gptomek-command:${standard}${padding} -->`;
}

test('recognizes padded standard Base64 command markers', async () => {
  await assert.rejects(
    handleGptomekControl(
      target,
      { ...controlPr, body: paddedStandardMarker() },
      {} as CompanionEnv,
    ),
    /invalid_gptomek_app_id/,
  );
});

test('surfaces malformed command markers instead of treating them as idle', async () => {
  await assert.rejects(
    handleGptomekControl(
      target,
      { ...controlPr, body: '<!-- gptomek-command:not*base64 -->' },
      {} as CompanionEnv,
    ),
    /invalid_command_encoding/,
  );
});

test('rejects ambiguous bodies with more than one command marker', async () => {
  const marker = commandMarker(command);
  await assert.rejects(
    handleGptomekControl(
      target,
      { ...controlPr, body: `${marker}\n${marker}` },
      {} as CompanionEnv,
    ),
    /invalid_command_encoding/,
  );
});
