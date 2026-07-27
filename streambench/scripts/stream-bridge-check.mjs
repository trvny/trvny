import assert from "node:assert/strict";
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

assert.equal(relayTarget(httpsAudio, { origin, bundledUrls }), null);
assert.equal(relayTarget("http://other.example/live.mp3", { origin, bundledUrls }), null);
assert.equal(relayTarget("not a url", { origin, bundledUrls }), null);

console.log("stream bridge checks passed");
