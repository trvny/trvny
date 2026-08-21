import assert from 'node:assert/strict';
import test from 'node:test';

import {
  agentInstructionPaths,
  loadAgentGuidance,
  targetPaths,
} from '../src/agents-guidance.ts';
import { gatewayOpenApi } from '../src/entry.ts';

type JsonObject = Record<string, unknown>;

function githubFile(content: string, sha: string): JsonObject {
  return {
    encoding: 'base64',
    content: btoa(content),
    sha,
  };
}

function operationById(document: JsonObject, operationId: string): JsonObject | null {
  const paths = document.paths && typeof document.paths === 'object'
    ? document.paths as JsonObject
    : {};
  for (const path of Object.values(paths)) {
    if (!path || typeof path !== 'object' || Array.isArray(path)) continue;
    for (const operation of Object.values(path as JsonObject)) {
      if (
        operation &&
        typeof operation === 'object' &&
        !Array.isArray(operation) &&
        (operation as JsonObject).operationId === operationId
      ) {
        return operation as JsonObject;
      }
    }
  }
  return null;
}

test('nested AGENTS candidates follow file ancestors from root to deepest scope', () => {
  assert.deepEqual(
    agentInstructionPaths([
      'gh-apps/kanarek-companion/src/entry.ts',
      'gh-apps/kanarek-companion/test/entry.test.ts',
    ]),
    [
      'AGENTS.md',
      'gh-apps/AGENTS.md',
      'gh-apps/kanarek-companion/AGENTS.md',
      'gh-apps/kanarek-companion/src/AGENTS.md',
      'gh-apps/kanarek-companion/test/AGENTS.md',
    ],
  );
});

test('nested AGENTS guidance maps only applicable scopes to each target', async () => {
  const files = new Map<string, JsonObject>([
    ['AGENTS.md', githubFile('root rules', '1'.repeat(40))],
    ['gh-apps/kanarek-companion/AGENTS.md', githubFile('worker rules', '2'.repeat(40))],
    ['gh-apps/kanarek-companion/src/AGENTS.md', githubFile('src rules', '3'.repeat(40))],
  ]);
  const seen: string[] = [];
  const guidance = await loadAgentGuidance(
    [
      'gh-apps/kanarek-companion/src/entry.ts',
      'gh-apps/kanarek-companion/test/entry.test.ts',
    ],
    'a'.repeat(40),
    async (path) => {
      seen.push(path);
      return files.get(path) ?? null;
    },
  );

  assert.equal(guidance.root, 'root rules');
  assert.deepEqual(guidance.scopes.map((scope) => scope.path), [
    'AGENTS.md',
    'gh-apps/kanarek-companion/AGENTS.md',
    'gh-apps/kanarek-companion/src/AGENTS.md',
  ]);
  assert.deepEqual(guidance.targets[0], {
    path: 'gh-apps/kanarek-companion/src/entry.ts',
    instructionPaths: [
      'AGENTS.md',
      'gh-apps/kanarek-companion/AGENTS.md',
      'gh-apps/kanarek-companion/src/AGENTS.md',
    ],
  });
  assert.deepEqual(guidance.targets[1], {
    path: 'gh-apps/kanarek-companion/test/entry.test.ts',
    instructionPaths: ['AGENTS.md', 'gh-apps/kanarek-companion/AGENTS.md'],
  });
  assert.ok(seen.includes('gh-apps/AGENTS.md'));
  assert.ok(seen.includes('gh-apps/kanarek-companion/test/AGENTS.md'));
});

test('target path validation rejects traversal and duplicate targets', () => {
  assert.deepEqual(targetPaths(undefined), []);
  assert.deepEqual(targetPaths(['src/file.ts']), ['src/file.ts']);
  assert.throws(() => targetPaths(['../secret']), /invalid_target_paths/);
  assert.throws(() => targetPaths(['src/file.ts', 'src/file.ts']), /invalid_target_paths/);
});

test('Custom GPT OpenAPI advertises scoped AGENTS support where callers can use it', () => {
  const document = gatewayOpenApi('https://example.workers.dev') as JsonObject;
  const context = operationById(document, 'getRepositoryContext');
  const prepare = operationById(document, 'prepareChange');
  const investigate = operationById(document, 'investigateCode');

  assert.ok(context);
  assert.ok(prepare);
  assert.ok(investigate);
  assert.match(String(context.description), /nested AGENTS\.md/);
  assert.match(String(prepare.description), /nested AGENTS\.md/);
  assert.match(String(investigate.description), /nested AGENTS\.md/);

  const requestBody = context.requestBody as JsonObject;
  const content = requestBody.content as JsonObject;
  const jsonContent = content['application/json'] as JsonObject;
  const schema = jsonContent.schema as JsonObject;
  const properties = schema.properties as JsonObject;
  assert.ok(properties.targetPaths);
});
