import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const svgPath = resolve(here, "../../../assets/pet-dispatcher.svg");
const pngPath = resolve(here, "../../../assets/pet-dispatcher.png");
const modulePath = resolve(here, "../control-plane/icon.ts");

const expected = await sharp(readFileSync(pngPath)).ensureAlpha().raw()
  .toBuffer({ resolveWithObject: true });
const regeneratedPng = await sharp(readFileSync(svgPath), { density: 384 })
  .resize(512, 512)
  .png({ palette: true, compressionLevel: 9, effort: 10 })
  .toBuffer();
const rendered = await sharp(regeneratedPng).ensureAlpha().raw()
  .toBuffer({ resolveWithObject: true });

assert.equal(expected.info.width, 512);
assert.equal(expected.info.height, 512);
assert.deepEqual(
  [rendered.info.width, rendered.info.height, rendered.info.channels],
  [expected.info.width, expected.info.height, expected.info.channels],
);
assert.ok(rendered.data.equals(expected.data), "committed PNG pixels differ from the SVG source");

const moduleText = readFileSync(modulePath, "utf8");
const assignment = moduleText.match(
  /export const ICON_PNG_BASE64 =\s*([\s\S]*?);\s*export const ICON_BYTES/u,
)?.[1];
assert.ok(assignment, "ICON_PNG_BASE64 assignment is missing");
const base64 = [...assignment.matchAll(/"([^"]*)"/gu)].map((match) => match[1]).join("");
const embedded = Buffer.from(base64, "base64");
const committed = readFileSync(pngPath);
assert.ok(embedded.equals(committed), "icon.ts does not embed the committed PNG");

console.log("pet-dispatcher icon source, PNG and embedded payload agree");
