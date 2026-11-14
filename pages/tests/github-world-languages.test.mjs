import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../site/teksty/githubowa-kraina/', import.meta.url);
const script = await readFile(new URL('explore.js', root), 'utf8');
const atlas = JSON.parse(await readFile(new URL('atlas.json', root), 'utf8'));
const locales = JSON.parse(await readFile(new URL('locales.json', root), 'utf8'));

function createPage(savedLanguage = null) {
  class Element {
    constructor(tag = 'div') {
      this.tag = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {};
      this.textContent = ''; this.open = false;
    }
    setAttribute(name, value) { this.attrs[name] = value; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
    async fire(type, event = {}) { for (const listener of this.listeners[type] || []) await listener(event); }
    querySelectorAll(selector) { return selector === 'button' ? this.children.filter(child => child.tag === 'button') : []; }
    querySelector() { return null; }
    focus() {}
    showModal() { this.open = true; }
    close() { this.open = false; void this.fire('close'); }
  }
  const elements = new Map();
  const get = selector => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  };
  const dialog = get('#atlas-dialog');
  const close = new Element('button');
  dialog.querySelector = selector => selector === '.dialog-close' ? close : null;
  const buttons = ['pl', 'en', 'ru', 'zh'].map(language => {
    const button = new Element('button'); button.dataset.language = language; return button;
  });
  const cards = atlas.regions.map(region => {
    const card = new Element('a'); card.dataset.region = region.id; card.href = region.url;
    const content = new Map([['.region-kicker', new Element()], ['p', new Element()], ['.tagline', new Element()]]);
    card.querySelector = selector => content.get(selector) || null;
    return card;
  });
  const storage = new Map(savedLanguage ? [['github-world-language', savedLanguage]] : []);
  const document = {
    documentElement: {},
    querySelector: get,
    querySelectorAll: selector => ({
      '[data-language]': buttons,
      '[data-region]': cards,
      '.atlas .region': cards.slice(0, 6),
      '.explore-hint': cards.flatMap(card => card.children.filter(child => child.className === 'explore-hint')),
      '.trvny-nav-label': [],
    })[selector] || [],
    createElement: tag => new Element(tag),
  };
  const context = vm.createContext({
    document, Node: { TEXT_NODE: 3 }, navigator: { language: 'pl-PL' },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    fetch: async url => ({ ok: true, json: async () => url.endsWith('locales.json') ? locales : atlas }),
    console, Math,
  });
  vm.runInContext(script, context);
  return { document, get, buttons, cards, dialog, storage };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('language switching updates page, open atlas and stored preference', async () => {
  const page = createPage();
  await tick();
  assert.equal(page.get('#hero-heading').textContent, locales.pl.heading);
  await page.buttons[3].fire('click');
  assert.equal(page.document.documentElement.lang, 'zh-Hans');
  assert.equal(page.get('#hero-heading').textContent, locales.zh.heading);
  assert.equal(page.storage.get('github-world-language'), 'zh');
  assert.equal(page.buttons[3].attrs['aria-pressed'], 'true');
  await page.cards[0].fire('click', { button: 0, preventDefault() {} });
  const body = page.get('#dialog-content');
  assert.equal(body.children[0].textContent, atlas.regions[0].translations.zh.description);
  const itemButton = body.children[1].children[0];
  assert.equal(itemButton.textContent, atlas.regions[0].items[0].translations.zh.name);
  await itemButton.fire('click');
  assert.equal(body.children[0].textContent, atlas.regions[0].items[0].translations.zh.description);
  await page.buttons[2].fire('click');
  assert.equal(body.children[0].textContent, atlas.regions[0].items[0].translations.ru.description);
  assert.equal(body.children[1].children[1].href, atlas.regions[0].items[0].url);
  const restored = createPage('en');
  await tick();
  assert.equal(restored.document.documentElement.lang, 'en');
  assert.equal(restored.get('#hero-heading').textContent, locales.en.heading);
});
