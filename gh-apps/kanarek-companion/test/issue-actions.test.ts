import assert from 'node:assert/strict';
import test from 'node:test';

import {
  issueStateReasonAllowed,
  nextIssueLabels,
} from '../src/issue-actions.ts';
import { customGptOpenApi } from '../src/router.ts';

test('issue actions are exposed in Custom GPT OpenAPI', () => {
  const document = customGptOpenApi('https://example.workers.dev') as {
    paths: Record<string, Record<string, { operationId?: string; description?: string }>>;
  };
  const operations = Object.values(document.paths).flatMap((path) => Object.values(path));
  const ids = operations.map((operation) => operation.operationId).filter(Boolean);

  assert.ok(ids.includes('getIssueContext'));
  assert.ok(ids.includes('triageIssueAsGptomek'));
  for (const operation of operations) {
    if (operation.description) assert.ok(operation.description.length <= 300);
  }
});

test('issue labels apply additive and subtractive triage', () => {
  assert.deepEqual(nextIssueLabels(['bug', 'android'], ['urgent'], ['android']), ['bug', 'urgent']);
  assert.deepEqual(nextIssueLabels(['bug'], undefined, ['bug']), []);
  assert.equal(nextIssueLabels(['bug'], undefined, undefined), undefined);
});

test('issue state reasons match their target state', () => {
  assert.equal(issueStateReasonAllowed('open', 'reopened'), true);
  assert.equal(issueStateReasonAllowed('open', 'completed'), false);
  assert.equal(issueStateReasonAllowed('closed', 'completed'), true);
  assert.equal(issueStateReasonAllowed('closed', 'not_planned'), true);
  assert.equal(issueStateReasonAllowed('closed', 'duplicate'), true);
  assert.equal(issueStateReasonAllowed('closed', 'reopened'), false);
  assert.equal(issueStateReasonAllowed('closed', { toString: () => 'completed' }), false);
});
