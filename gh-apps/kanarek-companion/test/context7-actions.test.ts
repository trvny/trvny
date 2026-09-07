import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addContext7OpenApi,
  handleContext7Action,
  type Context7ActionEnv,
} from '../src/context7-actions.ts';

const origin = 'https://example.workers.dev';

function request(body: unknown): Request {
  return new Request(`${origin}/gpt-actions/context7/search`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer github-oauth-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function authorizedInvoke(): (input: Request) => Promise<Response> {
  return async (input) => {
    assert.equal(new URL(input.url).pathname, '/gpt-actions/github/read');
    assert.equal(input.headers.get('authorization'), 'Bearer github-oauth-token');
    assert.deepEqual(await input.json(), { path: '/user' });
    return Response.json({ ok: true, data: { login: 'trvny' } });
  };
}

test('Context7 Action is OAuth-protected and appears in OpenAPI', () => {
  const document: Record<string, unknown> = { paths: {} };
  addContext7OpenApi(document);
  const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>;
  const operation = paths['/gpt-actions/context7/search'].post;
  assert.equal(operation.operationId, 'searchContext7Docs');
  assert.deepEqual(operation.security, [{ githubOAuth: [] }]);
});

test('operator authorization happens before Context7 or its credential is touched', async () => {
  let upstreamCalls = 0;
  const response = await handleContext7Action(
    request({ libraryName: 'Wrangler', query: 'durable objects' }),
    { CONTEXT7_API_KEY: 'ctx7_super_secret' },
    () => Promise.resolve(Response.json({ ok: false, error: 'forbidden' }, { status: 403 })),
    () => {
      upstreamCalls += 1;
      return Promise.reject(new Error('Context7 must not be called'));
    },
  );
  assert.ok(response);
  assert.equal(response.status, 403);
  assert.equal(upstreamCalls, 0);
  assert.equal((await response.text()).includes('ctx7_super_secret'), false);
});

test('Context7 resolves a library then returns bounded current documentation', async () => {
  const env = { CONTEXT7_API_KEY: 'ctx7_test' } satisfies Context7ActionEnv;
  let calls = 0;
  const fetcher: typeof fetch = (input, init) => {
    calls += 1;
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer ctx7_test');
    assert.equal(headers.get('x-context7-source'), 'mechagremlin');
    if (calls === 1) {
      assert.equal(url.pathname, '/api/v2/libs/search');
      assert.equal(url.searchParams.get('libraryName'), 'Wrangler');
      assert.equal(url.searchParams.get('query'), 'How do service bindings work?');
      return Promise.resolve(Response.json({
        results: [{
          id: '/cloudflare/workers-sdk',
          title: 'Workers SDK',
          description: 'Cloudflare Workers developer tooling',
          branch: 'main',
          totalSnippets: 123,
          trustScore: 9.7,
          benchmarkScore: 88.2,
        }],
      }));
    }
    assert.equal(url.pathname, '/api/v2/context');
    assert.equal(url.searchParams.get('libraryId'), '/cloudflare/workers-sdk');
    assert.equal(url.searchParams.get('query'), 'How do service bindings work?');
    assert.equal(url.searchParams.get('type'), 'json');
    return Promise.resolve(Response.json({
      codeSnippets: [{
        codeTitle: 'Service binding',
        codeDescription: 'Call another Worker.',
        codeLanguage: 'typescript',
        pageTitle: 'Bindings',
        codeList: [{ language: 'typescript', code: 'await env.API.fetch(request);' }],
      }],
      infoSnippets: [{ breadcrumb: 'Workers > Bindings', content: 'Service bindings connect Workers.' }],
    }));
  };

  const response = await handleContext7Action(
    request({ libraryName: 'Wrangler', query: 'How do service bindings work?', limit: 4 }),
    env,
    authorizedInvoke(),
    fetcher,
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(await response.json(), {
    ok: true,
    resolved: true,
    authenticated: true,
    library: {
      id: '/cloudflare/workers-sdk',
      title: 'Workers SDK',
      description: 'Cloudflare Workers developer tooling',
      branch: 'main',
      totalSnippets: 123,
      totalTokens: null,
      stars: null,
      trustScore: 9.7,
      benchmarkScore: 88.2,
      versions: [],
    },
    snippets: [
      {
        kind: 'code',
        title: 'Service binding',
        description: 'Call another Worker.',
        language: 'typescript',
        pageTitle: 'Bindings',
        examples: [{ language: 'typescript', code: 'await env.API.fetch(request);' }],
      },
      {
        kind: 'info',
        title: 'Workers > Bindings',
        content: 'Service bindings connect Workers.',
      },
    ],
  });
});

test('an exact Context7 library ID skips resolution', async () => {
  let calls = 0;
  const fetcher: typeof fetch = (input) => {
    calls += 1;
    const url = new URL(String(input));
    assert.equal(url.pathname, '/api/v2/context');
    assert.equal(url.searchParams.get('libraryId'), '/modelcontextprotocol/modelcontextprotocol');
    return Promise.resolve(Response.json({ codeSnippets: [], infoSnippets: [] }));
  };
  const response = await handleContext7Action(
    request({
      libraryName: 'MCP',
      libraryId: '/modelcontextprotocol/modelcontextprotocol',
      query: 'stateless HTTP',
    }),
    { CONTEXT7_API_KEY: 'ctx7_test' },
    authorizedInvoke(),
    fetcher,
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  const payload = await response.json() as { resolved: boolean };
  assert.equal(payload.resolved, false);
});

test('Context7 works anonymously when no API key is configured', async () => {
  let calls = 0;
  const fetcher: typeof fetch = (input, init) => {
    calls += 1;
    const url = new URL(String(input));
    assert.equal(url.pathname, '/api/v2/context');
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    return Promise.resolve(Response.json({
      codeSnippets: [],
      infoSnippets: [{ breadcrumb: 'React', content: 'Hooks documentation.' }],
    }));
  };
  const response = await handleContext7Action(
    request({
      libraryName: 'React',
      libraryId: '/websites/react_dev',
      query: 'hooks',
    }),
    {},
    authorizedInvoke(),
    fetcher,
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  const payload = await response.json() as { authenticated: boolean };
  assert.equal(payload.authenticated, false);
});

test('Context7 rejects invalid library IDs before upstream access', async () => {
  const invalid = await handleContext7Action(
    request({ libraryName: 'React', libraryId: 'https://evil.test/x', query: 'hooks' }),
    { CONTEXT7_API_KEY: 'ctx7_test' },
    authorizedInvoke(),
    () => Promise.reject(new Error('Context7 must not be called for invalid input')),
  );
  assert.ok(invalid);
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { ok: false, error: 'invalid_library_id' });
});

test('Context7 upstream error bodies and credentials are never relayed', async () => {
  const response = await handleContext7Action(
    request({ libraryName: 'React', query: 'hooks' }),
    { CONTEXT7_API_KEY: 'ctx7_super_secret' },
    authorizedInvoke(),
    () => Promise.resolve(new Response('secret provider diagnostic ctx7_super_secret', { status: 401 })),
  );
  assert.ok(response);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, error: 'context7_auth_failed' });
});
