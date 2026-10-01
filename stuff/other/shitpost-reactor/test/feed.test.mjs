import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderAtom, renderJsonFeed, renderRss, validateOidcClaims, validateRecord } from '../worker.mjs';

const textPost = {
  id: 'gh-123-1',
  generated_at: '2026-10-01T18:00:00.000Z',
  published_at: '2026-10-01T18:01:00.000Z',
  url: 'https://shitpost.trfny.com/posts/gh-123-1',
  provider: 'openrouter',
  model: 'free-model',
  skill: { source: 'https://example.test/skill.zip', sha256: 'abc' },
  topic: null,
  schema_version: 2,
  content: { kind: 'text', text: 'deploy <przeszedł> & aplikacja nie' },
};

const memePost = {
  ...textPost,
  id: 'gh-124-1',
  url: 'https://shitpost.trfny.com/posts/gh-124-1',
  content: {
    kind: 'meme',
    template: 'bihw',
    top_text: 'it ain’t much',
    bottom_text: 'ale pipeline zielony',
  },
};

test('RSS exposes stable permalink and escaped text content', () => {
  const rss = renderRss([textPost]);
  assert.match(rss, /<rss version="2\.0"/);
  assert.match(rss, /rel="self" type="application\/rss\+xml"/);
  assert.match(rss, /<guid isPermaLink="true">https:\/\/shitpost\.trfny\.com\/posts\/gh-123-1<\/guid>/);
  assert.match(rss, /deploy &lt;przeszedł&gt; &amp; aplikacja nie/);
  assert.match(rss, /<category>text<\/category>/);
});

test('Atom exposes self link and stable entry id', () => {
  const atom = renderAtom([textPost]);
  assert.match(atom, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom"/);
  assert.match(atom, /rel="self" type="application\/atom\+xml"/);
  assert.match(atom, /<id>https:\/\/shitpost\.trfny\.com\/posts\/gh-123-1<\/id>/);
});

test('JSON Feed exposes a rendered image only for meme entries', () => {
  const feed = JSON.parse(renderJsonFeed([textPost, memePost]));
  assert.equal(feed.version, 'https://jsonfeed.org/version/1.1');
  assert.equal(feed.items[0].id, textPost.url);
  assert.ok(!('image' in feed.items[0]));
  assert.match(feed.items[1].image, /^https:\/\/api\.memegen\.link\/images\/bihw\//);
  assert.deepEqual(feed.items[1].tags, ['meme']);
});

test('validateRecord accepts schema v2 text and meme shapes', () => {
  const text = validateRecord(textPost);
  const meme = validateRecord(memePost);
  assert.equal(text.content.text, textPost.content.text);
  assert.equal(meme.content.template, 'bihw');
  assert.equal('id' in text, false);
});

test('validateRecord keeps schema v1 readable for already-published posts', () => {
  const legacy = validateRecord({
    ...textPost,
    schema_version: 1,
    content: undefined,
    meme: {
      dialect: 'dzida-core',
      format: 'fake-ui',
      caption: 'stary wpis',
      visual: 'okno błędu',
      alt_text: 'okno błędu',
    },
  });
  assert.equal(legacy.meme.caption, 'stary wpis');
});

test('validateRecord rejects an unknown meme template', () => {
  assert.throws(() => validateRecord({
    ...memePost,
    content: { ...memePost.content, template: 'invented-template' },
  }), /invalid_meme_template/);
});

test('OIDC claims are pinned to this repo, workflow and main branch', () => {
  const now = 1_800_000_000;
  const claims = validateOidcClaims({
    iss: 'https://token.actions.githubusercontent.com',
    aud: 'https://shitpost.trfny.com',
    repository: 'trvny/trvny',
    ref: 'refs/heads/main',
    workflow_ref: 'trvny/trvny/.github/workflows/shitpost-reactor.yml@refs/heads/main',
    event_name: 'schedule',
    runner_environment: 'github-hosted',
    run_id: '123',
    run_attempt: '1',
    exp: now + 300,
    nbf: now - 10,
    iat: now - 10,
  }, now);
  assert.equal(claims.run_id, '123');
});

test('OIDC validation rejects a different repository', () => {
  const now = 1_800_000_000;
  assert.throws(() => validateOidcClaims({
    iss: 'https://token.actions.githubusercontent.com',
    aud: 'https://shitpost.trfny.com',
    repository: 'evil/fork',
    ref: 'refs/heads/main',
    workflow_ref: 'trvny/trvny/.github/workflows/shitpost-reactor.yml@refs/heads/main',
    event_name: 'schedule',
    runner_environment: 'github-hosted',
    run_id: '123',
    run_attempt: '1',
    exp: now + 300,
  }, now), /oidc_invalid_repository/);
});

test('a meme post with a retired template degrades to text instead of failing the feed', () => {
  const retired = { ...memePost, id: 'gh-125-1', content: { ...memePost.content, template: 'retired-template' } };
  const feed = JSON.parse(renderJsonFeed([textPost, retired]));
  assert.equal(feed.items.length, 2);
  assert.ok(!('image' in feed.items[1]));
  assert.match(renderRss([retired]), /<rss version="2\.0"/);
  assert.match(renderAtom([retired]), /<feed /);
});
