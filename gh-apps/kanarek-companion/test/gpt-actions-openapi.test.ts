import assert from 'node:assert/strict';
import test from 'node:test';

import { customGptOpenApi } from '../src/router.ts';

test('Custom GPT OpenAPI includes validator-friendly object schemas', () => {
  const document = customGptOpenApi('https://example.workers.dev') as {
    components: { schemas: Record<string, unknown> };
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
