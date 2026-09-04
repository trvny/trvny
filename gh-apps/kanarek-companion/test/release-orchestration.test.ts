import assert from 'node:assert/strict';
import test from 'node:test';

import {
  releaseArtifactEntryPath,
  releaseAssetRecoveryCandidate,
  releaseAssetUploadPath,
  selectArtifact,
  selectDispatchedRun,
} from '../src/release-orchestration.ts';
import { customGptOpenApi } from '../src/router.ts';

type JsonObject = Record<string, unknown>;

const TARGET_SHA = 'a'.repeat(40);
const PREPARED_AT = '2026-08-21T00:00:05.500Z';

function run(overrides: JsonObject = {}): JsonObject {
  return {
    id: 100,
    event: 'workflow_dispatch',
    head_sha: TARGET_SHA,
    created_at: '2026-08-21T00:00:06Z',
    actor: { login: 'gptomek[bot]' },
    ...overrides,
  };
}

test('release orchestration is exposed in Custom GPT OpenAPI', () => {
  const document = customGptOpenApi('https://example.workers.dev') as {
    paths: Record<string, Record<string, { operationId?: string; description?: string }>>;
  };
  const operations = Object.values(document.paths).flatMap((path) => Object.values(path));
  const orchestration = operations.find(
    (operation) => operation.operationId === 'orchestrateRelease',
  );

  assert.ok(orchestration);
  assert.ok(!orchestration.description || orchestration.description.length <= 300);
});

test('release orchestration selects whole artifacts or exact entries explicitly', () => {
  assert.equal(
    releaseAssetUploadPath(),
    '/gpt-actions/github/releases/assets/upload-artifact',
  );
  assert.equal(
    releaseAssetUploadPath('dist/app-release.apk'),
    '/gpt-actions/github/releases/assets/upload-entry',
  );
  assert.equal(releaseArtifactEntryPath('dist/app-release.apk'), 'dist/app-release.apk');
  assert.throws(() => releaseArtifactEntryPath('../app-release.apk'), /invalid_zip_entry_path/);
});

test('workflow run discovery ignores baseline, wrong actor, stale and wrong-SHA runs', () => {
  const selected = selectDispatchedRun(
    [
      run({ id: 10 }),
      run({ id: 20, actor: { login: 'trvny' } }),
      run({ id: 30, created_at: '2026-08-20T23:59:00Z' }),
      run({ id: 40, head_sha: 'b'.repeat(40) }),
      run({ id: 50 }),
    ],
    [10],
    TARGET_SHA,
    PREPARED_AT,
  );

  assert.equal(selected?.id, 50);
});

test('workflow run discovery fails closed when two new bot runs match', () => {
  assert.throws(
    () =>
      selectDispatchedRun(
        [run({ id: 50 }), run({ id: 51 })],
        [],
        TARGET_SHA,
        PREPARED_AT,
      ),
    /ambiguous_dispatched_workflow_run/,
  );
});

test('artifact selection requires one exact non-expired artifact name', () => {
  const selected = selectArtifact(
    [
      { id: 1, name: 'other', expired: false },
      { id: 2, name: 'release', expired: true },
      { id: 3, name: 'release', expired: false },
    ],
    'release',
  );
  assert.equal(selected?.id, 3);

  assert.throws(
    () =>
      selectArtifact(
        [
          { id: 3, name: 'release', expired: false },
          { id: 4, name: 'release', expired: false },
        ],
        'release',
      ),
    /ambiguous_workflow_artifact/,
  );
});

test('asset crash recovery accepts only a fresh GPTomek upload', () => {
  const assets = [
    {
      id: 1,
      name: 'app.zip',
      created_at: '2026-08-21T00:00:06Z',
      uploader: { login: 'trvny' },
    },
    {
      id: 2,
      name: 'old.zip',
      created_at: '2026-08-21T00:00:06Z',
      uploader: { login: 'gptomek[bot]' },
    },
    {
      id: 3,
      name: 'app.zip',
      created_at: '2026-08-20T23:59:00Z',
      uploader: { login: 'gptomek[bot]' },
    },
    {
      id: 4,
      name: 'app.zip',
      created_at: '2026-08-21T00:00:06Z',
      uploader: { login: 'gptomek[bot]' },
    },
  ];

  assert.equal(releaseAssetRecoveryCandidate(assets, 'app.zip', PREPARED_AT)?.id, 4);
  assert.equal(releaseAssetRecoveryCandidate(assets, 'missing.zip', PREPARED_AT), null);
});
