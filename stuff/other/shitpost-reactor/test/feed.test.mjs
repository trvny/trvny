import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderAtom, renderJsonFeed, renderRss, validateOidcClaims, validateRecord } from '../worker.mjs';

const post = {
  id: 'gh-123-1',
  generated_at: '2026-10-01T18:00:00.000Z',
  published_at: '2026-10-01T18:01:00.000Z',
  url: 'https://shitpost.trfny.com/posts/gh-123-1',
  provider: 'openrouter',
  model: 'free-model',
  skill: { source: 'https://example.test/skill.zip', sha256: 'abc' },
  topic: null,
  schema_version: 1,
  meme: {
    dialect: 'dzida-core',
    format: 'fake-ui',
    caption: 'deploy <przeszedł> & aplikacja nie',
    visual: 'okno błędu',
    alt_text: 'okno błędu',
  },
};

test('RSS 2.0 exposes self link, stable permalink and escaped content', () => {
  const rss = renderRss([post]);
  assert.match(rss, /<rss version="2\.0"/);
  assert.match(rss, /rel="self" type="application\/rss\+xml"/);
  assert.match(rss, /<guid isPermaLink="true">https:\/\/shitpost\.trfny\.com\/posts\/gh-123-1<\/guid>/);
  assert.match(rss, /deploy &lt;przeszedł&gt; &amp; aplikacja nie/);
});

test('Atom 1.0 exposes self link and stable entry id', () => {
  const atom = renderAtom([post]);
  assert.match(atom, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom"/);
  assert.match(atom, /rel="self" type="application\/atom\+xml"/);
  assert.match(atom, /<id>https:\/\/shitpost\.trfny\.com\/posts\/gh-123-1<\/id>/);
});

test('JSON Feed 1.1 mirrors the same canonical entry URL', () => {
  const feed = JSON.parse(renderJsonFeed([post]));
  assert.equal(feed.version, 'https://jsonfeed.org/version/1.1');
  assert.equal(feed.items[0].id, post.url);
  assert.equal(feed.items[0].url, post.url);
});

test('validateRecord rebuilds the accepted publication shape', () => {
  const record = validateRecord(post);
  assert.equal(record.meme.format, 'fake-ui');
  assert.equal(record.generated_at, '2026-10-01T18:00:00.000Z');
  assert.equal('id' in record, false);
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
