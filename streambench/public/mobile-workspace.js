const mediaQuery = window.matchMedia("(max-width: 840px)");
const nav = document.querySelector("#mobileWorkspaceNav");
const buttons = [...document.querySelectorAll("[data-mobile-view-target]")];
const playlistCount = document.querySelector("#mobilePlaylistCount");
const entryCount = document.querySelector("#entryCount");
const status = document.querySelector("#status");

function updateCount() {
  if (playlistCount && entryCount) playlistCount.textContent = entryCount.textContent.trim() || "0";
}

function setView(view, { scroll = false } = {}) {
  if (!buttons.some((button) => button.dataset.mobileViewTarget === view)) return;
  document.body.dataset.mobileView = view;
  for (const button of buttons) {
    button.setAttribute("aria-pressed", String(button.dataset.mobileViewTarget === view));
  }
  if (scroll && mediaQuery.matches) nav?.scrollIntoView({ block: "start", behavior: "smooth" });
}

for (const button of buttons) {
  button.addEventListener("click", () => setView(button.dataset.mobileViewTarget, { scroll: true }));
}

new MutationObserver(updateCount).observe(entryCount, { childList: true, subtree: true, characterData: true });
new MutationObserver(() => {
  if (status.textContent.trim() !== "Playlista gotowa") return;
  document.body.dataset.hasPlaylist = "true";
  updateCount();
  setView("playlist", { scroll: true });
}).observe(status, { childList: true, subtree: true, characterData: true });

window.addEventListener("streambench:channel", (event) => {
  if (event.detail?.title) setView("player", { scroll: mediaQuery.matches });
});

setView("player");
updateCount();
