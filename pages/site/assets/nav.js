(() => {
  const toggle = document.getElementById("trvny-nav-toggle");
  const drawer = document.getElementById("trvny-nav-drawer");
  const backdrop = document.getElementById("trvny-nav-backdrop");
  const closeButton = document.getElementById("trvny-nav-close");
  const search = document.getElementById("trvny-nav-search");
  const empty = document.getElementById("trvny-nav-empty");
  if (!toggle || !drawer || !backdrop || !closeButton) return;

  let previousFocus = null;
  const links = [...drawer.querySelectorAll(".trvny-nav-link")];
  const groups = [...drawer.querySelectorAll(".trvny-nav-group")];
  function searchText(value) {
    return value.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replaceAll("ł", "l");
  }

  function filterLinks() {
    if (!search || !empty) return;
    const query = searchText(search.value.trim()).split(/\s+/);
    for (const link of links) {
      const text = searchText(link.textContent + " " + link.getAttribute("href"));
      link.hidden = !query.every((word) => text.includes(word));
    }
    for (const group of groups) {
      group.hidden = !group.querySelector(".trvny-nav-link:not([hidden])");
    }
    empty.hidden = links.some((link) => !link.hidden);
  }

  function openDrawer() {
    if (drawer.dataset.open === "true") return;
    previousFocus = document.activeElement;
    drawer.inert = false;
    drawer.dataset.open = "true";
    drawer.setAttribute("aria-hidden", "false");
    toggle.setAttribute("aria-expanded", "true");
    backdrop.hidden = false;
    filterLinks();
    document.body.classList.add("trvny-nav-locked");
    closeButton.focus();
  }

  function closeDrawer() {
    drawer.dataset.open = "false";
    drawer.inert = true;
    drawer.setAttribute("aria-hidden", "true");
    toggle.setAttribute("aria-expanded", "false");
    backdrop.hidden = true;
    document.body.classList.remove("trvny-nav-locked");
    if (search) search.value = "";
    filterLinks();
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
  }

  toggle.addEventListener("click", openDrawer);
  closeButton.addEventListener("click", closeDrawer);
  backdrop.addEventListener("click", closeDrawer);
  search?.addEventListener("input", filterLinks);

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.isComposing) return;
    if (search && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
      if (document.querySelector("dialog[open]")) return;
      event.preventDefault();
      openDrawer();
      search.focus();
      return;
    }
    if (drawer.dataset.open !== "true") return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer();
      return;
    }
    const results = links.filter((link) => !link.hidden);
    if (search && document.activeElement === search && (event.key === "ArrowDown" || event.key === "Enter")) {
      const result = results[0];
      if (!result) return;
      event.preventDefault();
      if (event.key === "Enter") result.click();
      else result.focus();
      return;
    }
    if (event.key !== "Tab") return;
    const first = closeButton;
    const last = results.at(-1) || search || closeButton;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
})();
