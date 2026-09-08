import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CUSTOM_GPT_OPERATION_IDS,
  CUSTOM_GPT_OPERATION_LIMIT,
} from '../src/custom-gpt-surface.ts';
import { runtimeOpenApi } from '../src/runtime-openapi.ts';

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function operationIds(document: JsonObject): string[] {
  if (!isObject(document.paths)) return [];
  const ids: string[] = [];
  for (const pathItem of Object.values(document.paths)) {
    if (!isObject(pathItem)) continue;
    for (const operation of Object.values(pathItem)) {
      if (isObject(operation) && typeof operation.operationId === 'string') {
        ids.push(operation.operationId);
      }
    }
  }
  return ids.sort();
}

test('runtime OpenAPI stays within the Custom GPT operation limit', () => {
  const document = runtimeOpenApi('https://example.workers.dev');
  const actual = operationIds(document);
  const expected = [...CUSTOM_GPT_OPERATION_IDS].sort();

  assert.equal(CUSTOM_GPT_OPERATION_IDS.length, CUSTOM_GPT_OPERATION_LIMIT);
  assert.equal(new Set(CUSTOM_GPT_OPERATION_IDS).size, CUSTOM_GPT_OPERATION_IDS.length);
  assert.equal(actual.length, CUSTOM_GPT_OPERATION_LIMIT);
  assert.deepEqual(actual, expected);
});

test('curated surface keeps high-level workflows, specialists and generic fallbacks', () => {
  const ids = new Set(operationIds(runtimeOpenApi('https://example.workers.dev')));

  for (const operationId of [
    'implementCodeChange',
    'finalizePullRequest',
    'orchestrateRelease',
    'searchContext7Docs',
    'searchFeedseek',
    'searchEngramMemory',
    'getGremlinKnowledge',
    'githubRead',
    'githubBotRequest',
    'createPullRequestAsTrvny',
  ]) {
    assert.ok(ids.has(operationId), `missing ${operationId}`);
  }
});
