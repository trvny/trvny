import assert from 'node:assert/strict';
import test from 'node:test';

import { combineMcpSurfaces, InvalidToolArgumentsError, type McpSurface } from '../src/specialists/mcp-protocol.ts';

function surface(name: string, server: string): McpSurface {
  return {
    serverInfo: { name: server },
    instructions: server,
    tools: () => [{ name }],
    hasTool: (tool) => tool === name,
    async callTool(tool, args) {
      assert.equal(tool, name);
      return { server, args };
    },
  };
}

test('combined MCP surface rejects duplicate tool names', () => {
  assert.throws(
    () => combineMcpSurfaces(surface('same', 'primary'), surface('same', 'secondary'), 'combined'),
    /duplicate_mcp_tool:same/,
  );
});

test('combined MCP surface preserves primary identity and dispatches to the owning surface', async () => {
  const combined = combineMcpSurfaces(surface('operator', 'primary'), surface('specialist', 'secondary'), 'combined');
  assert.deepEqual(combined.serverInfo, { name: 'primary' });
  assert.equal(combined.instructions, 'combined');
  assert.equal(combined.serializeBatchToolCalls, true);
  assert.deepEqual(combined.tools(), [{ name: 'operator' }, { name: 'specialist' }]);
  assert.equal(combined.hasTool('operator'), true);
  assert.equal(combined.hasTool('specialist'), true);
  assert.equal(combined.hasTool('unknown'), false);
  assert.deepEqual(await combined.callTool('operator', { id: 1 }), { server: 'primary', args: { id: 1 } });
  assert.deepEqual(await combined.callTool('specialist', { id: 2 }), { server: 'secondary', args: { id: 2 } });
  assert.throws(() => combined.callTool('unknown', {}), InvalidToolArgumentsError);
});
