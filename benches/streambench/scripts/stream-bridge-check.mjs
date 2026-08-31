import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isRecoverableHlsError } from "../public/playback-recovery.js";
import { parseProviderRelays } from "../public/provider-relay.js";
import { relayTarget } from "../public/stream-bridge.js";

const origin = "https://streambench.example";
const httpRadio = "http://radio.example/live.mp3?token=abc";
const hls = "https://video.example/live/master.m3u8?token=abc";
const httpsAudio = "https://radio.example/live.mp3";
const bundledUrls = new Set([httpRadio, hls, httpsAudio]);

const radioRelay = relayTarget(httpRadio, { origin, bundledUrls });
assert.equal(radioRelay?.origin, origin);
assert.equal(radioRelay?.pathname, "/api/relay");
assert.equal(radioRelay?.searchParams.get("url"), httpRadio);
assert.equal(radioRelay?.hash, "#streambench.mp3");

const hlsRelay = relayTarget(hls, { origin, bundledUrls });
assert.equal(hlsRelay?.searchParams.get("url"), hls);
assert.equal(hlsRelay?.hash, "#streambench.m3u8");

const providerSource = "http://provider.example/live/master.m3u8";
const providerRelay = `${origin}/api/relay?url=${encodeURIComponent(providerSource)}&sig=${"a".repeat(43)}#streambench.m3u8`;
const providerRelays = parseProviderRelays(
  `#EXTM3U\n#EXTINF:-1 streambench-relay="${providerRelay}",Provider\n${providerSource}\n`,
  origin,
);
const signedRelay = relayTarget(providerSource, { origin, bundledUrls, providerRelays });
assert.equal(signedRelay?.href, providerRelay);

assert.equal(relayTarget(httpsAudio, { origin, bundledUrls }), null);
assert.equal(relayTarget("http://other.example/live.mp3", { origin, bundledUrls }), null);
assert.equal(relayTarget("not a url", { origin, bundledUrls }), null);

assert.equal(isRecoverableHlsError("HLS: manifestLoadError"), true);
assert.equal(isRecoverableHlsError("HLS: fragLoadTimeOut"), true);
assert.equal(isRecoverableHlsError("HLS: bufferAppendError"), false);
assert.equal(isRecoverableHlsError("HLS: manifestLoadError", "loading"), false);

const [appSource, workspaceSource, bridgeSource] = await Promise.all([
  readFile(new URL("../client/app.ts", import.meta.url), "utf8"),
  readFile(new URL("../client/playlist-workspace.ts", import.meta.url), "utf8"),
  readFile(new URL("../client/stream-bridge.ts", import.meta.url), "utf8"),
]);
assert.match(appSource, /import "\.\/stream-bridge\.js";/);
const playbackStart = appSource.indexOf("async function startPlaylistPlayback");
const playbackEnd = appSource.indexOf("function stopStreamPlayback", playbackStart);
assert.ok(playbackStart >= 0 && playbackEnd > playbackStart);
const webmcpPlayback = appSource.slice(playbackStart, playbackEnd);
assert.match(webmcpPlayback, /action\.click\(\)/);
assert.doesNotMatch(webmcpPlayback, /\bplayStream\s*\(\s*item\.url\b/);
assert.match(appSource, /streambenchPlaylistIndex/);
assert.match(workspaceSource, /StreambenchWorkspace/);
assert.match(bridgeSource, /streambenchPreserveSelection/);

console.log("stream bridge checks passed");
