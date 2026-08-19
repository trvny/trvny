import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCodeSnippets } from '../src/investigation-actions.ts';
import { customGptOpenApi } from '../src/router.ts';

test('code investigation is exposed in Custom GPT OpenAPI', () => {
  const document = customGptOpenApi('https://example.workers.dev') as {
    paths: Record<string, Record<string, { operationId?: string; description?: string }>>;
  };
  const operations = Object.values(document.paths)
    .flatMap((path) => Object.values(path))
    .filter((operation) => operation.operationId);

  assert.ok(operations.some((operation) => operation.operationId === 'investigateCode'));
  for (const operation of operations) {
    if (operation.description) assert.ok(operation.description.length <= 300);
  }
});

test('code snippets include line numbers and merge nearby matches', () => {
  const content = [
    'zero',
    'const worker = 1;',
    'middle',
    'worker += 1;',
    'tail',
    'far 1',
    'far 2',
    'far 3',
    'far 4',
    'far 5',
    'const token = worker;',
  ].join('\n');
  const snippets = buildCodeSnippets(content, ['worker']);

  assert.equal(snippets.length, 2);
  assert.equal(snippets[0].startLine, 1);
  assert.equal(snippets[0].endLine, 6);
  assert.match(snippets[0].text, /2: const worker = 1;/);
  assert.match(snippets[1].text, /11: const token = worker;/);
});
