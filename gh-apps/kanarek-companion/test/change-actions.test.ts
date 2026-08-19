import assert from 'node:assert/strict';
import test from 'node:test';

import { branchPullRequestConflict } from '../src/change-actions.ts';
import { customGptOpenApi } from '../src/router.ts';

test('prepareChange is exposed in Custom GPT OpenAPI', () => {
  const document = customGptOpenApi('https://example.workers.dev') as {
    paths: Record<string, Record<string, { operationId?: string; description?: string }>>;
  };
  const operations = Object.values(document.paths).flatMap((path) => Object.values(path));
  const prepare = operations.find((operation) => operation.operationId === 'prepareChange');

  assert.ok(prepare);
  assert.ok(!prepare.description || prepare.description.length <= 300);
});

test('prepareChange detects an existing PR for the requested branch', () => {
  const conflict = branchPullRequestConflict(
    [
      { number: 1, title: 'other', head: { ref: 'feat/other', sha: 'a'.repeat(40) } },
      {
        number: 2,
        title: 'same branch',
        state: 'open',
        head: { ref: 'feat/change', sha: 'b'.repeat(40) },
        base: { ref: 'main' },
      },
    ],
    'feat/change',
  );

  assert.equal(conflict?.number, 2);
  assert.equal(conflict?.headRef, 'feat/change');
  assert.equal(branchPullRequestConflict([], 'feat/change'), null);
});
