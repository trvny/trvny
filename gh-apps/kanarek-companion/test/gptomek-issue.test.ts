import assert from 'node:assert/strict';
import test from 'node:test';

import type { CompanionEnv } from '../src/companion-types.ts';
import {
  GPTOMEK_CONTROL_ISSUE,
  GPTOMEK_WAKE_LABEL,
  isGptomekControlIssueEvent,
} from '../src/gptomek-issue.ts';
import { companionTargets, isCompanionEvent } from '../src/index.ts';

const metadata = {
  action: 'edited',
  delivery: 'issue-delivery-1',
  event: 'issues',
  installationId: 152126523,
  repository: 'trvny/trvny',
};

const payload = {
  action: 'edited',
  changes: { body: { from: 'GPTomek control mailbox.' } },
  issue: {
    body: '<!-- gptomek-command:dGVzdA -->',
    number: GPTOMEK_CONTROL_ISSUE,
    state: 'open',
    user: { login: 'trvny' },
  },
  repository: { full_name: 'trvny/trvny' },
  sender: { login: 'trvny' },
};

test('routes marked body edits or wake-label toggles of open issue #203', () => {
  assert.equal(isGptomekControlIssueEvent(metadata, payload), true);
  assert.equal(isCompanionEvent(metadata, payload), true);
  const labelMetadata = { ...metadata, action: 'labeled' };
  const labelPayload = {
    ...payload,
    action: 'labeled',
    changes: undefined,
    label: { name: GPTOMEK_WAKE_LABEL },
  };
  assert.equal(isGptomekControlIssueEvent(labelMetadata, labelPayload), true);
  assert.equal(isCompanionEvent(labelMetadata, labelPayload), true);
  assert.equal(
    isGptomekControlIssueEvent(labelMetadata, {
      ...labelPayload,
      label: { name: 'bug' },
    }),
    false,
  );
  assert.equal(
    isGptomekControlIssueEvent(metadata, {
      ...payload,
      issue: { ...payload.issue, number: 204 },
    }),
    false,
  );
  assert.equal(
    isGptomekControlIssueEvent(metadata, {
      ...payload,
      issue: { ...payload.issue, state: 'closed' },
    }),
    false,
  );
  assert.equal(
    isGptomekControlIssueEvent(metadata, {
      ...payload,
      issue: { ...payload.issue, body: 'idle' },
    }),
    false,
  );
  assert.equal(
    isGptomekControlIssueEvent(metadata, {
      ...payload,
      changes: { title: { from: 'old' } },
    }),
    false,
  );
  assert.equal(
    isGptomekControlIssueEvent(metadata, {
      ...payload,
      sender: { login: 'someone' },
    }),
    false,
  );
});

test('maps a real issues payload into the serialized control target', async () => {
  const targets = await companionTargets(
    metadata,
    payload,
    { KANAREK_REPOSITORIES: 'trvny/trvny' } as CompanionEnv,
  );
  assert.deepEqual(targets, [
    {
      delivery: 'issue-delivery-1',
      installationId: 152126523,
      pullRequestNumber: GPTOMEK_CONTROL_ISSUE,
      repository: 'trvny/trvny',
      sourceEvent: 'issues',
    },
  ]);
});
