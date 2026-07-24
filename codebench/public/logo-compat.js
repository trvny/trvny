"use strict";

(() => {
  const originalQrOptions = window.qrOptions;
  const originalRenderQR = window.renderQR;
  const fileInput = document.querySelector("#qLogo");
  const removeButton = document.querySelector("#qLogoRemove");
  if (typeof originalQrOptions !== "function" || typeof originalRenderQR !== "function" || !fileInput) return;

  let remoteLogoData = null;
  let requestGeneration = 0;

  const field = document.createElement("label");
  field.className = "f";
  field.style.marginTop = "12px";
  field.innerHTML = '<span>Logo URL <small>(HTTPS, CORS required)</small></span>'
    + '<div class="btn-row"><input type="url" id="qLogoUrl" placeholder="https://example.com/logo.png" style="flex:1;min-width:0">'
    + '<button type="button" class="btn ghost" id="qLogoUrlLoad">Load URL</button></div>'
    + '<p class="hint" id="qLogoUrlStatus" style="margin:6px 0 0">Fetched directly by your browser.</p>';
  fileInput.insertAdjacentElement("afterend", field);

  const urlInput = document.querySelector("#qLogoUrl");
  const loadButton = document.querySelector("#qLogoUrlLoad");
  const status = document.querySelector("#qLogoUrlStatus");
  const originalRemove = removeButton?.onclick;
  const defaultStatus = "Fetched directly by your browser.";

  function setStatus(message, error = false) {
    status.textContent = message;
    status.className = error ? "err" : "hint";
    status.style.margin = "6px 0 0";
  }

  function clearRemote(clearInput = true) {
    requestGeneration += 1;
    remoteLogoData = null;
    loadButton.disabled = false;
    if (clearInput) urlInput.value = "";
    setStatus(defaultStatus);
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Couldn't read the image."));
      reader.readAsDataURL(blob);
    });
  }

  function normalizeImageBlob(blob, url) {
    if (blob.size > 10 * 1024 * 1024) throw new Error("The image is over 10 MB.");
    if (blob.type.startsWith("image/")) return blob;
    const extension = new URL(url).pathname.split(".").pop()?.toLowerCase();
    const mime = {
      svg: "image/svg+xml",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      avif: "image/avif",
    }[extension];
    if (!mime) throw new Error("The URL didn't return a supported image.");
    return blob.slice(0, blob.size, mime);
  }

  async function loadRemoteLogo() {
    const value = urlInput.value.trim();
    if (!value) {
      clearRemote(false);
      originalRenderQR();
      if (removeButton && !fileInput.files.length) removeButton.style.display = "none";
      return;
    }

    let url;
    try {
      url = new URL(value);
      if (url.protocol !== "https:") throw new Error();
    } catch {
      setStatus("Enter a valid HTTPS image URL.", true);
      return;
    }

    remoteLogoData = null;
    if (typeof originalRemove === "function") originalRemove.call(removeButton);
    const generation = ++requestGeneration;
    loadButton.disabled = true;
    setStatus("Loading image…");

    try {
      const response = await fetch(url.href, {
        mode: "cors",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      if (!response.ok) throw new Error(`Image server returned ${response.status}.`);
      const blob = normalizeImageBlob(await response.blob(), url.href);
      const dataUrl = await blobToDataUrl(blob);
      if (generation !== requestGeneration) return;
      remoteLogoData = dataUrl;
      if (removeButton) removeButton.style.display = "";
      setStatus("Remote logo loaded.");
      originalRenderQR();
    } catch (error) {
      if (generation !== requestGeneration) return;
      remoteLogoData = null;
      if (removeButton) removeButton.style.display = "none";
      setStatus(`${error.message || "Couldn't load the image."} Remote images must allow CORS.`, true);
      originalRenderQR();
    } finally {
      if (generation === requestGeneration) loadButton.disabled = false;
    }
  }

  window.qrOptions = function logoQrOptions() {
    const options = originalQrOptions();
    if (remoteLogoData) {
      options.image = remoteLogoData;
      options.imageOptions = {
        margin: 4,
        imageSize: Number(document.querySelector("#qLogoSize")?.value) || 0.3,
        hideBackgroundDots: Boolean(document.querySelector("#qLogoClear")?.checked),
        saveAsBlob: false,
      };
    } else if (typeof options.image === "string" && options.image.startsWith("data:") && options.imageOptions) {
      options.imageOptions.saveAsBlob = false;
      delete options.imageOptions.crossOrigin;
    }
    return options;
  };

  loadButton.addEventListener("click", loadRemoteLogo);
  urlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadRemoteLogo();
    }
  });
  fileInput.addEventListener("change", () => clearRemote());

  if (removeButton) {
    removeButton.onclick = (event) => {
      if (typeof originalRemove === "function") originalRemove.call(removeButton, event);
      clearRemote();
      originalRenderQR();
    };
  }
})();
