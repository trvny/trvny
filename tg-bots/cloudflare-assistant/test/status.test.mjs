import assert from "node:assert/strict";
import test from "node:test";

import { formatProviderStatus } from "../src/status.ts";

test("renders provider status as plain text and safe rich HTML", () => {
  const view = formatProviderStatus({
    available: 1,
    configured: 2,
    providers: [
      { provider: "orcarouter", configured: true, available: true },
      {
        provider: "custom<router>",
        configured: true,
        available: false,
        cooldown: { category: "quota&limit" },
      },
    ],
  }, true, "@cf/model<safe>");

  assert.match(view.plain, /OrcaRouter/);
  assert.match(view.richHtml, /<table>/);
  assert.match(view.richHtml, /<details>/);
  assert.doesNotMatch(view.richHtml, /custom<router>/);
  assert.match(view.richHtml, /custom&lt;router&gt;/);
  assert.match(view.richHtml, /quota&amp;limit/);
  assert.match(view.richHtml, /@cf\/model&lt;safe&gt;/);
});

test("renders an unavailable state when the router is not configured", () => {
  const view = formatProviderStatus(null, false, "@cf/fallback");
  assert.match(view.plain, /router token not configured/);
  assert.match(view.richHtml, /router token not configured/);
});
