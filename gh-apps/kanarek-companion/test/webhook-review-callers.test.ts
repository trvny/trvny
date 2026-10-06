import assert from 'node:assert/strict';
import test from 'node:test';

import type { GitHubInstallationClient } from '../src/github-app.ts';
import { callerEvidenceForFile, fetchCallerEvidence } from '../src/webhook-review-context.ts';
import {
  reviewChangeInventory,
  reviewChangeInventoryComplete,
  reviewPrompt,
} from '../src/webhook-review.ts';

function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function jsonClient(
  handler: (path: string) => unknown,
): GitHubInstallationClient {
  return {
    async json(path: string) {
      return handler(path);
    },
  } as unknown as GitHubInstallationClient;
}

test('callerEvidenceForFile finds a caller whose import resolves to the target', async () => {
  const client = jsonClient((path) => {
    if (path.startsWith('/search/code')) {
      return {
        incomplete_results: false,
        items: [{ path: 'src/bar.ts' }],
        total_count: 1,
      };
    }
    if (path.includes('src/bar.ts')) {
      return { content: base64("import { thing } from './foo';\n"), encoding: 'base64', size: 30 };
    }
    throw new Error(`unexpected path: ${path}`);
  });

  const evidence = await callerEvidenceForFile(client, 'trvny/trvny', 'deadbeef', 'src/foo.ts');
  assert.deepEqual(evidence, {
    callers: ['src/bar.ts'],
    path: 'src/foo.ts',
    searchIncomplete: false,
  });
});

test('callerEvidenceForFile excludes candidates whose imports do not resolve to the target', async () => {
  const client = jsonClient((path) => {
    if (path.startsWith('/search/code')) {
      return { incomplete_results: false, items: [{ path: 'src/unrelated.ts' }], total_count: 1 };
    }
    return { content: base64("import { other } from './something-else';\n"), encoding: 'base64', size: 40 };
  });

  const evidence = await callerEvidenceForFile(client, 'trvny/trvny', 'deadbeef', 'src/foo.ts');
  assert.deepEqual(evidence?.callers, []);
});

test('callerEvidenceForFile marks the search incomplete when results exceed the candidate cap', async () => {
  const client = jsonClient((path) => {
    if (path.startsWith('/search/code')) {
      return { incomplete_results: false, items: [{ path: 'src/bar.ts' }], total_count: 50 };
    }
    return { content: base64("import { thing } from './foo';\n"), encoding: 'base64', size: 30 };
  });

  const evidence = await callerEvidenceForFile(client, 'trvny/trvny', 'deadbeef', 'src/foo.ts');
  assert.equal(evidence?.searchIncomplete, true);
});

test('callerEvidenceForFile returns null instead of throwing when the search request fails', async () => {
  const client = jsonClient(() => {
    throw new Error('rate limited');
  });

  const evidence = await callerEvidenceForFile(client, 'trvny/trvny', 'deadbeef', 'src/foo.ts');
  assert.equal(evidence, null);
});

test('fetchCallerEvidence skips test files and caps how many targets it probes', async () => {
  const probed: string[] = [];
  const client = jsonClient((path) => {
    if (path.startsWith('/search/code')) {
      const seed = decodeURIComponent(path.split('q=')[1].split('%20repo')[0]);
      probed.push(seed);
      return { incomplete_results: false, items: [], total_count: 0 };
    }
    throw new Error(`unexpected path: ${path}`);
  });

  const files = [
    { path: 'src/one.ts', patch: '', rightLines: new Set<number>(), sha: null },
    { path: 'src/one.test.ts', patch: '', rightLines: new Set<number>(), sha: null },
    { path: 'src/two.ts', patch: '', rightLines: new Set<number>(), sha: null },
    { path: 'src/three.ts', patch: '', rightLines: new Set<number>(), sha: null },
  ];

  const evidence = await fetchCallerEvidence(client, 'trvny/trvny', 'deadbeef', files);
  assert.equal(evidence.length, 2);
  assert.deepEqual(evidence.map((entry) => entry.path), ['src/one.ts', 'src/two.ts']);
  assert.deepEqual(probed, ['one', 'two']);
});

test('reviewPrompt embeds caller evidence under repository_context.callers', () => {
  const context = { files: [], tree: [], treeTruncated: false };
  const callers = [{ callers: ['src/bar.ts'], path: 'src/foo.ts', searchIncomplete: false }];
  const prompt = JSON.parse(
    reviewPrompt(1, 'title', 'body', [], context, callers),
  ) as { repository_context: { callers: unknown } };
  assert.deepEqual(prompt.repository_context.callers, callers);
});

test('reviewPrompt defaults callers to an empty array when omitted', () => {
  const context = { files: [], tree: [], treeTruncated: false };
  const prompt = JSON.parse(reviewPrompt(1, 'title', 'body', [], context)) as {
    repository_context: { callers: unknown };
  };
  assert.deepEqual(prompt.repository_context.callers, []);
});

test('reviewPrompt exposes changed lockfiles without adding their diff to review input', () => {
  const context = { files: [], tree: [], treeTruncated: false };
  const files = [{
    path: 'worker/package.json',
    patch: '@@ -1 +1 @@\n-{"wrangler":"4.146.0"}\n+{"wrangler":"4.147.0"}',
    rightLines: new Set([1]),
    sha: null,
  }];
  const inventory = reviewChangeInventory([
    { filename: 'worker/package.json', status: 'modified' },
    { filename: 'worker/package-lock.json', status: 'modified' },
  ], true);
  const prompt = JSON.parse(
    reviewPrompt(1, 'deps', '', files, context, [], [], inventory),
  ) as { change_inventory: unknown; diff: string };

  assert.deepEqual(prompt.change_inventory, {
    complete: true,
    files: [
      { path: 'worker/package.json', status: 'modified' },
      { path: 'worker/package-lock.json', status: 'modified' },
    ],
  });
  assert.doesNotMatch(prompt.diff, /package-lock\.json/);
});

test('reviewChangeInventory preserves removed and renamed path semantics', () => {
  const inventory = reviewChangeInventory([
    { filename: 'worker/deleted.json', status: 'removed' },
    {
      filename: 'worker/new-name.json',
      previous_filename: 'worker/old-name.json',
      status: 'renamed',
    },
  ], true);

  assert.deepEqual(inventory, {
    complete: true,
    files: [
      { path: 'worker/deleted.json', status: 'removed' },
      {
        path: 'worker/new-name.json',
        previous_path: 'worker/old-name.json',
        status: 'renamed',
      },
    ],
  });
});

test('reviewChangeInventory completeness follows the pull request changed_files count', () => {
  const files = [
    { filename: 'worker/package.json' },
    { filename: 'worker/package-lock.json' },
  ];
  assert.equal(reviewChangeInventoryComplete(2, files), true);
  assert.equal(reviewChangeInventoryComplete(3, files), false);
  assert.equal(reviewChangeInventoryComplete(undefined, files), false);
});

test('reviewPrompt defaults change inventory to non-authoritative', () => {
  const context = { files: [], tree: [], treeTruncated: false };
  const files = [{
    path: 'worker/package.json',
    patch: '@@ -0,0 +1 @@\n+{}',
    rightLines: new Set([1]),
    sha: null,
  }];
  const prompt = JSON.parse(reviewPrompt(1, 'title', '', files, context)) as {
    change_inventory: { complete: boolean; files: unknown[] };
  };

  assert.equal(prompt.change_inventory.complete, false);
  assert.deepEqual(prompt.change_inventory.files, [
    { path: 'worker/package.json', status: 'unknown' },
  ]);
});
