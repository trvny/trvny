import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addPackageIntelligenceOpenApi,
  githubRepositoryFromUrl,
  handlePackageIntelligenceAction,
  maintenanceSignals,
} from '../src/package-intelligence.ts';

const origin = 'https://example.workers.dev';

function request(body: unknown): Request {
  return new Request(`${origin}/gpt-actions/packages/inspect`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer github-oauth-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function operatorInvoke(login = 'trvny') {
  return async (input: Request): Promise<Response> => {
    assert.equal(new URL(input.url).pathname, '/gpt-actions/github/read');
    assert.deepEqual(await input.json(), { path: '/user' });
    return Response.json({ ok: true, data: { login } });
  };
}

function urlString(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

test('package intelligence is exposed as one OAuth-protected high-level Action', () => {
  const document: Record<string, unknown> = { paths: {} };
  addPackageIntelligenceOpenApi(document);
  const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>;
  const operation = paths['/gpt-actions/packages/inspect'].post;
  assert.equal(operation.operationId, 'inspectPackage');
  assert.deepEqual(operation.security, [{ githubOAuth: [] }]);
});

test('operator authorization fails closed before package networks are touched', async () => {
  let externalCalls = 0;
  const response = await handlePackageIntelligenceAction(
    request({ ecosystem: 'npm', package: 'demo' }),
    operatorInvoke('someone-else'),
    (async () => {
      externalCalls += 1;
      return Response.json({});
    }) as typeof fetch,
  );
  assert.ok(response);
  assert.equal(response.status, 403);
  assert.equal(externalCalls, 0);
  assert.deepEqual(await response.json(), { ok: false, error: 'operator_not_allowed' });
});

test('package input cannot smuggle an arbitrary URL or unknown request fields', async () => {
  let externalCalls = 0;
  const fetcher = (async () => {
    externalCalls += 1;
    return Response.json({});
  }) as typeof fetch;
  for (const body of [
    { ecosystem: 'npm', package: 'https://evil.test/pkg' },
    { ecosystem: 'npm', package: 'demo', url: 'https://evil.test' },
  ]) {
    const response = await handlePackageIntelligenceAction(request(body), operatorInvoke(), fetcher);
    assert.ok(response);
    assert.equal(response.status, 400);
  }
  assert.equal(externalCalls, 0);
});

test('npm inspection triangulates registry, OSV and GitHub without relaying raw bodies', async () => {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = urlString(input);
    calls.push(url);
    if (url.includes('registry.npmjs.org/demo/latest')) {
      return Response.json({
        name: 'demo',
        version: '2.0.0',
        description: 'Demo package',
        license: 'MIT',
        repository: { url: 'git+https://github.com/acme/demo.git' },
        dist: { integrity: 'sha512-abc' },
      });
    }
    if (url.includes('registry.npmjs.org/-/v1/search')) {
      return Response.json({
        objects: [{ package: { name: 'demo', version: '2.0.0', date: '2026-08-01T00:00:00Z' } }],
      });
    }
    if (url === 'https://api.github.com/repos/acme/demo') {
      return Response.json({
        html_url: 'https://github.com/acme/demo',
        default_branch: 'main',
        archived: false,
        fork: false,
        pushed_at: '2026-08-20T00:00:00Z',
        updated_at: '2026-08-21T00:00:00Z',
        stargazers_count: 42,
        open_issues_count: 3,
      });
    }
    if (url.endsWith('/releases/latest')) {
      return Response.json({ message: 'Not Found', secret: 'must-not-leak' }, { status: 404 });
    }
    if (url.includes('/contents/CHANGELOG.md?')) {
      return Response.json({
        type: 'file',
        html_url: 'https://github.com/acme/demo/blob/main/CHANGELOG.md',
      });
    }
    if (url === 'https://api.osv.dev/v1/query') {
      return Response.json({
        vulns: [{
          id: 'GHSA-demo',
          summary: 'Demo advisory',
          aliases: ['CVE-2026-1234'],
          severity: [{ type: 'CVSS_V3', score: '7.5' }],
        }],
      });
    }
    throw new Error(`unexpected URL ${url}`);
  }) as typeof fetch;

  const response = await handlePackageIntelligenceAction(
    request({ ecosystem: 'npm', package: 'demo' }),
    operatorInvoke(),
    fetcher,
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  const body = await response.json() as {
    package: { latestVersion: string; license: string };
    advisories: { count: number; items: Array<{ id: string }> };
    upstream: { repository: string; changelogUrl: string; latestRelease: null };
    maintenance: { status: string };
    warnings: Array<{ source: string; error: string }>;
    evidence: { externalFetches: number; readOnly: boolean };
  };
  assert.equal(body.package.latestVersion, '2.0.0');
  assert.equal(body.package.license, 'MIT');
  assert.equal(body.advisories.count, 1);
  assert.equal(body.advisories.items[0].id, 'GHSA-demo');
  assert.equal(body.upstream.repository, 'acme/demo');
  assert.equal(body.upstream.changelogUrl, 'https://github.com/acme/demo/blob/main/CHANGELOG.md');
  assert.equal(body.upstream.latestRelease, null);
  assert.equal(body.warnings.length, 0);
  assert.equal(body.evidence.readOnly, true);
  assert.ok(body.evidence.externalFetches >= 5);
  assert.ok(calls.every((url) => !url.includes('evil.test')));
});

test('GitHub repository parsing handles common registry SCM forms conservatively', () => {
  assert.deepEqual(githubRepositoryFromUrl('git+https://github.com/acme/demo.git'), {
    owner: 'acme',
    repo: 'demo',
  });
  assert.deepEqual(githubRepositoryFromUrl('git@github.com:acme/demo.git'), {
    owner: 'acme',
    repo: 'demo',
  });
  assert.equal(githubRepositoryFromUrl('https://gitlab.com/acme/demo'), null);
  assert.equal(githubRepositoryFromUrl('not a URL'), null);
});

test('maintenance signals remain heuristic and age activity deterministically', () => {
  const now = Date.parse('2026-09-01T00:00:00Z');
  assert.equal(
    maintenanceSignals('2026-08-01T00:00:00Z', null, now).status,
    'active',
  );
  assert.equal(
    maintenanceSignals('2025-10-01T00:00:00Z', null, now).status,
    'aging',
  );
  assert.equal(
    maintenanceSignals('2020-01-01T00:00:00Z', null, now).status,
    'stale',
  );
  assert.equal(
    maintenanceSignals('2026-08-01T00:00:00Z', { archived: true }, now).status,
    'archived',
  );
});
