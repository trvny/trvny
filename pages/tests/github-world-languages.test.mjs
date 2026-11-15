import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { setImmediate } from 'node:timers';

const root = new URL('../site/teksty/githubowa-kraina/', import.meta.url);
const script = await readFile(new URL('explore.js', root), 'utf8');
const atlas = JSON.parse(await readFile(new URL('atlas.json', root), 'utf8'));
const locales = JSON.parse(await readFile(new URL('locales.json', root), 'utf8'));

function createPage(savedLanguage = null, browserLanguages = ['pl-PL'], options = {}) {
  class Element {
    constructor(tag = 'div') {
      this.tag = tag; this.children = []; this.dataset = {}; this.attrs = {}; this.listeners = {};
      this.textContent = ''; this.open = false;
    }
    setAttribute(name, value) { this.attrs[name] = value; }
    getAttribute(name) { return this.attrs[name]; }
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
  get('#atlas-schema').textContent = JSON.stringify({ name: 'GitHubowa Kraina', url: 'canonical' });
  const navGroups = ['/', 'https://weather.travny.workers.dev/', '/lab/', '/teksty/'].map(href => {
    const group = new Element();
    const label = new Element();
    const anchor = new Element('a');
    anchor.setAttribute('href', href);
    group.querySelector = selector => selector === 'a' ? anchor : label;
    return group;
  });
  const dialog = get('#atlas-dialog');
  const close = new Element('button');
  dialog.querySelector = selector => selector === '.dialog-close' ? close : null;
  const buttons = ['pl', 'en', 'ru', 'zh', 'pl', 'en', 'ru', 'zh'].map(language => {
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
      '.trvny-nav-group': navGroups,
    })[selector] || [],
    createElement: tag => new Element(tag),
  };
  const context = vm.createContext({
    document, Node: { TEXT_NODE: 3 }, navigator: { language: browserLanguages[0], languages: browserLanguages },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    fetch: async url => {
      const localeRequest = url.endsWith('locales.json');
      if (!localeRequest && options.atlasGate) await options.atlasGate;
      return { ok: localeRequest ? !options.failLocales : !options.failAtlas, json: async () => localeRequest ? locales : atlas };
    },
    console, Math, crypto: options.crypto,
  });
  vm.runInContext(script, context);
  return { document, get, buttons, cards, dialog, storage, navGroups };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('language switching updates page, open atlas and stored preference', async () => {
  const page = createPage();
  await tick();
  assert.equal(page.get('#hero-heading').textContent, locales.pl.heading);
  await page.buttons[3].fire('click');
  assert.equal(page.document.documentElement.lang, 'zh-Hans');
  assert.equal(page.get('#hero-heading').textContent, locales.zh.heading);
  assert.equal(page.get('.lede').textContent, locales.zh.lede);
  assert.equal(page.get('.hero-actions a:nth-child(3)').textContent, locales.zh.infrastructure);
  assert.equal(page.get('#lore').textContent, locales.zh.lore[0]);
  assert.equal(page.cards[0].querySelector('.region-kicker').textContent, locales.zh.cards.feedseek[0]);
  assert.equal(page.cards[0].querySelector('p').textContent, locales.zh.cards.feedseek[1]);
  assert.equal(page.cards[0].querySelector('.tagline').textContent, locales.zh.tags.feedseek);
  assert.equal(page.navGroups[1].querySelector('.trvny-nav-label').textContent, locales.zh.nav[4]);
  assert.equal(page.get('#trvny-nav-toggle').attrs['aria-label'], locales.zh.nav[0]);
  assert.equal(page.document.title, locales.zh.pageName + ' · TRAVNY');
  assert.equal(page.get('meta[property="og:locale"]').attrs.content, 'zh_CN');
  assert.equal(JSON.parse(page.get('#atlas-schema').textContent).inLanguage, 'zh-Hans');
  assert.equal(page.storage.get('github-world-language'), 'zh');
  assert.equal(page.buttons[3].attrs['aria-pressed'], 'true');
  await page.cards[0].fire('click', { button: 0, preventDefault() {} });
  const body = page.get('#dialog-content');
  assert.equal(body.children[0].textContent, atlas.regions[0].translations.zh.description);
  const itemButton = body.children[1].children[0];
  assert.equal(itemButton.textContent, atlas.regions[0].items[0].translations.zh.name);
  await itemButton.fire('click');
  assert.equal(body.children[0].textContent, atlas.regions[0].items[0].translations.zh.description);
  await page.buttons[6].fire('click');
  assert.equal(page.buttons[2].attrs['aria-pressed'], 'true');
  assert.equal(body.children[0].textContent, atlas.regions[0].items[0].translations.ru.description);
  assert.equal(body.children[1].children[1].href, atlas.regions[0].items[0].url);
  const restored = createPage('en');
  await tick();
  assert.equal(restored.document.documentElement.lang, 'en');
  assert.equal(restored.get('#hero-heading').textContent, locales.en.heading);
});

test('browser preferences select first supported language unless stored', async () => {
  for (const [saved, preferences, expected] of [
    ['invalid', ['de-DE', 'ru-RU'], 'ru'],
    [null, ['en-US'], 'en'],
    [null, ['de-DE'], 'pl'],
    ['zh', ['ru-RU'], 'zh'],
  ]) {
    const page = createPage(saved, preferences);
    await tick();
    assert.equal(page.document.documentElement.lang, expected === 'zh' ? 'zh-Hans' : expected);
    assert.equal(page.get('#hero-heading').textContent, locales[expected].heading);
  }
});

test('pending and unavailable atlas dialog follows language selection', async () => {
  let release;
  const atlasGate = new Promise(resolve => { release = resolve; });
  const page = createPage(null, ['pl'], { atlasGate, failAtlas: true });
  await tick();
  const click = page.cards[0].fire('click', { button: 0, preventDefault() {} });
  await tick();
  await page.buttons[7].fire('click');
  assert.equal(page.get('#dialog-title').textContent, locales.zh.loadingTitle);
  release();
  await click;
  assert.equal(page.get('#dialog-title').textContent, locales.zh.unavailableTitle);
  await page.buttons[6].fire('click');
  assert.equal(page.get('#dialog-title').textContent, locales.ru.unavailableTitle);
  assert.equal(page.get('#dialog-content').children[1].href, atlas.regions[0].url);
});

test('failed locale fetch preserves Polish atlas and all lore entries', async () => {
  const page = createPage(null, ['en'], { failLocales: true });
  await tick();
  assert.ok(page.buttons.every(button => button.disabled));
  for (let i = 1; i <= 5; i += 1) {
    await page.get('#shuffleLore').fire('click');
    assert.equal(page.get('#lore').textContent, locales.pl.lore[i % 5]);
  }
  await page.cards[0].fire('click', { button: 0, preventDefault() {} });
  assert.equal(page.get('#dialog-content').children[0].textContent, atlas.regions[0].translations.pl.description);
});

test('lore draw rejects out-of-range samples and avoids immediate repeats', async () => {
  const crypto = { getRandomValues: bytes => {
    bytes.fill(255);
    bytes[63] = 1;
    return bytes;
  } };
  const page = createPage(null, ['pl'], { crypto });
  await tick();
  await page.get('#shuffleLore').fire('click');
  assert.equal(page.get('#lore').textContent, locales.pl.lore[2]);
  await page.get('#shuffleLore').fire('click');
  assert.equal(page.get('#lore').textContent, locales.pl.lore[1]);
});
