import { formatProgramme, parseXmltv, scheduleForChannel } from "./xmltv.js";

const ui = {
  file: document.querySelector("#epgFile"),
  text: document.querySelector("#epgText"),
  loadText: document.querySelector("#loadEpgText"),
  status: document.querySelector("#epgStatus"),
  now: document.querySelector("#epgNow"),
  next: document.querySelector("#epgNext"),
};

let programmes = new Map();
let activeChannel = null;

function setStatus(message, state = "idle") {
  ui.status.textContent = message;
  ui.status.dataset.state = state;
}

function renderSchedule() {
  if (!activeChannel?.id) {
    ui.now.textContent = "Wybierz kanał z tvg-id";
    ui.next.textContent = "Brak danych";
    return;
  }
  const schedule = scheduleForChannel(programmes, activeChannel.id);
  ui.now.textContent = formatProgramme(schedule.current);
  ui.next.textContent = formatProgramme(schedule.next);
}

function loadSource(source, label) {
  programmes = parseXmltv(source);
  const count = [...programmes.values()].reduce((sum, entries) => sum + entries.length, 0);
  setStatus(count ? `${label}: ${count} audycji` : `${label}: brak audycji`, count ? "idle" : "error");
  renderSchedule();
}

ui.file.addEventListener("change", async () => {
  const [file] = ui.file.files;
  if (!file) return;
  try {
    loadSource(await file.text(), file.name);
  } catch {
    setStatus("Nie udało się odczytać XMLTV.", "error");
  } finally {
    ui.file.value = "";
  }
});

ui.loadText.addEventListener("click", () => {
  try {
    loadSource(ui.text.value, "Wklejony XMLTV");
  } catch {
    setStatus("Nieprawidłowy XMLTV.", "error");
  }
});

window.addEventListener("streambench:channel", (event) => {
  activeChannel = event.detail || null;
  renderSchedule();
});

setInterval(renderSchedule, 60_000);
