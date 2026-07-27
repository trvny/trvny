export function relayTarget(rawUrl, {
  origin = "https://streambench.invalid",
  bundledUrls = new Set(),
} = {}) {
  let source;
  try {
    source = new URL(String(rawUrl || "").trim());
  } catch {
    return null;
  }

  if (!["http:", "https:"].includes(source.protocol)) return null;
  if (!(bundledUrls instanceof Set) || !bundledUrls.has(source.href)) return null;

  const hls = /\.m3u8$/i.test(source.pathname);
  if (source.protocol !== "http:" && !hls) return null;

  const relay = new URL("/api/relay", origin);
  relay.searchParams.set("url", source.href);
  const extension = source.pathname.match(/\.(m3u8|mp3|aac|m4a|ogg|opus|flac)$/i)?.[0];
  if (extension) relay.hash = `streambench${extension.toLowerCase()}`;
  return relay;
}

if (typeof document !== "undefined") {
  const form = document.querySelector("#streamForm");
  const input = document.querySelector("#streamUrl");
  const hint = document.querySelector("#streamHint");
  const title = document.querySelector("#nowPlaying");
  const entries = document.querySelector("#playlistEntries");

  const browserRelay = (value) => relayTarget(value, {
    origin: location.origin,
    bundledUrls: window.streambenchBundledUrls,
  });

  form?.addEventListener("submit", () => {
    const original = input?.value;
    const relay = browserRelay(original);
    if (!relay || !input) return;

    input.value = relay.href;
    queueMicrotask(() => {
      if (input.value === relay.href) input.value = original;
      if (hint) {
        hint.textContent = "Stream przechodzi przez ograniczony przekaźnik Streambencha, aby ominąć mixed content lub CORS HLS.";
      }
    });
  }, true);

  document.addEventListener("click", (event) => {
    const action = event.target.closest?.("#playlistEntries .entry-action");
    if (!action || !form || !input) return;

    queueMicrotask(() => {
      const original = input.value;
      const relay = browserRelay(original);
      if (!relay) return;

      const selectedTitle = title?.textContent || "";
      input.value = relay.href;
      form.requestSubmit();
      input.value = original;

      entries?.querySelectorAll('[aria-current="true"]').forEach((entry) => {
        entry.removeAttribute("aria-current");
      });
      action.setAttribute("aria-current", "true");
      if (title && selectedTitle) title.textContent = selectedTitle;
      window.dispatchEvent(new CustomEvent("streambench:channel", {
        detail: { title: selectedTitle },
      }));
      if (hint) {
        hint.textContent = "Stream przechodzi przez ograniczony przekaźnik Streambencha, aby ominąć mixed content lub CORS HLS.";
      }
    });
  });
}
