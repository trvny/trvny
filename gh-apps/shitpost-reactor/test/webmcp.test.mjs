import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import worker from '../worker.mjs';
import { WEBMCP_SCRIPT } from '../webmcp.mjs';

test('Reactor exposes a read-only WebMCP tool with bounded public feed access', async () => {
  const script = await worker.fetch(new Request('https://shitpost-reactor.travny.workers.dev/webmcp.js'), {});
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);
  const page = await worker.fetch(new Request('https://shitpost-reactor.travny.workers.dev/'), { FEED: { get: () => null } });
  assert.match(await page.text(), /<script src="\/webmcp.js" defer><\/script>/);
  const tools = [];
  const window = new EventTarget();
  const sandbox = { window, AbortController, console,
    document: { modelContext: { registerTool: (tool, options) => tools.push({ tool, options }) } },
    fetch: async (path) => {
      assert.equal(path, '/feed.json');
      return Response.json({ items: Array.from({ length: 7 }, () => ({ title: 'satire', summary: 'x'.repeat(300), url: 'https://example.test/post' })) });
    },
  };
  runInNewContext(WEBMCP_SCRIPT, sandbox);
  assert.equal(tools.length, 2);
  const { tool, options } = tools[0];
  const proposal = tools[1].tool;
  assert.equal(proposal.name, 'propose_reactor_post');
  assert.equal(proposal.annotations.readOnlyHint, false);
  assert.equal(proposal.annotations.consequentialHint, true);
  assert.equal((await proposal.execute({ language: 'pl', text: '' })).ok, false);
  assert.equal(tool.name, 'read_reactor_posts');
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal((await tool.execute({ limit: 6 })).ok, false);
  assert.equal((await tool.execute({ limit: 5 })).items.length, 5);
  const result = await tool.execute({ limit: 1 });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].summary.length, 240);
  const cached = new Event('pagehide');
  cached.persisted = true;
  window.dispatchEvent(cached);
  assert.equal(options.signal.aborted, false);
  window.dispatchEvent(new Event('pagehide'));
  assert.equal(options.signal.aborted, true);
});
