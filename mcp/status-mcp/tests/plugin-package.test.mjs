import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const repoRoot = new URL("../../../", import.meta.url);
const pluginDir = new URL("../plugin/", import.meta.url);
const read = (path) => readFile(new URL(path, pluginDir), "utf8");

test("Status plugin is read-only and keeps canonical Worker and branding", async () => {
  const plugin = JSON.parse(await read("plugin.json"));
  const mcpText = await read("mcp.json");
  const mcp = JSON.parse(mcpText);
  const server = mcp.mcpServers?.["status-mcp"];
  const display = plugin.extensions?.["com.openai"]?.interface;
  assert.equal(plugin.name, "trvny-status");
  assert.equal(plugin.version, "0.1.0");
  assert.equal(display?.displayName, "TRAVNY Status");
  assert.ok(display.shortDescription.length <= 30);
  assert.deepEqual(display.capabilities, ["Read"]);
  assert.equal(display.logo, "./assets/icon.svg");
  assert.equal(display.composerIcon, "./assets/icon.svg");
  assert.equal(server?.type, "streamable-http");
  assert.equal(server?.url, "https://status-mcp.travny.workers.dev/");
  assert.equal(server?.bearer_token_env_var, "STATUS_MCP_TOKEN");
  assert.deepEqual(server?.extensions?.["com.openai"]?.auth, { type: "api_key", headerScheme: "bearer" });
  assert.equal(Object.keys(mcp.mcpServers).length, 1);
  assert.equal(new URL(server.url).pathname, "/");
  assert.equal(mcpText.includes("token="), false);
  assert.equal(/Authorization: Bearer [A-Za-z0-9_-]{25,}/iu.test(mcpText), false);
  const icon = await read("assets/icon.svg");
  const master = await readFile(new URL("assets/status-mcp.svg", repoRoot), "utf8");
  assert.equal(icon, master, "Generated plugin icon must match canonical root SVG");
  assert.match(icon, /#FFFDF8/u);
});

test("Status plugin skill teaches existing service tools and marketplace points to package", async () => {
  const skill = await read("skills/trvny-service-health/SKILL.md");
  assert.match(skill, /name: trvny-service-health/u);
  for (const phrase of ["`status`", "`tvpi`", "`feeds`", "`weather`", "`autka`", "`deep: true`"]) {
    assert.ok(skill.includes(phrase), phrase);
  }
  const marketplace = JSON.parse(await readFile(new URL(".agents/plugins/marketplace.json", repoRoot), "utf8"));
  const entry = marketplace.plugins.find((candidate) => candidate.name === "trvny-status");
  assert.equal(entry?.source?.path, "./mcp/status-mcp/plugin");
  assert.equal(entry?.category, "Developer Tools");
});
