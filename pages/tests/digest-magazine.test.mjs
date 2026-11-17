import test from 'node:test';
import assert from 'node:assert/strict';
import { isHttpsUrl, isDigestMediaUrl, chartMax, digestEmbed } from '../astro/src/lib/digest-magazine.mjs';

test('digest links reject unsafe protocols, credentials and ambiguous paths', () => {
  for (const value of ['http://example.org', 'javascript:alert(1)', '//example.org/a', 'https://user:pass@example.org', 'https://example.org\\a', 'https://example.org/a b']) {
    assert.equal(isHttpsUrl(value), false, value);
  }
  assert.equal(isHttpsUrl('https://example.org/story?q=1'), true);
});

test('digest media allows dedicated assets and HTTPS only', () => {
  assert.equal(isDigestMediaUrl('/przeglad/assets/meme.svg'), true);
  assert.equal(isDigestMediaUrl('https://example.org/clip.mp4'), true);
  assert.equal(isDigestMediaUrl('/assets/digest/meme.svg'), false);
  for (const value of ['/przeglad/assets/../other.svg', '/przeglad/assets/%2e%2e.svg', '/przeglad/assets/a.html', 'data:image/svg+xml,x', '//example.org/a.png']) {
    assert.equal(isDigestMediaUrl(value), false, value);
  }
});

test('chart has nonzero scale even for all-zero data', () => {
  assert.equal(chartMax([{ value: 0 }]), 1);
  assert.equal(chartMax([{ value: 2 }, { value: 10 }]), 10);
});

test('official source links produce restricted player URLs', () => {
  const youtube = { provider: 'YouTube', src: 'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE', format: 'wide' };
  assert.deepEqual(digestEmbed('https://www.youtube.com/watch?v=M7lc1UVf-VE&autoplay=1'), youtube);
  assert.deepEqual(digestEmbed('https://youtu.be/M7lc1UVf-VE'), youtube);
  assert.deepEqual(digestEmbed('https://vimeo.com/76979871?autoplay=1'), {
    provider: 'Vimeo', src: 'https://player.vimeo.com/video/76979871?autoplay=0&dnt=1', format: 'wide',
  });
  assert.deepEqual(digestEmbed('https://www.tiktok.com/@scout2015/video/6718335390845095173'), {
    provider: 'TikTok', src: 'https://www.tiktok.com/player/v1/6718335390845095173?autoplay=0&description=1', format: 'portrait',
  });
  assert.deepEqual(digestEmbed('https://open.spotify.com/episode/7makk4oTQel546B0PZlDM5'), {
    provider: 'Spotify', src: 'https://open.spotify.com/embed/episode/7makk4oTQel546B0PZlDM5', format: 'audio',
  });
  for (const url of ['https://youtube.com.evil.test/watch?v=M7lc1UVf-VE', 'https://www.youtube.com:444/watch?v=M7lc1UVf-VE', 'https://youtu.be/not-an-id', 'https://www.youtube.com/watch?v=%3Cscript%3E', 'https://example.org/embed', 'https://www.tiktok.com/@x/video/1234/anything', 'javascript:alert(1)']) {
    assert.equal(digestEmbed(url), null, url);
  }
});
