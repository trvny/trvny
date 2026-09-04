import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inspectRegistryPackage,
  packageName,
  registryAlternatives,
} from '../src/package-registry.ts';

type JsonMap = Record<string, unknown>;

function jsonMap(values: JsonMap) {
  return (url: string): Promise<unknown> => {
    const direct = values[url];
    if (direct !== undefined) return Promise.resolve(direct);
    const entry = Object.entries(values).find(([key]) => url.includes(key));
    if (entry) return Promise.resolve(entry[1]);
    return Promise.reject(new Error(`unexpected json URL: ${url}`));
  };
}

const noText = (url: string): Promise<string> =>
  Promise.reject(new Error(`unexpected text URL: ${url}`));

test('package names are ecosystem-scoped instead of becoming URL input', () => {
  assert.equal(packageName('npm', '@scope/pkg'), '@scope/pkg');
  assert.equal(packageName('maven', 'com.example:demo'), 'com.example:demo');
  assert.equal(packageName('pypi', 'importlib-metadata'), 'importlib-metadata');
  assert.throws(() => packageName('npm', 'https://example.com/pkg'), /invalid_package/);
  assert.throws(() => packageName('maven', 'group:artifact:extra'), /invalid_package/);
});

test('npm metadata is normalized from exact version and bounded search evidence', async () => {
  const result = await inspectRegistryPackage(
    'npm',
    'demo',
    null,
    jsonMap({
      '/demo/latest': {
        name: 'demo',
        version: '2.0.0',
        description: 'Demo package',
        license: 'MIT',
        repository: { url: 'git+https://github.com/acme/demo.git' },
        engines: { node: '>=20' },
        dist: { integrity: 'sha512-abc', tarball: 'https://registry.npmjs.org/demo/-/demo-2.0.0.tgz' },
      },
      '/-/v1/search': {
        objects: [{ package: { name: 'demo', version: '2.0.0', date: '2026-08-01T00:00:00Z' } }],
      },
    }),
    noText,
  );
  assert.equal(result.latestVersion, '2.0.0');
  assert.equal(result.selectedVersion, '2.0.0');
  assert.equal(result.license, 'MIT');
  assert.equal(result.requiresRuntime, '>=20');
  assert.equal(result.latestPublishedAt, '2026-08-01T00:00:00Z');
});

test('PyPI metadata keeps latest freshness while inspecting an exact version', async () => {
  const base = 'https://pypi.org/pypi/demo';
  const result = await inspectRegistryPackage(
    'pypi',
    'demo',
    '1.5.0',
    jsonMap({
      [`${base}/json`]: {
        info: { name: 'demo', version: '2.0.0' },
        releases: {
          '2.0.0': [{ upload_time_iso_8601: '2026-07-01T12:00:00Z' }],
        },
      },
      [`${base}/1.5.0/json`]: {
        info: {
          name: 'demo',
          version: '1.5.0',
          summary: 'Demo',
          license_expression: 'Apache-2.0',
          requires_python: '>=3.11',
          project_urls: { Source: 'https://github.com/acme/demo' },
        },
        urls: [{ url: 'https://files.pythonhosted.org/demo.whl', digests: { sha256: 'abc' } }],
      },
    }),
    noText,
  );
  assert.equal(result.selectedVersion, '1.5.0');
  assert.equal(result.latestVersion, '2.0.0');
  assert.equal(result.latestPublishedAt, '2026-07-01T12:00:00Z');
  assert.equal(result.license, 'Apache-2.0');
  assert.equal(result.repositoryUrl, 'https://github.com/acme/demo');
});

test('crates.io metadata exposes yanked, license and Rust-version signals', async () => {
  const result = await inspectRegistryPackage(
    'crates',
    'demo',
    '1.0.0',
    jsonMap({
      '/api/v1/crates/demo': {
        crate: {
          name: 'demo',
          max_stable_version: '2.0.0',
          repository: 'https://github.com/acme/demo',
          description: 'Demo crate',
        },
        versions: [
          { num: '2.0.0', created_at: '2026-06-01T00:00:00Z', license: 'MIT', yanked: false },
          { num: '1.0.0', created_at: '2025-01-01T00:00:00Z', license: 'MIT', yanked: true, rust_version: '1.80' },
        ],
      },
    }),
    noText,
  );
  assert.equal(result.latestVersion, '2.0.0');
  assert.equal(result.yanked, true);
  assert.equal(result.requiresRuntime, '1.80');
});

test('Maven Central metadata combines search freshness with bounded POM metadata', async () => {
  const result = await inspectRegistryPackage(
    'maven',
    'com.example:demo',
    null,
    jsonMap({
      'search.maven.org/solrsearch/select': {
        response: { docs: [{ latestVersion: '3.0.0', timestamp: 1780000000000 }] },
      },
    }),
    (url) => Promise.resolve(url.includes('/demo/3.0.0/demo-3.0.0.pom')
      ? `
        <project>
          <parent>
            <groupId>com.example</groupId>
            <artifactId>demo-parent</artifactId>
            <version>3.0.0</version>
          </parent>
          <description>Demo library</description>
        </project>`
      : `
        <project>
          <url>https://example.com/demo</url>
          <licenses><license><name>Apache-2.0</name></license></licenses>
          <scm><url>https://github.com/acme/demo</url></scm>
        </project>`),
  );
  assert.equal(result.latestVersion, '3.0.0');
  assert.equal(result.license, 'Apache-2.0');
  assert.equal(result.repositoryUrl, 'https://github.com/acme/demo');
  assert.equal(result.description, 'Demo library');
});

test('Maven text fields reject embedded markup instead of stripping tags', async () => {
  const result = await inspectRegistryPackage(
    'maven',
    'com.example:unsafe',
    null,
    jsonMap({
      'search.maven.org/solrsearch/select': {
        response: { docs: [{ latestVersion: '1.0.0' }] },
      },
    }),
    () => Promise.resolve(
      '<project><description><![CDATA[<script>alert(1)</script>]]></description></project>',
    ),
  );
  assert.equal(result.description, null);
});

test('NuGet discovers its registration resource before reading package metadata', async () => {
  const result = await inspectRegistryPackage(
    'nuget',
    'Demo.Package',
    null,
    jsonMap({
      'https://api.nuget.org/v3/index.json': {
        resources: [{ '@id': 'https://api.nuget.org/v3/registration5-semver2/', '@type': 'RegistrationsBaseUrl/3.6.0' }],
      },
      '/demo.package/index.json': {
        items: [{
          items: [
            { catalogEntry: { id: 'Demo.Package', version: '1.0.0', published: '2025-01-01T00:00:00Z' } },
            {
              catalogEntry: {
                id: 'Demo.Package',
                version: '2.0.0',
                published: '2026-08-01T00:00:00Z',
                description: 'Demo NuGet',
                licenseExpression: 'MIT',
                projectUrl: 'https://github.com/acme/demo',
                repository: { url: 'https://github.com/acme/demo' },
                vulnerabilities: [{ advisoryUrl: 'https://example.test/advisory', severity: 2 }],
              },
            },
            {
              catalogEntry: {
                id: 'Demo.Package',
                version: '2.1.0-beta1',
                published: '2026-08-15T00:00:00Z',
                description: 'Preview',
              },
            },
          ],
        }],
      },
    }),
    noText,
  );
  assert.equal(result.latestVersion, '2.0.0');
  assert.equal(result.license, 'MIT');
  assert.equal(result.registryVulnerabilities.length, 1);
});

test('NuGet exact versions fetch only the matching and recent registration pages', async () => {
  const calls: string[] = [];
  const fetchJson = (url: string): Promise<unknown> => {
    calls.push(url);
    if (url === 'https://api.nuget.org/v3/index.json') {
      return Promise.resolve({
        resources: [{
          '@id': 'https://api.nuget.org/v3/registration5-semver2/',
          '@type': 'RegistrationsBaseUrl/3.6.0',
        }],
      });
    }
    if (url.endsWith('/demo.package/index.json')) {
      return Promise.resolve({
        items: [
          { '@id': 'https://api.nuget.org/page-old.json', lower: '1.0.0', upper: '1.9.9' },
          { '@id': 'https://api.nuget.org/page-target.json', lower: '2.0.0', upper: '2.9.9' },
          { '@id': 'https://api.nuget.org/page-latest.json', lower: '3.0.0', upper: '3.9.9' },
        ],
      });
    }
    if (url.endsWith('/page-target.json')) {
      return Promise.resolve({ items: [{ catalogEntry: { id: 'Demo.Package', version: '2.1.0' } }] });
    }
    if (url.endsWith('/page-latest.json')) {
      return Promise.resolve({ items: [{ catalogEntry: { id: 'Demo.Package', version: '3.0.0' } }] });
    }
    throw new Error(`unexpected JSON URL: ${url}`);
  };

  const result = await inspectRegistryPackage(
    'nuget',
    'Demo.Package',
    '2.1.0',
    fetchJson,
    noText,
  );
  assert.equal(result.selectedVersion, '2.1.0');
  assert.equal(result.latestVersion, '3.0.0');
  assert.ok(calls.some((url) => url.endsWith('/page-target.json')));
  assert.ok(calls.some((url) => url.endsWith('/page-latest.json')));
  assert.ok(!calls.some((url) => url.endsWith('/page-old.json')));
});

test('alternatives stay registry-specific and PyPI declines unsupported search', async () => {
  assert.deepEqual(await registryAlternatives('pypi', 'demo', jsonMap({})), {
    supported: false,
    items: [],
  });
  const npm = await registryAlternatives('npm', 'demo', jsonMap({
    '/-/v1/search': {
      objects: [
        { package: { name: 'demo', version: '1.0.0' } },
        { package: { name: 'demo-next', version: '2.0.0', description: 'Alternative', links: { npm: 'https://npmjs.com/demo-next' } } },
      ],
    },
  }));
  assert.equal(npm.supported, true);
  assert.deepEqual(npm.items.map((item) => item.name), ['demo-next']);
});
