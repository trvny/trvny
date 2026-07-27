const fileInput = document.querySelector("#playlistFile");

fileInput.addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  if (!file) return;

  const readText = file.text.bind(file);
  let sourcePromise;
  try {
    Object.defineProperty(file, "text", {
      configurable: true,
      value: () => {
        sourcePromise ||= readText();
        return sourcePromise;
      },
    });
  } catch {
    // Keep the native reader when the file object is not extensible.
  }
}, true);
