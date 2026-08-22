import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEPENDENCY_GRAPH_PATH,
  extractImports,
  handleDependencyGraphAction,
  importReferencesTarget,
} from '../src/dependency-graph.ts';

test('extractImports finds common module, dotted and Rust imports', () => {
  const content = [
    "import { Widget } from './widget.js';",
    "const lazy = import('./lazy');",
    "const old = require('../legacy');",
    'from .helpers import parse',
    'import app.services.feed',
    'use crate::model::Feed;',
  ].join('\n');

  assert.deepEqual(
    extractImports(content).map(({ specifier, syntax }) => [specifier, syntax]),
    [
      ['./widget.js', 'module'],
      ['./lazy', 'module'],
      ['../legacy', 'module'],
      ['.helpers', 'python'],
      ['app.services.feed', 'python'],
      ['crate::model::Feed', 'rust'],
    ],
  );
});

test('importReferencesTarget resolves relative and dotted callers conservatively', () => {
  assert.equal(importReferencesTarget('src/caller.ts', './widget', 'src/widget.ts'), 'high');
  assert.equal(importReferencesTarget('src/caller.ts', './feature', 'src/feature/index.ts'), 'high');
  assert.equal(importReferencesTarget('src/caller.ts', './widget', 'other/src/widget.ts'), null);
  assert.equal(importReferencesTarget('app/views.py', 'app.services.feed', 'app/services/feed.py', 'python'), 'medium');
  assert.equal(
    importReferencesTarget(
      'app/src/main/kotlin/example/Caller.kt',
      'example.services.Feed',
      'app/src/main/kotlin/example/services/Feed.kt',
      'python',
    ),
    'medium',
  );
  assert.equal(importReferencesTarget('src/caller.ts', './other', 'src/widget.ts'), null);
});

test('dependency graph pins caller verification to the resolved snapshot', async () => {
  const sha = 'c'.repeat(40);
  const target = "import { dep } from './dep';\nexport const Widget = dep;\n";
  const caller = "import { Widget } from './widget';\nconsole.log(Widget);\n";
  const source = new Request('https://example.workers.dev' + DEPENDENCY_GRAPH_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
    body: JSON.stringify({
      repository: 'trvny/trvny',
      path: 'src/widget.ts',
      ref: 'main',
      maxCallers: 4,
    }),
  });

  const invoke = async (request: Request): Promise<Response> => {
    const body = (await request.json()) as Record<string, unknown>;
    assert.equal(new URL(request.url).pathname, '/gpt-actions/github/read');
    const path = String(body.path);
    if (path === '/repos/trvny/trvny') {
      return Response.json({ ok: true, data: { default_branch: 'main' } });
    }
    if (path === '/repos/trvny/trvny/commits/main') {
      return Response.json({ ok: true, data: { sha } });
    }
    if (path === `/repos/trvny/trvny/contents/src/widget.ts?ref=${sha}`) {
      return Response.json({
        ok: true,
        data: {
          sha: 'target-blob',
          size: target.length,
          encoding: 'base64',
          content: Buffer.from(target).toString('base64'),
        },
      });
    }
    if (path.startsWith('/search/code?')) {
      assert.match(decodeURIComponent(path), /widget repo:trvny\/trvny/);
      return Response.json({
        ok: true,
        data: {
          total_count: 2,
          incomplete_results: false,
          items: [{ path: 'src/widget.ts' }, { path: 'src/caller.ts' }],
        },
      });
    }
    if (path === `/repos/trvny/trvny/contents/src/caller.ts?ref=${sha}`) {
      return Response.json({
        ok: true,
        data: {
          sha: 'caller-blob',
          size: caller.length,
          encoding: 'base64',
          content: Buffer.from(caller).toString('base64'),
        },
      });
    }
    return Response.json({ ok: false, error: `unexpected_read:${path}` }, { status: 500 });
  };

  const response = await handleDependencyGraphAction(source, invoke);
  assert.ok(response);
  assert.equal(response.status, 200);
  const payload = (await response.json()) as Record<string, any>;
  assert.equal(payload.repository.resolvedRefSha, sha);
  assert.equal(payload.target.imports[0].specifier, './dep');
  assert.deepEqual(payload.affectedModules, ['src/caller.ts']);
  assert.equal(payload.callers[0].matches[0].confidence, 'high');
  assert.equal(payload.summary.callers, 1);
});

test('dependency graph is exposed as a POST action', async () => {
  const response = await handleDependencyGraphAction(
    new Request('https://example.workers.dev' + DEPENDENCY_GRAPH_PATH, { method: 'GET' }),
    async () => Response.json({ ok: false }, { status: 500 }),
  );
  assert.ok(response);
  assert.equal(response.status, 405);
});
