const form = document.querySelector("#streamForm");
const input = document.querySelector("#streamUrl");
const hint = document.querySelector("#streamHint");
let replaying = false;

function safeUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function isBundled(url) {
  return window.streambenchBundledUrls instanceof Set
    && window.streambenchBundledUrls.has(url.href);
}

function shouldRelay(url) {
  return isBundled(url)
    && (url.protocol === "http:" || /\.m3u8(?:$|[?#])/i.test(url.href));
}

form?.addEventListener("submit", (event) => {
  if (replaying) return;
  const original = safeUrl(input?.value);
  if (!original || !shouldRelay(original)) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  const relay = new URL("/api/relay", location.origin);
  relay.searchParams.set("url", original.href);
  if (/\.m3u8(?:$|[?#])/i.test(original.href)) relay.hash = "streambench.m3u8";

  input.value = relay.href;
  replaying = true;
  form.requestSubmit();
  replaying = false;
  input.value = original.href;
  queueMicrotask(() => {
    if (hint) hint.textContent = "Stream przechodzi przez ograniczony przekaźnik Streambencha, aby ominąć mixed content lub CORS HLS.";
  });
}, true);
