import assert from 'node:assert/strict';
import test from 'node:test';

import {
  artifactReleaseSnapshotMatches,
  releaseAssetNameAllowed,
  releaseAssetSnapshotMatches,
  releaseTagAllowed,
  releaseUpdateFlags,
} from '../src/release-actions.ts';
import { customGptOpenApi, restrictedBotWrite } from '../src/router.ts';

test('release actions are exposed in Custom GPT OpenAPI', () => {
  const document = customGptOpenApi('https://example.workers.dev') as {
    paths: Record<string, Record<string, { operationId?: string; description?: string }>>;
  };
  const operations = Object.values(document.paths).flatMap((path) => Object.values(path));
  const ids = new Set(operations.map((operation) => operation.operationId));

  assert.equal(ids.has('releaseAsGptomek'), true);
  assert.equal(ids.has('uploadWorkflowArtifactAsReleaseAsset'), true);
  assert.equal(ids.has('deleteReleaseAssetAsGptomek'), true);
  for (const operation of operations) {
    if (operation.description) assert.ok(operation.description.length <= 300);
  }
});

test('release tags reject unsafe Git ref shapes', () => {
  assert.equal(releaseTagAllowed('v1.2.3'), true);
  assert.equal(releaseTagAllowed('android/v1.2.3'), true);
  assert.equal(releaseTagAllowed('../main'), false);
  assert.equal(releaseTagAllowed('release//v1'), false);
  assert.equal(releaseTagAllowed('release.lock'), false);
  assert.equal(releaseTagAllowed('tag with spaces'), false);
  assert.equal(releaseTagAllowed('tag~1'), false);
});

test('release asset names stay stable under GitHub filename normalization', () => {
  assert.equal(releaseAssetNameAllowed('feedseek-android.zip'), true);
  assert.equal(releaseAssetNameAllowed('app_v1.2.3+42.zip'), true);
  assert.equal(releaseAssetNameAllowed('.hidden.zip'), false);
  assert.equal(releaseAssetNameAllowed('asset name.zip'), false);
  assert.equal(releaseAssetNameAllowed('asset?.zip'), false);
});

test('artifact-to-release upload requires the exact artifact snapshot', () => {
  const artifact = {
    id: 123,
    name: 'android-build',
    size_in_bytes: 4096,
    expired: false,
    workflow_run: { id: 456 },
  };
  assert.equal(artifactReleaseSnapshotMatches(artifact, 123, 'android-build', 4096, 456), true);
  assert.equal(artifactReleaseSnapshotMatches(artifact, 123, 'android-build', 4097, 456), false);
  assert.equal(artifactReleaseSnapshotMatches({ ...artifact, expired: true }, 123, 'android-build', 4096, 456), false);
});

test('release asset deletion requires the exact asset snapshot', () => {
  const asset = { id: 987, name: 'feedseek.zip', size: 8192 };
  assert.equal(releaseAssetSnapshotMatches(asset, 987, 'feedseek.zip', 8192), true);
  assert.equal(releaseAssetSnapshotMatches(asset, 987, 'other.zip', 8192), false);
  assert.equal(releaseAssetSnapshotMatches(asset, 987, 'feedseek.zip', 8193), false);
});

test('release updates preserve omitted publication flags', () => {
  assert.deepEqual(releaseUpdateFlags(true, true, undefined, undefined, undefined), {});
  assert.deepEqual(releaseUpdateFlags(true, false, false, undefined, 'false'), {
    draft: false,
    make_latest: 'false',
  });
  assert.throws(
    () => releaseUpdateFlags(true, false, undefined, undefined, 'true'),
    /latest_not_allowed_for_draft_or_prerelease/,
  );
});

test('raw release mutations are routed through guarded release actions', () => {
  for (const [method, path] of [
    ['POST', '/repos/trvny/trvny/releases'],
    ['PATCH', '/repos/trvny/trvny/releases/123'],
    ['DELETE', '/repos/trvny/trvny/releases/123'],
    ['POST', '/repos/trvny/trvny/releases/123/assets'],
    ['DELETE', '/repos/trvny/trvny/releases/assets/456'],
    ['POST', '/repos/trvny/trvny/releases/generate-notes'],
  ] as const) {
    assert.equal(restrictedBotWrite(method, path), 'use_release_action');
  }
  assert.equal(restrictedBotWrite('GET', '/repos/trvny/trvny/releases/123'), null);
});
