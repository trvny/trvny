import assert from 'node:assert/strict';
import test from 'node:test';

import { anchorStorageOpenApi } from '../src/anchor-storage.ts';
import {
  CUSTOM_GPT_DESCRIPTION_LIMIT,
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

function assertBuilderCompatible(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertBuilderCompatible(entry, `${path}[${index}]`));
    return;
  }
  if (!isObject(value)) return;

  if (typeof value.description === 'string') {
    assert.ok(
      value.description.length <= CUSTOM_GPT_DESCRIPTION_LIMIT,
      `${path}.description exceeds ${CUSTOM_GPT_DESCRIPTION_LIMIT}`,
    );
  }
  const declaresObject =
    value.type === 'object' || (Array.isArray(value.type) && value.type.includes('object'));
  if (declaresObject) {
    assert.ok(isObject(value.properties), `${path} object schema is missing properties`);
  }

  for (const [key, entry] of Object.entries(value)) {
    assertBuilderCompatible(entry, `${path}.${key}`);
  }
}

test('combined Custom GPT actions stay at the 30-operation limit', () => {
  const main = operationIds(runtimeOpenApi('https://example.workers.dev'));
  const anchor = operationIds(anchorStorageOpenApi('https://example.workers.dev'));
  const expected = [...CUSTOM_GPT_OPERATION_IDS].sort();

  assert.equal(CUSTOM_GPT_OPERATION_IDS.length, CUSTOM_GPT_OPERATION_LIMIT - 1);
  assert.equal(new Set(CUSTOM_GPT_OPERATION_IDS).size, CUSTOM_GPT_OPERATION_IDS.length);
  assert.equal(main.length, CUSTOM_GPT_OPERATION_LIMIT - 1);
  assert.deepEqual(main, expected);
  assert.deepEqual(anchor, ['useGremlinStorage']);
  assert.equal(main.length + anchor.length, CUSTOM_GPT_OPERATION_LIMIT);
});

test('runtime OpenAPI satisfies Builder description and object-schema constraints', () => {
  assertBuilderCompatible(runtimeOpenApi('https://example.workers.dev'));
  assertBuilderCompatible(anchorStorageOpenApi('https://example.workers.dev'));
});

test('curated GitHub surface keeps high-level workflows, specialists and generic fallbacks', () => {
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
  assert.ok(!ids.has('useGremlinStorage'));
});
