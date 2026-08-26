import assert from 'node:assert/strict';
import test from 'node:test';

import { askFreeRouters, parseReviewJson, patchRightLines, reviewablePath } from '../src/free-review.ts';

test('tracks RIGHT-side lines from a unified patch', () => {
  const lines = patchRightLines([
    '@@ -10,3 +10,4 @@ function demo() {',
    ' const before = true;',
    '-return oldValue;',
    '+const next = compute();',
    '+return next;',
    ' }',
  ].join('\n'));

  assert.deepEqual([...lines], [10, 11, 12, 13]);
});

test('skips documentation, lockfiles, and generated trees', () => {
  assert.equal(reviewablePath('README.md'), false);
  assert.equal(reviewablePath('package-lock.json'), false);
  assert.equal(reviewablePath('src/vendor/generated.ts'), false);
  assert.equal(reviewablePath('src/index.ts'), true);
  assert.equal(reviewablePath('.github/workflows/check.yml'), true);
});

test('accepts fenced JSON while preserving findings', () => {
  const parsed = parseReviewJson(`\`\`\`json\n{
    "summary": "One concrete issue.",
    "findings": [{
      "severity": "high",
      "path": "src/index.ts",
      "line": 42,
      "title": "Wrong guard",
      "body": "This branch can execute with an empty token."
    }]
  }\n\`\`\``);

  assert.equal(parsed?.summary, 'One concrete issue.');
  assert.equal(parsed?.findings.length, 1);
  assert.equal(parsed?.findings[0]?.path, 'src/index.ts');
});

test('rejects non-JSON model chatter', () => {
  assert.equal(parseReviewJson('Looks good to me.'), null);
});


function completion(content: string): Response {
  return Response.json({
    choices: [{ finish_reason: 'stop', message: { content } }],
  });
}

test('prefers OrcaRouter and asks for Simplified Chinese review text', async () => {
  const urls: string[] = [];
  let systemPrompt = '';

  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    urls.push(String(input));
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      messages?: Array<{ content?: string }>;
    };
    systemPrompt = body.messages?.[0]?.content ?? '';
    return completion('{"summary":"没有问题","findings":[]}');
  }) as typeof fetch;

  const result = await askFreeRouters(
    '{}',
    {
      ORCAROUTER_API_KEY: 'orca',
      OPENROUTER_API_KEY: 'openrouter',
    } as unknown as import('../src/free-review.ts').FreeReviewEnv,
    fetcher,
  );

  assert.equal(urls[0], 'https://api.orcarouter.ai/v1/chat/completions');
  assert.equal(urls.length, 1);
  assert.equal(result?.provider, 'OrcaRouter orcarouter/auto');
  assert.match(systemPrompt, /Simplified Chinese/);
});

test('falls back to OpenRouter when OrcaRouter output is unusable', async () => {
  const urls: string[] = [];

  const fetcher = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    if (urls.length === 1) return completion('not json');
    return completion('{"summary":"回退成功","findings":[]}');
  }) as typeof fetch;

  const result = await askFreeRouters(
    '{}',
    {
      ORCAROUTER_API_KEY: 'orca',
      OPENROUTER_API_KEY: 'openrouter',
    } as unknown as import('../src/free-review.ts').FreeReviewEnv,
    fetcher,
  );

  assert.deepEqual(urls, [
    'https://api.orcarouter.ai/v1/chat/completions',
    'https://openrouter.ai/api/v1/chat/completions',
  ]);
  assert.equal(result?.provider, 'OpenRouter free-pack');
  assert.equal(result?.parsed.summary, '回退成功');
});


test('falls back when OrcaRouter ignores the Chinese-language requirement', async () => {
  const urls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    if (urls.length === 1) return completion('{"summary":"Looks good","findings":[]}');
    return completion('{"summary":"中文回退成功","findings":[]}');
  }) as typeof fetch;
  const result = await askFreeRouters('{}', {
    ORCAROUTER_API_KEY: 'orca', OPENROUTER_API_KEY: 'openrouter',
  } as unknown as import('../src/free-review.ts').FreeReviewEnv, fetcher);
  assert.equal(result?.provider, 'OpenRouter free-pack');
});
