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
  assert.equal(digestEmbed('https://www.youtube.com/watch?v=M7lc1UVf-VE&autoplay=1').src,
    'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE');
  assert.equal(digestEmbed('https://youtu.be/M7lc1UVf-VE').provider, 'YouTube');
  assert.equal(digestEmbed('https://vimeo.com/76979871').provider, 'Vimeo');
  assert.equal(digestEmbed('https://www.tiktok.com/@scout2015/video/6718335390845095173').format, 'portrait');
  assert.equal(digestEmbed('https://open.spotify.com/episode/7makk4oTQel546B0PZlDM5').format, 'audio');
  for (const url of ['https://youtube.com.evil.test/watch?v=M7lc1UVf-VE', 'https://www.youtube.com:444/watch?v=M7lc1UVf-VE', 'https://youtu.be/not-an-id', 'https://www.youtube.com/watch?v=%3Cscript%3E', 'https://example.org/embed', 'https://www.tiktok.com/@x/video/1234/anything', 'javascript:alert(1)']) {
    assert.equal(digestEmbed(url), null, url);
  }
});
