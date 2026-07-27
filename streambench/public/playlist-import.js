const fileInput = document.querySelector("#playlistFile");
const textInput = document.querySelector("#playlistText");
const parseButton = document.querySelector("#parsePlaylist");
const status = document.querySelector("#status");
const hint = document.querySelector("#streamHint");
const workspaceStatus = document.querySelector("#workspaceStatus");
const entryCount = document.querySelector("#entryCount");

let importGeneration = 0;

function showImportError(message) {
  status.textContent = "Błąd";
  status.dataset.state = "error";
  hint.textContent = message;
  workspaceStatus.textContent = message;
  workspaceStatus.dataset.state = "error";
}

function restoreFileLabel(fileName) {
  const count = Number.parseInt(entryCount.textContent, 10) || 0;
  if (!count) {
    hint.textContent = `${fileName}: nie znaleziono poprawnych adresów HTTP lub HTTPS.`;
    workspaceStatus.textContent = `${fileName}: brak pozycji`;
    workspaceStatus.dataset.state = "error";
    return;
  }
  hint.textContent = `${fileName}: wczytano ${count} pozycji lokalnie.`;
  workspaceStatus.textContent = `${fileName}: ${count} pozycji`;
  workspaceStatus.dataset.state = "idle";
}

fileInput.addEventListener("change", async (event) => {
  event.stopImmediatePropagation();
  const [file] = event.target.files || [];
  if (!file) return;

  const generation = ++importGeneration;
  status.textContent = "Wczytywanie";
  status.dataset.state = "loading";
  workspaceStatus.textContent = `Odczytywanie ${file.name}…`;
  workspaceStatus.dataset.state = "idle";

  try {
    const source = await file.text();
    if (generation !== importGeneration) return;
    textInput.value = source;
    parseButton.click();
    restoreFileLabel(file.name);
    textInput.value = "";
  } catch {
    if (generation === importGeneration) {
      showImportError("Nie udało się odczytać pliku playlisty.");
    }
  } finally {
    if (generation === importGeneration) fileInput.value = "";
  }
}, true);
