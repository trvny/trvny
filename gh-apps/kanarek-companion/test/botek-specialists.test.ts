import assert from 'node:assert/strict';
import test from 'node:test';

import {
  botekEngramSearch,
  botekEngramStatus,
  botekEngramStore,
  botekFeedseekRecent,
  botekGithubPullStatus,
} from '../src/botek-specialists.ts';
import { GitHubInstallationClient } from '../src/github-app.ts';

test('Botek Engram status reuses the canonical specialist backend', async () => {
  const calls: string[] = [];
  const result = await botekEngramStatus(
    { ENGRAM_API_KEY: 'eng_test' },
    (input) => {
      calls.push(String(input));
      return Promise.resolve(Response.json({ status: 'ok' }));
    },
  );

  assert.deepEqual(calls, ['https://api.engrammemory.ai/v1/health']);
  assert.deepEqual(result, { ok: true, configured: true, reachable: true });
});

test('Botek Engram search stays personal and bounded by the shared adapter', async () => {
  const fetcher: typeof fetch = (input, init) => {
    assert.equal(String(input), 'https://api.engrammemory.ai/v1/search');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      query: 'what did we decide?',
      top_k: 4,
      scope: 'personal',
    });
    return Promise.resolve(Response.json({
      results: [{ id: 'm1', content: 'Use one source of truth.', score: 0.9 }],
      query_tokens: 6,
    }));
  };

  const result = await botekEngramSearch(
    { ENGRAM_API_KEY: 'eng_test' },
    'what did we decide?',
    4,
    fetcher,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(
    (result.results as Array<Record<string, unknown>>)[0]?.content,
    'Use one source of truth.',
  );
});

test('Botek Engram store stamps client metadata without owning the credential', async () => {
  const fetcher: typeof fetch = (input, init) => {
    assert.equal(String(input), 'https://api.engrammemory.ai/v1/store');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      text: 'Prefer squash merges.',
      category: 'preference',
      importance: 0.8,
      metadata: {
        project: 'trvny/trvny',
        client: 'botek',
        source: 'mechagremlin',
      },
      collection: 'agent-memory',
    });
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer eng_test');
    return Promise.resolve(Response.json({
      id: 'm2',
      status: 'stored',
      category: 'preference',
      duplicate: false,
    }));
  };

  const result = await botekEngramStore(
    { ENGRAM_API_KEY: 'eng_test' },
    {
      text: 'Prefer squash merges.',
      category: 'preference',
      importance: 0.8,
      metadata: { project: 'trvny/trvny' },
    },
    fetcher,
  );

  assert.equal(result.ok, true);
  assert.equal(result.id, 'm2');
});


test('Botek Feedseek recent reuses the canonical bounded feed adapter', async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(String(input), 'https://feeds.trfny.com/mcp');
    const body = JSON.parse(String(init?.body)) as {
      method?: string;
      params?: { name?: string; arguments?: Record<string, unknown> };
    };
    assert.equal(body.method, 'tools/call');
    assert.equal(body.params?.name, 'recent');
    assert.deepEqual(body.params?.arguments, {
      query: 'OpenAI',
      sources: ['tech'],
      limit: 7,
      since: '2026-09-18T18:00:00Z',
    });
    return Response.json({
      jsonrpc: '2.0',
      id: 'gremlin-recent',
      result: {
        isError: false,
        structuredContent: {
          entries: [{ id: 'e1', title: 'Fresh thing' }],
        },
      },
    });
  };

  const result = await botekFeedseekRecent(
    {},
    {
      query: 'OpenAI',
      sources: ['tech'],
      limit: 7,
      since: '2026-09-18T18:00:00Z',
    },
    fetcher,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.entries, [{ id: 'e1', title: 'Fresh thing' }]);
});

test('Botek GitHub pull status returns one compact read-only snapshot', async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/repos/trvny/trvny/pulls/708') {
      return Response.json({
        additions: 10,
        base: { ref: 'main', sha: 'a'.repeat(40) },
        changed_files: 2,
        deletions: 1,
        draft: false,
        head: { sha: 'b'.repeat(40) },
        mergeable: true,
        mergeable_state: 'clean',
        merged: false,
        number: 708,
        state: 'open',
        title: 'Watch me',
      });
    }
    if (url.pathname === `/repos/trvny/trvny/commits/${'b'.repeat(40)}/check-runs`) {
      return Response.json({
        check_runs: [
          { status: 'completed', conclusion: 'success' },
          { status: 'in_progress', conclusion: null },
        ],
      });
    }
    if (url.pathname === `/repos/trvny/trvny/commits/${'b'.repeat(40)}/status`) {
      return Response.json({ statuses: [{ state: 'success' }] });
    }
    if (url.pathname === '/repos/trvny/trvny/pulls/708/reviews') {
      return Response.json([
        { state: 'APPROVED', user: { login: 'reviewer' } },
      ]);
    }
    throw new Error(`unexpected GitHub request: ${url.pathname}`);
  };
  const client = new GitHubInstallationClient(
    { token: 'test', expiresAt: '2099-01-01T00:00:00Z', permissions: {} },
    fetcher,
  );

  const result = await botekGithubPullStatus({}, 'trvny/trvny', 708, fetch, client);
  assert.deepEqual(result, {
    ok: true,
    repository: 'trvny/trvny',
    number: 708,
    title: 'Watch me',
    state: 'open',
    merged: false,
    draft: false,
    headSha: 'b'.repeat(40),
    mergeable: true,
    mergeableState: 'clean',
    ci: { total: 3, pending: 1, failed: 0, passed: 2 },
    reviews: { approvals: 1, changes: 0 },
  });
});

test('Botek GitHub watch rejects repositories outside the configured owner scope', async () => {
  await assert.rejects(
    () => botekGithubPullStatus({}, 'someone/else', 1),
    /botek_repository_not_allowed/u,
  );
});
