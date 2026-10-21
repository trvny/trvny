import assert from 'node:assert/strict';
import test from 'node:test';

import { searchContext7Docs } from '../src/tools/context7.ts';
import { getEngramStatus } from '../src/tools/engram.ts';
import { searchFeedseek } from '../src/tools/feedseek.ts';
import { SpecialistToolError } from '../src/tools/common.ts';

const REDIRECT = 'https://unexpected.example/steal-token';

test('Context7 uses workerd-compatible manual redirects and rejects redirect responses', async () => {
  const fetcher: typeof fetch = async (_input, init) => {
    assert.equal(init?.redirect, 'manual');
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    return new Response(null, { status: 302, headers: { location: REDIRECT } });
  };
  await assert.rejects(
    searchContext7Docs({ libraryName: 'Hono', query: 'routing' }, {}, fetcher),
    (error: unknown) => error instanceof SpecialistToolError && error.code === 'context7_http_302',
  );
});

test('Feedseek rejects an upstream redirect instead of following it', async () => {
  const fetcher: typeof fetch = async (_input, init) => {
    assert.equal(init?.redirect, 'manual');
    return new Response(null, { status: 307, headers: { location: REDIRECT } });
  };
  await assert.rejects(
    searchFeedseek({ query: 'Cloudflare' }, fetcher),
    (error: unknown) => error instanceof SpecialistToolError && error.code === 'feedseek_http_307',
  );
});

test('Engram does not forward its bearer token across redirects', async () => {
  const fetcher: typeof fetch = async (_input, init) => {
    assert.equal(init?.redirect, 'manual');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-secret');
    return new Response(null, { status: 308, headers: { location: REDIRECT } });
  };
  assert.deepEqual(await getEngramStatus({ ENGRAM_API_KEY: 'test-secret' }, fetcher), {
    ok: true,
    configured: true,
    reachable: false,
    error: 'engram_http_308',
  });
});

test('all guarded upstream clients refuse automatic redirects in workerd', async () => {
  const { readFile } = await import('node:fs/promises');
  const paths = [
    '../src/tools/context7.ts',
    '../src/tools/feedseek.ts',
    '../src/tools/engram.ts',
    '../src/specialists/anchor-storage.ts',
    '../src/specialists/package-intelligence.ts',
  ];
  for (const path of paths) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /redirect: 'manual'/, path);
    assert.doesNotMatch(source, /redirect: 'error'/, path);
  }
});
