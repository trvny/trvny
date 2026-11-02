import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const decode = (text) => text.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ({
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
})[entity]);

test('Astro pages publish breadcrumb trails matching their canonical paths', async () => {
  const dist = new URL('../astro/dist/', import.meta.url);
  const issues = (await readdir(new URL('przeglad/', dist), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => `przeglad/${entry.name}/`);
  for (const path of ['lab/', 'lab/field-notes/', 'przeglad/', ...issues]) {
    const html = await readFile(new URL(`${path}index.html`, dist), 'utf8');
    const match = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/);
    assert.ok(match, `${path}: missing structured data`);
    const data = JSON.parse(match[1]);
    assert.equal(data['@type'], 'BreadcrumbList');
    const crumbs = data.itemListElement;
    assert.deepEqual(crumbs.map((item) => item.position), crumbs.map((_, i) => i + 1));
    assert.equal(crumbs[0].item, 'https://travny.pages.dev/');
    assert.equal(crumbs.at(-1).item, `https://travny.pages.dev/${path}`);
    const nav = html.match(/<nav class="crumb"[^>]*>(.*?)<\/nav>/)?.[1];
    assert.ok(nav, `${path}: missing visible breadcrumb`);
    const visible = [...nav.matchAll(/<(a|span)\b([^>]*)>([^<]*)<\/(?:a|span)>/g)];
    assert.equal(visible.length, crumbs.length);
    for (const [index, [, tag, attributes, text]] of visible.entries()) {
      assert.equal(decode(text), crumbs[index].name);
      if (index === visible.length - 1) {
        assert.equal(tag, 'span');
        assert.match(attributes, /aria-current="page"/);
      } else {
        assert.equal(tag, 'a');
        const href = attributes.match(/href="([^"]+)"/)?.[1];
        assert.ok(href);
        assert.equal(new URL(decode(href), 'https://travny.pages.dev').href, crumbs[index].item);
      }
    }
  }
});
