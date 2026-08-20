import assert from 'node:assert/strict';
import test from 'node:test';

import { customGptOpenApi, restrictedBotWrite } from '../src/router.ts';
import {
  workflowControlAllowed,
  workflowDispatchInputs,
  workflowIdentifierAllowed,
  workflowRefAllowed,
} from '../src/workflow-actions.ts';

test('workflow control and dispatch are exposed in Custom GPT OpenAPI', () => {
  const document = customGptOpenApi('https://example.workers.dev') as {
    paths: Record<string, Record<string, { operationId?: string; description?: string }>>;
  };
  const operations = Object.values(document.paths)
    .flatMap((path) => Object.values(path))
    .filter((operation) => operation.operationId);
  const ids = operations.map((operation) => operation.operationId);

  assert.ok(ids.includes('controlWorkflowRun'));
  assert.ok(ids.includes('dispatchWorkflow'));
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

test('workflow dispatch validates workflow, ref and string inputs', () => {
  assert.equal(workflowIdentifierAllowed('release.yml'), true);
  assert.equal(workflowIdentifierAllowed('1234567'), true);
  assert.equal(workflowIdentifierAllowed('../release.yml'), false);
  assert.equal(workflowRefAllowed('main'), true);
  assert.equal(workflowRefAllowed('release/v1.2.3'), true);
  assert.equal(workflowRefAllowed('../main'), false);
  assert.deepEqual(workflowDispatchInputs({ channel: 'stable', dry_run: 'false' }), {
    channel: 'stable',
    dry_run: 'false',
  });
  assert.throws(() => workflowDispatchInputs({ channel: true }), /invalid_input_value/);
  assert.throws(() => workflowDispatchInputs({ 'bad input': 'x' }), /invalid_input_name/);
});

test('raw workflow mutations are routed through guarded actions', () => {
  for (const path of [
    '/repos/trvny/trvny/actions/runs/123/rerun',
    '/repos/trvny/trvny/actions/runs/123/rerun-failed-jobs',
    '/repos/trvny/trvny/actions/runs/123/cancel',
    '/repos/trvny/trvny/actions/runs/123/pending_deployments',
    '/repos/trvny/trvny/actions/runs/123/anything-new-github-adds-later',
  ]) {
    assert.equal(restrictedBotWrite('POST', path), 'use_workflow_control');
  }
  assert.equal(
    restrictedBotWrite('POST', '/repos/trvny/trvny/actions/workflows/ci.yml/dispatches'),
    'use_workflow_dispatch',
  );
  assert.equal(
    restrictedBotWrite('POST', '/repos/trvny/trvny/actions/workflows/12345/dispatches'),
    'use_workflow_dispatch',
  );
});
