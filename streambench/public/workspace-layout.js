const workspace = document.querySelector(".workspace");
const sourceTools = document.querySelector(".source-tools");
const toolsPanel = document.querySelector("#toolsPanel");
const library = document.querySelector(".library-box");
const epgImport = document.querySelector(".epg-import");
const playlistEmpty = document.querySelector("#playlistEmpty p");
const mobileTools = document.querySelector('[data-mobile-view-target="tools"]');

function sourceTab(id, label, selected = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.id = `sourceTab-${id}`;
  button.className = "source-mode-tab";
  button.dataset.sourceTarget = id;
  button.setAttribute("role", "tab");
  button.setAttribute("aria-controls", `sourcePanel-${id}`);
  button.setAttribute("aria-selected", String(selected));
  button.textContent = label;
  return button;
}

function sourcePanel(id, selected = false) {
  const panel = document.createElement("section");
  panel.id = `sourcePanel-${id}`;
  panel.className = "source-mode-panel";
  panel.dataset.sourcePanel = id;
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", `sourceTab-${id}`);
  panel.hidden = !selected;
  return panel;
}

if (workspace && sourceTools) {
  const heading = sourceTools.querySelector(":scope > .tool-heading");
  const provider = sourceTools.querySelector(":scope > .provider-box");
  const divider = sourceTools.querySelector(":scope > .source-divider");
  const fileButton = sourceTools.querySelector(":scope > .file-button");
  const pasteBox = sourceTools.querySelector(":scope > .paste-box");
  const playlistTools = sourceTools.querySelector(":scope > .playlist-tools");

  divider?.remove();
  heading?.querySelector(".eyebrow")?.replaceChildren("Źródła i dane");
  heading?.querySelector("h3")?.replaceChildren("Katalog, własna M3U i XMLTV");

  const tabs = document.createElement("div");
  tabs.className = "source-mode-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Rodzaj danych wejściowych");

  const catalogTab = sourceTab("catalog", "Katalog", true);
  const playlistTab = sourceTab("playlist", "Własna M3U");
  const epgTab = sourceTab("epg", "XMLTV");
  tabs.append(catalogTab, playlistTab, epgTab);

  const catalogPanel = sourcePanel("catalog", true);
  const playlistPanel = sourcePanel("playlist");
  const epgPanel = sourcePanel("epg");
  if (provider) catalogPanel.append(provider);
  if (fileButton) playlistPanel.append(fileButton);
  if (pasteBox) playlistPanel.append(pasteBox);
  if (playlistTools) playlistPanel.append(playlistTools);
  if (epgImport) epgPanel.append(epgImport);

  const panels = document.createElement("div");
  panels.className = "source-mode-panels";
  panels.append(catalogPanel, playlistPanel, epgPanel);

  sourceTools.replaceChildren(...[heading, tabs, panels].filter(Boolean));

  const sourceDock = document.createElement("section");
  sourceDock.className = "panel source-dock";
  sourceDock.setAttribute("aria-label", "Źródła playlisty i XMLTV");
  sourceDock.append(sourceTools);
  workspace.after(sourceDock);

  const selectSource = (id) => {
    tabs.querySelectorAll(".source-mode-tab").forEach((tab) => {
      tab.setAttribute("aria-selected", String(tab.dataset.sourceTarget === id));
    });
    panels.querySelectorAll(".source-mode-panel").forEach((panel) => {
      panel.hidden = panel.dataset.sourcePanel !== id;
    });
  };

  tabs.addEventListener("click", (event) => {
    const tab = event.target.closest(".source-mode-tab");
    if (tab) selectSource(tab.dataset.sourceTarget);
  });

  if (library) {
    library.classList.add("panel", "library-panel");
    sourceDock.after(library);
    const controls = library.querySelector(".library-controls");
    if (controls && !document.querySelector("#exportLibrary")) {
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
}

if (toolsPanel) {
  toolsPanel.querySelector(".tools-summary .eyebrow")?.replaceChildren("Zaplecze");
  toolsPanel.querySelector(".tools-summary h2")?.replaceChildren("Diagnostyka i program");
}

if (playlistEmpty) {
  playlistEmpty.textContent = "Wczytaj katalog lub własną playlistę w panelu pod odtwarzaczem.";
}

if (mobileTools) {
  mobileTools.childNodes[0].textContent = "Źródła";
}

window.dispatchEvent(new CustomEvent("streambench:layout-ready"));
