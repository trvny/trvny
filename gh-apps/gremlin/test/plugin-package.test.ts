import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const pluginRoot = new URL('../plugin/', import.meta.url);

async function file(path: string): Promise<string> {
  return readFile(new URL(path, pluginRoot), 'utf8');
}

test('portable MechaGremlin manifest references the installed MCP app and original logo', async () => {
  const manifest = JSON.parse(await file('plugin.json')) as {
    version: string;
    extensions: { 'com.openai': {
      apps: string;
      interface: { logo: string; composerIcon: string; capabilities: string[] };
    } };
  };
  const app = JSON.parse(await file('.app.json')) as { apps: { connector: { id: string } } };
  const mcp = JSON.parse(await file('mcp.json')) as {
    mcpServers: { gremlin: { url: string } };
  };

  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.extensions['com.openai'].apps, './.app.json');
  assert.deepEqual(manifest.extensions['com.openai'].interface.capabilities, ['skills']);
  assert.match(app.apps.connector.id, /^asdk_app_[a-z0-9]+$/);
  assert.equal(mcp.mcpServers.gremlin.url, 'https://gremlin.travny.workers.dev/mcp');

  for (const path of [
    manifest.extensions['com.openai'].interface.logo,
    manifest.extensions['com.openai'].interface.composerIcon,
  ]) {
    assert.equal(path, './assets/gpt-icon.png');
  }
  const png = await readFile(new URL('assets/gpt-icon.png', pluginRoot));
  assert.ok(png.length > 0 && png.length < 10 * 1024);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), 256);
  assert.equal(png.readUInt32BE(20), 256);
});

test('Gremlin skill keeps only the canonical references and no user snapshot', async () => {
  const skillPath = 'skills/gremlin/';
  const skill = await file(skillPath + 'SKILL.md');
  assert.match(skill, /^---\nname: gremlin\n/);
  const index = JSON.parse(await file(skillPath + 'lookup/knowledge-index.json')) as {
    files: Array<{ name: string; path: string }>;
  };
  const names = index.files.map((entry) => entry.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names.sort(), [
    'GREMLIN_EDGY_DARK_MEME_KNOWLEDGE.md',
    'edgy-dark-meme-formats.json',
    'gremlin-style.md',
    'migration.md',
  ].sort());
  for (const entry of index.files) {
    assert.equal(entry.path, 'references/' + entry.name);
    await file(skillPath + entry.path);
  }
  const refs = await readdir(new URL(skillPath + 'references/', pluginRoot));
  for (const removed of ['AGENTS.md', 'GREMLIN_STYLE.md', 'USER_CONTEXT.md']) {
    assert.equal(refs.includes(removed), false);
  }
  assert.ok((await file(skillPath + 'agents/openai.yaml')).includes('display_name: Gremlin'));
});
