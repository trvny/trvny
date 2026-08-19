import assert from 'node:assert/strict';
import test from 'node:test';

import { releaseTagAllowed, releaseUpdateFlags } from '../src/release-actions.ts';
import { customGptOpenApi } from '../src/router.ts';

test('release action is exposed in Custom GPT OpenAPI', () => {
  const document = customGptOpenApi('https://example.workers.dev') as {
    paths: Record<string, Record<string, { operationId?: string; description?: string }>>;
  };
  const operations = Object.values(document.paths).flatMap((path) => Object.values(path));
  const release = operations.find((operation) => operation.operationId === 'releaseAsGptomek');

  assert.ok(release);
  assert.ok(!release.description || release.description.length <= 300);
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
