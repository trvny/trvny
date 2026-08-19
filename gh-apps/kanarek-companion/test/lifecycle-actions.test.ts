import assert from 'node:assert/strict';
import test from 'node:test';

import { branchNameAllowed, githubGraphqlError } from '../src/lifecycle-actions.ts';
import { customGptOpenApi, restrictedBotWrite } from '../src/router.ts';

test('lifecycle actions are exposed in Custom GPT OpenAPI', () => {
  const document = customGptOpenApi('https://example.workers.dev') as {
    paths: Record<string, Record<string, { operationId?: string; description?: string }>>;
  };
  const operations = Object.values(document.paths)
    .flatMap((path) => Object.values(path))
    .filter((operation) => operation.operationId);
  const ids = operations.map((operation) => operation.operationId);

  assert.ok(ids.includes('createBranchAsGptomek'));
  assert.ok(ids.includes('setPullRequestStateAsTrvny'));
  assert.ok(ids.includes('cleanupPullRequestBranch'));
  for (const operation of operations) {
    if (operation.description) assert.ok(operation.description.length <= 300);
  }
});

test('raw branch creation is routed through the guarded action', () => {
  assert.equal(
    restrictedBotWrite('POST', '/repos/trvny/trvny/git/refs'),
    'use_create_branch',
  );
  assert.equal(
    restrictedBotWrite('POST', '/repos/trvny/trvny/git/refs/'),
    'use_create_branch',
  );
  assert.equal(
    restrictedBotWrite('POST', '/repos/trvny/trvny/issues/1/comments'),
    null,
  );
});

test('branch names reject traversal and lock-style refs', () => {
  assert.equal(branchNameAllowed('feat/lifecycle-actions'), true);
  assert.equal(branchNameAllowed('gptomek/control'), true);
  assert.equal(branchNameAllowed('../main'), false);
  assert.equal(branchNameAllowed('feat//oops'), false);
  assert.equal(branchNameAllowed('feat/test.lock'), false);
});

test('GraphQL payload errors are surfaced even with HTTP 200', () => {
  assert.equal(
    githubGraphqlError({ errors: [{ message: 'Pull request is not open' }] }),
    'Pull request is not open',
  );
  assert.equal(githubGraphqlError({ data: { ok: true } }), null);
  assert.equal(githubGraphqlError({ errors: [{}] }), 'unknown_graphql_error');
});
