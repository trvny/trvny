import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addReleaseReplaceOpenApi,
  replacementNamesMatch,
  RELEASE_ASSET_REPLACE_PATH,
} from '../src/release-replace-action.ts';

test('safe replacement requires a stable release asset name', () => {
  assert.equal(replacementNamesMatch('kanarek.apk', 'kanarek.apk'), true);
  assert.equal(replacementNamesMatch('kanarek.apk', 'other.apk'), false);
  assert.equal(replacementNamesMatch('.hidden.apk', '.hidden.apk'), false);
});

test('safe replacement is exposed as one high-level OpenAPI action', () => {
  const document: Record<string, unknown> = { paths: {} };
  addReleaseReplaceOpenApi(document);
  const paths = document.paths as Record<string, Record<string, { operationId?: string }>>;
  assert.equal(paths[RELEASE_ASSET_REPLACE_PATH]?.post?.operationId, 'replaceReleaseAssetSafely');
});
