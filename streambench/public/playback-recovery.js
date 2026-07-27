const RECOVERABLE_HLS_ERROR = /(?:manifest|level|frag|key)Load(?:Error|TimeOut)/i;
const MAX_RETRIES = 2;

export function isRecoverableHlsError(message, state = "error") {
  return state === "error" && RECOVERABLE_HLS_ERROR.test(String(message || ""));
}

if (typeof document !== "undefined") {
  const form = document.querySelector("#streamForm");
  const input = document.querySelector("#streamUrl");
  const status = document.querySelector("#status");
  const hint = document.querySelector("#streamHint");
  const diagnosticError = document.querySelector("#diagnosticError");
  const media = [document.querySelector("#videoPlayer"), document.querySelector("#audioPlayer")]
    .filter(Boolean);

  let attempts = 0;
  let retryTimer = null;
  let retrySubmit = false;
  let source = "";

  function clearRetry() {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  }

  function reset() {
    clearRetry();
    attempts = 0;
    source = input?.value || "";
  }

  form?.addEventListener("submit", () => {
    if (retrySubmit) {
      retrySubmit = false;
      return;
    }
    reset();
  }, true);

  for (const element of media) element.addEventListener("playing", reset);

  if (diagnosticError && status && form && input) {
    new MutationObserver(() => {
      const message = diagnosticError.textContent || "";
      if (!isRecoverableHlsError(message, status.dataset.state)) return;

      const current = input.value;
      if (current !== source) {
        clearRetry();
        attempts = 0;
        source = current;
      }
      if (retryTimer !== null) return;
      if (attempts >= MAX_RETRIES) {
        if (hint) hint.textContent = "HLS nie ruszył po dwóch próbach. Źródło może blokować przeglądarkę przez CORS, wygasło albo jest offline.";
        return;
      }

      attempts += 1;
      status.textContent = `Ponawianie ${attempts}/${MAX_RETRIES}`;
      status.dataset.state = "loading";
      if (hint) hint.textContent = "Ponawiam pobranie stabilnego adresu HLS.";

      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (input.value !== source) return;
        retrySubmit = true;
        form.requestSubmit();
      }, attempts * 700);
    }).observe(diagnosticError, { childList: true, subtree: true });
  }
}
