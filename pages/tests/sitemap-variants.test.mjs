import test from "node:test";
import assert from "node:assert/strict";
import { pruneDigestEntries } from "../scripts/sitemap-variants.mjs";

test("rebuilding drops old digest rows and preserves the remaining XML", () => {
  const archive = "  <url><loc>https://bartek.lol/przeglad/</loc></url>\r\n";
  const stale = "  <url><loc>https://bartek.lol/przeglad/2026-11-23/</loc><lastmod>2026-11-23</lastmod></url>\r\n";
  const alias = "  <url>\r\n    <loc>https://travny.pages.dev/przeglad/2026-11-23/</loc>\r\n  </url>\r\n";
  const retained = "  <url><loc>https://bartek.lol/teksty/?a=1&amp;b=2</loc><lastmod>2026-11-01</lastmod></url>\r\n";
  const expected = "<urlset>\r\n" + archive + retained + "</urlset>\r\n";
  const original = "<urlset>\r\n" + stale + archive + alias + retained + "</urlset>\r\n";
  assert.equal(pruneDigestEntries(original), expected);
  assert.equal(pruneDigestEntries(expected), expected);
});
