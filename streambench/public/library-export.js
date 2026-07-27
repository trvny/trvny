import { createLocalState } from "./local-state.js";
import { serializeM3u } from "./playlist-format.js";

const library = createLocalState();
const view = document.querySelector("#libraryView");
const exportButton = document.querySelector("#exportLibrary");
const copyButton = document.querySelector("#copyLibrary");
const status = document.querySelector("#workspaceStatus");

function setStatus(message, state = "idle") {
  if (!status) return;
  status.textContent = message;
  status.dataset.state = state;
}

function selectedItems() {
  library.reload();
  return library.items(view?.value || "favorites");
}

function exportText() {
  return serializeM3u(selectedItems(), { dedupe: true });
}

function viewName() {
  return view?.selectedOptions?.[0]?.textContent?.trim() || "Biblioteka";
}

exportButton?.addEventListener("click", () => {
  const items = selectedItems();
  if (!items.length) return setStatus(`${viewName()}: brak pozycji do eksportu`, "error");
  const blob = new Blob([serializeM3u(items, { dedupe: true })], { type: "audio/x-mpegurl;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `streambench-${view?.value || "library"}.m3u8`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  setStatus(`${viewName()}: wyeksportowano ${items.length} pozycji`);
});

copyButton?.addEventListener("click", async () => {
  const items = selectedItems();
  if (!items.length) return setStatus(`${viewName()}: brak pozycji do skopiowania`, "error");
  try {
    await navigator.clipboard.writeText(exportText());
    setStatus(`${viewName()}: M3U skopiowane`);
  } catch {
    setStatus("Nie udało się skopiować biblioteki", "error");
  }
});
