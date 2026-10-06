import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pluginRoot = new URL('../plugin/', import.meta.url);

test('MechaGremlin plugin targets the standalone guarded Gremlin MCP', async () => {
  const plugin = JSON.parse(await readFile(new URL('plugin.json', pluginRoot), 'utf8')) as {
    name?: string;
    version?: string;
    homepage?: string;
  };
  const mcpText = await readFile(new URL('mcp.json', pluginRoot), 'utf8');
  const mcp = JSON.parse(mcpText) as {
    mcpServers?: { gremlin?: { type?: string; url?: string } };
  };

  assert.equal(plugin.name, 'mechagremlin');
  assert.equal(plugin.version, '0.31.2');
  assert.match(plugin.homepage ?? '', /gh-apps\/gremlin\/plugin$/);
  assert.equal(mcp.mcpServers?.gremlin?.type, 'streamable-http');
  assert.equal(
    mcp.mcpServers?.gremlin?.url,
    'https://gremlin.travny.workers.dev/mcp',
  );
  assert.equal(mcpText.includes('/gpt-actions'), false);
});
