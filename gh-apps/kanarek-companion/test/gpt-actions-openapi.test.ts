import assert from 'node:assert/strict';
import test from 'node:test';

import {
  customGptOpenApi,
  githubOAuthAuthorizationUrl,
  normalizeGptActionsRequest,
} from '../src/router.ts';

test('Custom GPT OpenAPI includes validator-friendly object schemas', () => {
  const document = customGptOpenApi('https://example.workers.dev') as {
    components: {
      schemas: Record<string, unknown>;
      securitySchemes: {
        githubOAuth: {
          flows: {
            authorizationCode: {
              authorizationUrl: string;
              scopes: Record<string, string>;
            };
          };
        };
      };
    };
    paths: Record<
      string,
      Record<
        string,
        {
          responses?: Record<
            string,
            {
              content?: Record<
                string,
                { schema?: { type?: unknown; properties?: unknown } }
              >;
            }
          >;
        }
      >
    >;
  };

  assert.deepEqual(document.components.schemas, {});
  assert.equal(
    document.components.securitySchemes.githubOAuth.flows.authorizationCode.authorizationUrl,
    'https://example.workers.dev/gpt-actions/oauth/authorize',
  );
  assert.deepEqual(
    document.components.securitySchemes.githubOAuth.flows.authorizationCode.scopes,
    { github: 'Authenticate with the installed GitHub App' },
  );

  for (const path of Object.values(document.paths)) {
    for (const operation of Object.values(path)) {
      const schema =
        operation.responses?.['200']?.content?.['application/json']?.schema;
      if (schema?.type === 'object') {
        assert.ok(schema.properties && typeof schema.properties === 'object');
      }
    }
  }
});

test('GitHub App OAuth bridge strips the synthetic ChatGPT scope', () => {
  const target = new URL(
    githubOAuthAuthorizationUrl(
      'https://example.workers.dev/gpt-actions/oauth/authorize?client_id=Iv1.test&redirect_uri=https%3A%2F%2Fchat.openai.com%2Faip%2Fcallback&state=abc&scope=github',
    ),
  );

  assert.equal(target.origin, 'https://github.com');
  assert.equal(target.pathname, '/login/oauth/authorize');
  assert.equal(target.searchParams.get('client_id'), 'Iv1.test');
  assert.equal(target.searchParams.get('redirect_uri'), 'https://chat.openai.com/aip/callback');
  assert.equal(target.searchParams.get('state'), 'abc');
  assert.equal(target.searchParams.has('scope'), false);
});

test('reaction writes discard GitHub response bodies', async () => {
  const request = new Request('https://example.workers.dev/gpt-actions/github/bot', {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      method: 'POST',
      path: '/repos/trvny/trvny/issues/245/reactions',
      body: { content: '+1' },
      expect: 'json',
    }),
  });

  const normalized = await normalizeGptActionsRequest(request);
  const payload = (await normalized.json()) as Record<string, unknown>;

  assert.equal(normalized.headers.get('authorization'), 'Bearer test-token');
  assert.equal(payload.expect, 'empty');
});
