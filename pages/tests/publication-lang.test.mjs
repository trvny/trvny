import test from "node:test";
import assert from "node:assert/strict";
import { publicationLang } from "../functions/_shared/publication-lang.js";

test("publication language attributes use safe explicit metadata", () => {
  for (const lang of ["pl", "zh-CN", "zh-Hans-CN", "es-419", "en", "ru"]) assert.equal(publicationLang(lang), lang);
  for (const lang of [undefined, null, "", 'en" onclick="bad', "English", 1]) assert.equal(publicationLang(lang), "und");
});
