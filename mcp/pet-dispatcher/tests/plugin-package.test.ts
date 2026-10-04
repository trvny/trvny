import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pluginRoot = new URL("../plugin/", import.meta.url);
const repoRoot = new URL("../../../", import.meta.url);

test("Pet Dispatcher plugin package reuses the existing remote MCP without embedding secrets", async () => {
  const plugin = JSON.parse(await readFile(new URL("plugin.json", pluginRoot), "utf8")) as {
    name?: string;
    version?: string;
    homepage?: string;
    extensions?: {
      "com.openai"?: {
        interface?: {
          category?: string;
          capabilities?: string[];
          logo?: string;
          composerIcon?: string;
        };
      };
    };
  };
  const mcpText = await readFile(new URL("mcp.json", pluginRoot), "utf8");
  const mcp = JSON.parse(mcpText) as {
    mcpServers?: { "pet-dispatcher"?: { type?: string; url?: string; bearer_token_env_var?: string } };
  };
  const skill = await readFile(new URL("skills/confined-repo-work/SKILL.md", pluginRoot), "utf8");
  const golden = JSON.parse(await readFile(new URL("golden-prompts.json", pluginRoot), "utf8")) as {
    cases?: Array<{ kind?: string; expectedTool?: string | null }>;
  };
  const icon = await readFile(new URL("assets/icon.png", pluginRoot));
  const marketplace = JSON.parse(
    await readFile(new URL(".agents/plugins/marketplace.json", repoRoot), "utf8"),
  ) as {
    plugins?: Array<{ name?: string; source?: { path?: string }; category?: string }>;
  };

  assert.equal(plugin.name, "pet-dispatcher");
  assert.equal(plugin.version, "0.1.1");
  assert.match(plugin.homepage ?? "", /mcp\/pet-dispatcher\/plugin$/u);
  assert.equal(plugin.extensions?.["com.openai"]?.interface?.category, "Developer Tools");
  assert.deepEqual(plugin.extensions?.["com.openai"]?.interface?.capabilities, ["Read", "Write"]);
  assert.equal(plugin.extensions?.["com.openai"]?.interface?.logo, "./assets/icon.png");
  assert.equal(plugin.extensions?.["com.openai"]?.interface?.composerIcon, "./assets/icon.png");
  assert.ok(icon.length > 0);

  assert.equal(mcp.mcpServers?.["pet-dispatcher"]?.type, "streamable-http");
  assert.equal(mcp.mcpServers?.["pet-dispatcher"]?.url, "https://pet-dispatcher-control.travny.workers.dev/mcp");
  assert.equal(mcp.mcpServers?.["pet-dispatcher"]?.bearer_token_env_var, "PET_DISPATCHER_CONTROL_TOKEN");
  assert.equal(/MCP_CONNECTOR_TOKEN|CONTROL_PLANE_TOKEN|\/mcp\/[A-Za-z0-9_-]{20,}/u.test(mcpText), false);

  for (const tool of ["pet_workspace_inspect", "pet_read_files", "pet_delegate", "pet_task_get", "pet_session_finish"]) {
    assert.ok(skill.includes("`" + tool + "`"));
  }
  const kinds = new Set((golden.cases ?? []).map((entry) => entry.kind));
  assert.deepEqual([...kinds].sort(), ["direct", "indirect", "negative"]);
  assert.ok((golden.cases ?? []).some((entry) => entry.expectedTool === null));

  const entry = marketplace.plugins?.find((item) => item.name === "pet-dispatcher");
  assert.equal(entry?.source?.path, "./mcp/pet-dispatcher/plugin");
  assert.equal(entry?.category, "Developer Tools");
});
