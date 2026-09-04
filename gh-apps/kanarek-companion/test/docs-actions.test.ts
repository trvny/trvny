import assert from 'node:assert/strict';
import test from 'node:test';

import { addDocsOpenApi, handleDocsAction } from '../src/docs-actions.ts';

const origin = 'https://example.workers.dev';

function request(path: string, body?: unknown, method = 'POST'): Request {
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      authorization: 'Bearer github-oauth-token',
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function invokeFor(values: Record<string, unknown>) {
  return async (input: Request): Promise<Response> => {
    assert.equal(new URL(input.url).pathname, '/gpt-actions/github/read');
    assert.equal(input.method, 'POST');
    assert.equal(input.headers.get('authorization'), 'Bearer github-oauth-token');
    const body = await input.json() as { path: string };
    if (body.path === '/user') return Response.json({ ok: true, data: { login: 'trvny' } });
    if (!(body.path in values)) {
      return Response.json({ ok: false, error: `missing:${body.path}` }, { status: 404 });
    }
    return Response.json({ ok: true, data: values[body.path] });
  };
}

test('live docs Actions expose OAuth-protected index/search/get operations', () => {
  const document: Record<string, unknown> = { paths: {} };
  addDocsOpenApi(document);
  const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>;
  assert.equal(paths['/gpt-actions/docs/index'].post.operationId, 'getDocsIndex');
  assert.equal(paths['/gpt-actions/docs/search'].post.operationId, 'searchDocs');
  assert.equal(paths['/gpt-actions/docs/get'].post.operationId, 'getDoc');
  for (const operation of [
    paths['/gpt-actions/docs/index'].post,
    paths['/gpt-actions/docs/search'].post,
    paths['/gpt-actions/docs/get'].post,
  ]) {
    assert.deepEqual(operation.security, [{ githubOAuth: [] }]);
  }
});

test('operator authorization fails closed before documentation reads', async () => {
  let reads = 0;
  const response = await handleDocsAction(
    request('/gpt-actions/docs/index', { repository: 'trvny/trvny' }),
    async (input) => {
      reads += 1;
      assert.deepEqual(await input.json(), { path: '/user' });
      return Response.json({ ok: true, data: { login: 'someone-else' } });
    },
  );
  assert.ok(response);
  assert.equal(reads, 1);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: 'operator_not_allowed' });
});

test('docs index lists only bounded documentation-like files', async () => {
  const response = await handleDocsAction(
    request('/gpt-actions/docs/index', { repository: 'trvny/trvny' }),
    invokeFor({
      '/repos/trvny/trvny': { default_branch: 'main' },
      '/repos/trvny/trvny/git/trees/main?recursive=1': {
        truncated: false,
        tree: [
          { path: 'README.md', type: 'blob', sha: 'a', size: 10 },
          { path: 'src/index.ts', type: 'blob', sha: 'b', size: 20 },
          { path: 'docs/openapi.json', type: 'blob', sha: 'c', size: 30 },
          { path: 'llms.txt', type: 'blob', sha: 'd', size: 40 },
        ],
      },
    }),
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  const body = await response.json() as {
    documents: Array<{ path: string }>;
    discoveryHints: string[];
  };
  assert.deepEqual(body.documents.map((entry) => entry.path), [
    'docs/openapi.json',
    'llms.txt',
    'README.md',
  ]);
  assert.deepEqual(body.discoveryHints, ['llms.txt']);
});

test('getDoc resolves the default branch and decodes UTF-8 content', async () => {
  const content = '# hello\nżółw';
  const encoded = Buffer.from(content, 'utf8').toString('base64');
  const response = await handleDocsAction(
    request('/gpt-actions/docs/get', { repository: 'trvny/feedseek', path: 'README.md' }),
    invokeFor({
      '/repos/trvny/feedseek': { default_branch: 'main' },
      '/repos/trvny/feedseek/contents/README.md?ref=main': {
        type: 'file',
        size: Buffer.byteLength(content),
        encoding: 'base64',
        content: encoded,
        sha: 'abc',
        html_url: 'https://github.com/trvny/feedseek/blob/main/README.md',
      },
    }),
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  const body = await response.json() as { content: string; ref: string };
  assert.equal(body.content, content);
  assert.equal(body.ref, 'main');
});

test('searchDocs stays scoped to trvny and filters code files', async () => {
  let searchPath = '';
  const response = await handleDocsAction(
    request('/gpt-actions/docs/search', { query: 'Atom feed' }),
    async (input) => {
      const body = await input.json() as { path: string };
      if (body.path === '/user') return Response.json({ ok: true, data: { login: 'trvny' } });
      searchPath = body.path;
      return Response.json({
        ok: true,
        data: {
          items: [
            {
              path: 'README.md',
              name: 'README.md',
              sha: 'a',
              repository: { full_name: 'trvny/feedseek' },
            },
            {
              path: 'src/index.ts',
              name: 'index.ts',
              sha: 'b',
              repository: { full_name: 'trvny/feedseek' },
            },
            {
              path: 'README.md',
              name: 'README.md',
              sha: 'c',
              repository: { full_name: 'someone/else' },
            },
          ],
        },
      });
    },
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.match(decodeURIComponent(searchPath), /user:trvny/);
  const body = await response.json() as {
    matches: Array<{ repository: string; path: string }>;
  };
  assert.deepEqual(
    body.matches.map((entry) => `${entry.repository}:${entry.path}`),
    ['trvny/feedseek:README.md'],
  );
});

test('live docs blocks non-document paths and foreign repositories', async () => {
  const invoke = invokeFor({});
  const code = await handleDocsAction(
    request('/gpt-actions/docs/get', { repository: 'trvny/trvny', path: 'src/index.ts' }),
    invoke,
  );
  assert.ok(code);
  assert.equal(code.status, 403);
  assert.deepEqual(await code.json(), { ok: false, error: 'documentation_path_not_allowed' });

  const foreign = await handleDocsAction(
    request('/gpt-actions/docs/index', { repository: 'openai/openai' }),
    invoke,
  );
  assert.ok(foreign);
  assert.equal(foreign.status, 403);
  assert.deepEqual(await foreign.json(), { ok: false, error: 'repository_not_allowed' });
});
