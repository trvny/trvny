import assert from 'node:assert/strict';
import test from 'node:test';

import { customGptOpenApi, restrictedBotWrite } from '../src/router.ts';
import { workflowControlAllowed } from '../src/workflow-actions.ts';

test('workflow control is exposed in Custom GPT OpenAPI', () => {
  const document = customGptOpenApi('https://example.workers.dev') as {
    paths: Record<string, Record<string, { operationId?: string; description?: string }>>;
  };
  const operations = Object.values(document.paths)
    .flatMap((path) => Object.values(path))
    .filter((operation) => operation.operationId);

  assert.ok(operations.some((operation) => operation.operationId === 'controlWorkflowRun'));
  for (const operation of operations) {
    if (operation.description) assert.ok(operation.description.length <= 300);
  }
});

test('workflow control only permits state-compatible operations', () => {
  assert.equal(workflowControlAllowed('cancel', 'queued', null), true);
  assert.equal(workflowControlAllowed('cancel', 'in_progress', null), true);
  assert.equal(workflowControlAllowed('cancel', 'completed', 'failure'), false);
  assert.equal(workflowControlAllowed('rerun_all', 'completed', 'success'), true);
  assert.equal(workflowControlAllowed('rerun_all', 'in_progress', null), false);
  assert.equal(workflowControlAllowed('rerun_failed', 'completed', 'failure'), true);
  assert.equal(workflowControlAllowed('rerun_failed', 'completed', 'success'), false);
});

test('raw workflow run mutations are routed through the guarded action', () => {
  assert.equal(
    restrictedBotWrite('POST', '/repos/trvny/trvny/actions/runs/123/rerun'),
    'use_workflow_control',
  );
  assert.equal(
    restrictedBotWrite('POST', '/repos/trvny/trvny/actions/runs/123/rerun-failed-jobs'),
    'use_workflow_control',
  );
  assert.equal(
    restrictedBotWrite('POST', '/repos/trvny/trvny/actions/runs/123/cancel'),
    'use_workflow_control',
  );
  assert.equal(
    restrictedBotWrite('POST', '/repos/trvny/trvny/actions/workflows/ci.yml/dispatches'),
    null,
  );
});
