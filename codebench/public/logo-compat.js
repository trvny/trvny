"use strict";

(() => {
  const originalQrOptions = window.qrOptions;
  if (typeof originalQrOptions !== "function") return;

  window.qrOptions = function localLogoQrOptions() {
    const options = originalQrOptions();
    if (typeof options.image === "string" && options.image.startsWith("data:") && options.imageOptions) {
      options.imageOptions.saveAsBlob = false;
      delete options.imageOptions.crossOrigin;
    }
    return options;
  };
})();
