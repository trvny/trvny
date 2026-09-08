import assert from 'node:assert/strict';
import test from 'node:test';

import { addDocsOpenApi, handleDocsAction } from '../src/docs-actions.ts';

const origin = 'https://example.workers.dev';

function request(body: unknown): Request {
  return new Request(`${origin}/gpt-actions/docs/search`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer github-oauth-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function authorizedInvoke(input: Request): Promise<Response> {
  assert.equal(new URL(input.url).pathname, '/gpt-actions/github/read');
  assert.deepEqual(await input.json(), { path: '/user' });
  return Response.json({ ok: true, data: { login: 'trvny' } });
}

const llms = `# Example Docs

> Curated documentation for Example.

## Guides
- [Getting started](https://docs.example.com/sdk/start.md): First steps
- [Changelog](https://docs.example.com/sdk/changelog.md): Product updates and releases

## Optional
- [Reference](https://docs.example.com/sdk/reference.md): Complete reference
- [Website](https://docs.example.com/sdk/): Human-facing docs
`;

test('searchDocs discovers and fetches exact documents listed by llms.txt', async () => {
  const fetched: string[] = [];
  const fetchRemote = async (input: RequestInfo | URL): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    fetched.push(url);
    if (url === 'https://docs.example.com/sdk/llms.txt') {
      return new Response(llms, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    if (url === 'https://docs.example.com/sdk/changelog.md') {
      return new Response('# Changelog\n\nVersion 2 shipped.', {
        headers: { 'content-type': 'text/markdown' },
      });
    }
    return new Response('missing', { status: 404 });
  };

  const discovered = await handleDocsAction(
    request({ query: 'changelog releases', siteUrl: 'https://docs.example.com/sdk', limit: 4 }),
    authorizedInvoke,
    fetchRemote,
  );
  assert.ok(discovered);
  assert.equal(discovered.status, 200);
  const discovery = await discovered.json() as {
    source: string;
    llmsUrl: string;
    matches: Array<{ title: string; url: string; readable: boolean }>;
  };
  assert.equal(discovery.source, 'llms.txt');
  assert.equal(discovery.llmsUrl, 'https://docs.example.com/sdk/llms.txt');
  assert.equal(discovery.matches[0]?.title, 'Changelog');
  assert.equal(discovery.matches[0]?.readable, true);

  const selectedUrl = discovery.matches[0]?.url;
  const fetchedDocument = await handleDocsAction(
    request({
      query: 'changelog',
      siteUrl: 'https://docs.example.com/sdk/llms.txt',
      documentUrl: selectedUrl,
    }),
    authorizedInvoke,
    fetchRemote,
  );
  assert.ok(fetchedDocument);
  assert.equal(fetchedDocument.status, 200);
  const document = await fetchedDocument.json() as {
    document: { title: string; content: string };
  };
  assert.equal(document.document.title, 'Changelog');
  assert.match(document.document.content, /Version 2 shipped/);
  assert.deepEqual(fetched, [
    'https://docs.example.com/sdk/llms.txt',
    'https://docs.example.com/sdk/llms.txt',
    'https://docs.example.com/sdk/changelog.md',
  ]);
});

test('llms mode rejects unsafe origins before network access', async () => {
  for (const siteUrl of ['http://docs.example.com/', 'https://127.0.0.1/docs/']) {
    let fetches = 0;
    const response = await handleDocsAction(
      request({ query: '*', siteUrl }),
      authorizedInvoke,
      async () => {
        fetches += 1;
        return new Response('unexpected');
      },
    );
    assert.ok(response);
    assert.equal(response.status, 403);
    assert.equal(fetches, 0);
  }
});

test('llms mode cannot fetch an arbitrary document outside its current index', async () => {
  const response = await handleDocsAction(
    request({
      query: 'secret',
      siteUrl: 'https://docs.example.com/sdk/',
      documentUrl: 'https://docs.example.com/sdk/private.md',
    }),
    authorizedInvoke,
    async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      assert.equal(url, 'https://docs.example.com/sdk/llms.txt');
      return new Response(llms, { headers: { 'content-type': 'text/plain' } });
    },
  );
  assert.ok(response);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: 'document_not_listed_in_llms_txt' });
});

test('searchDocs OpenAPI exposes llms mode through the existing operation', () => {
  const document: Record<string, unknown> = { paths: {} };
  addDocsOpenApi(document);
  const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>;
  const operation = paths['/gpt-actions/docs/search'].post;
  assert.equal(operation.operationId, 'searchDocs');
  const requestBody = operation.requestBody as {
    content: { 'application/json': { schema: { properties: Record<string, unknown> } } };
  };
  const properties = requestBody.content['application/json'].schema.properties;
  assert.ok(properties.siteUrl);
  assert.ok(properties.documentUrl);
});
