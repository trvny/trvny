import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const INSTRUCTIONS_URL = new URL(
  '../../../.ai/private/openai/gremlin-builder-instructions.md',
  import.meta.url,
);

test('Gremlin Builder instructions stay compact and runtime-oriented', async () => {
  const instructions = await readFile(INSTRUCTIONS_URL, 'utf8');

  assert.ok(Buffer.byteLength(instructions, 'utf8') <= 8_000);
  assert.match(instructions, /getOperatorBootstrap/);
  assert.match(instructions, /getOperatorCapabilities/);
  assert.match(instructions, /runOperatorAutopilot/);
  assert.match(instructions, /orchestrateRelease/);
  assert.match(instructions, /Runtime policy is authoritative/);
});
