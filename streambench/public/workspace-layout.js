const main = document.querySelector("main");
const workspace = document.querySelector(".workspace");
const sourceTools = document.querySelector(".source-tools");
const toolsPanel = document.querySelector("#toolsPanel");
const library = document.querySelector(".library-box");

if (main && workspace && sourceTools) {
  const sourceDock = document.createElement("section");
  sourceDock.className = "panel source-dock";
  sourceDock.setAttribute("aria-label", "Wczytywanie i eksport playlisty");
  sourceDock.append(sourceTools);
  main.insertBefore(sourceDock, workspace);
}

if (workspace && library) {
  library.classList.add("panel", "library-panel");
  workspace.after(library);
  const controls = library.querySelector(".library-controls");
  if (controls) {
    const exportButton = document.createElement("button");
    exportButton.id = "exportLibrary";
    exportButton.type = "button";
    exportButton.className = "secondary";
    exportButton.textContent = "Eksportuj M3U";
    const copyButton = document.createElement("button");
    copyButton.id = "copyLibrary";
    copyButton.type = "button";
    copyButton.className = "secondary";
    copyButton.textContent = "Kopiuj";
    controls.append(exportButton, copyButton);
  }
}

if (toolsPanel) {
  const eyebrow = toolsPanel.querySelector(".tools-summary .eyebrow");
  const heading = toolsPanel.querySelector(".tools-summary h2");
  if (eyebrow) eyebrow.textContent = "Zaplecze";
  if (heading) heading.textContent = "Diagnostyka i EPG";
}

window.dispatchEvent(new CustomEvent("streambench:layout-ready"));
