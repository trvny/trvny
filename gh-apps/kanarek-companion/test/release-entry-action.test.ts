import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addReleaseEntryOpenApi,
  handleReleaseEntryAction,
  RELEASE_ENTRY_UPLOAD_PATH,
} from '../src/release-entry-action.ts';

test('registers exact artifact-entry upload in OpenAPI', () => {
  const document: Record<string, unknown> = { paths: {} };
  addReleaseEntryOpenApi(document);
  const paths = document.paths as Record<string, { post?: { operationId?: string; description?: string } }>;
  assert.equal(
    paths[RELEASE_ENTRY_UPLOAD_PATH]?.post?.operationId,
    'uploadArtifactEntryAsReleaseAsset',
  );
  assert.match(paths[RELEASE_ENTRY_UPLOAD_PATH]?.post?.description ?? '', /exact bounded ZIP entry/);
});

test('rejects unsafe entry paths before making GitHub requests', async () => {
  let calls = 0;
  const response = await handleReleaseEntryAction(
    new Request(`https://worker.test${RELEASE_ENTRY_UPLOAD_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        repository: 'trvny/feedseek',
        releaseId: 1,
        expectedTag: 'v1.0.0',
        artifactId: 2,
        expectedArtifactName: 'android',
        expectedArtifactSizeBytes: 1234,
        expectedWorkflowRunId: 3,
        entryPath: '../app.apk',
        assetName: 'kanarek.apk',
      }),
    }),
    {} as never,
    (async () => {
      calls += 1;
      return Response.json({});
    }) as typeof fetch,
  );
  assert.ok(response);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error: 'invalid_zip_entry_path' });
  assert.equal(calls, 0);
});

test('rejects unknown release-entry request fields fail-closed', async () => {
  const response = await handleReleaseEntryAction(
    new Request(`https://worker.test${RELEASE_ENTRY_UPLOAD_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ extra: true }),
    }),
    {} as never,
    fetch,
  );
  assert.ok(response);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error: 'invalid_release_entry_request' });
});
