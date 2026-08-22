import assert from 'node:assert/strict';
import test from 'node:test';

import {
  conventionalTestCandidates,
  detectProjectKind,
  handleTargetedTestsAction,
  TARGETED_TESTS_PATH,
} from '../src/test-discovery.ts';

test('detectProjectKind prefers explicit nearest project markers', () => {
  assert.deepEqual(detectProjectKind(['src', 'package.json', 'gradlew']), {
    kind: 'node',
    marker: 'package.json',
  });
  assert.deepEqual(detectProjectKind(['settings.gradle.kts', 'app']), {
    kind: 'gradle',
    marker: 'settings.gradle.kts',
  });
  assert.deepEqual(detectProjectKind(['Cargo.toml', 'src']), {
    kind: 'rust',
    marker: 'Cargo.toml',
  });
  assert.equal(detectProjectKind(['README.md']), null);
});

test('conventionalTestCandidates maps common source layouts', () => {
  const node = conventionalTestCandidates(
    'gh-apps/kanarek-companion',
    'gh-apps/kanarek-companion/src/dependency-graph.ts',
    'node',
  );
  assert.ok(node.includes('gh-apps/kanarek-companion/test/dependency-graph.test.ts'));

  const gradle = conventionalTestCandidates(
    'android-app',
    'android-app/src/main/kotlin/com/example/FeedRepository.kt',
    'gradle',
  );
  assert.ok(
    gradle.includes('android-app/src/test/kotlin/com/example/FeedRepositoryTest.kt'),
  );

  const python = conventionalTestCandidates('service', 'service/app/feed.py', 'python');
  assert.ok(python.includes('service/tests/test_feed.py'));
});

test('targeted discovery pins project lookup and returns narrow Node commands', async () => {
  const sha = 'd'.repeat(40);
  const packageJson = JSON.stringify({
    scripts: {
      typecheck: 'tsc --noEmit',
      test: 'node --test test/*.test.ts',
      check: 'npm run typecheck && npm test',
    },
  });
  const target = 'gh-apps/kanarek-companion/src/test-discovery.ts';
  const expectedTest = 'gh-apps/kanarek-companion/test/test-discovery.test.ts';
  const source = new Request('https://example.workers.dev' + TARGETED_TESTS_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
    body: JSON.stringify({
      repository: 'trvny/trvny',
      targetPaths: [target],
      ref: 'main',
    }),
  });

  const invoke = async (request: Request): Promise<Response> => {
    assert.equal(new URL(request.url).pathname, '/gpt-actions/github/read');
    const body = (await request.json()) as Record<string, unknown>;
    const path = String(body.path);
    if (path === '/repos/trvny/trvny') {
      return Response.json({ ok: true, data: { default_branch: 'main' } });
    }
    if (path === '/repos/trvny/trvny/commits/main') {
      return Response.json({ ok: true, data: { sha } });
    }
    if (path === `/repos/trvny/trvny/contents/gh-apps/kanarek-companion/src?ref=${sha}`) {
      return Response.json({ ok: true, data: [{ name: 'test-discovery.ts', type: 'file' }] });
    }
    if (path === `/repos/trvny/trvny/contents/gh-apps/kanarek-companion?ref=${sha}`) {
      return Response.json({
        ok: true,
        data: [
          { name: 'package.json', type: 'file' },
          { name: 'src', type: 'dir' },
          { name: 'test', type: 'dir' },
        ],
      });
    }
    if (path === `/repos/trvny/trvny/contents/gh-apps/kanarek-companion/package.json?ref=${sha}`) {
      return Response.json({
        ok: true,
        data: {
          encoding: 'base64',
          size: packageJson.length,
          content: Buffer.from(packageJson).toString('base64'),
        },
      });
    }
    if (path === `/repos/trvny/trvny/contents/${expectedTest}?ref=${sha}`) {
      return Response.json({
        ok: true,
        data: { encoding: 'base64', size: 10, content: Buffer.from('// test\n').toString('base64') },
      });
    }
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
  };

  const response = await handleTargetedTestsAction(source, invoke);
  assert.ok(response);
  assert.equal(response.status, 200);
  const payload = (await response.json()) as Record<string, any>;
  assert.equal(payload.repository.resolvedRefSha, sha);
  assert.deepEqual(payload.projects[0].discoveredTests, [expectedTest]);
  assert.deepEqual(
    payload.recommendedCommands.map((entry: Record<string, unknown>) => entry.command),
    ["node --test 'test/test-discovery.test.ts'", 'npm run typecheck'],
  );
  assert.equal(payload.projects[0].projectGate[0].command, 'npm run check');
  assert.equal(payload.finalGate.ciRequired, true);
});

test('targeted test discovery only accepts POST', async () => {
  const response = await handleTargetedTestsAction(
    new Request('https://example.workers.dev' + TARGETED_TESTS_PATH, { method: 'GET' }),
    async () => Response.json({ ok: false }, { status: 500 }),
  );
  assert.ok(response);
  assert.equal(response.status, 405);
});
