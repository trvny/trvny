(() => {
  const dialog = document.querySelector('#atlas-dialog');
  const title = document.querySelector('#dialog-title');
  const content = document.querySelector('#dialog-content');
  const close = dialog?.querySelector('.dialog-close');
  if (!dialog || typeof dialog.showModal !== 'function') return;

  const text = (tag, value, className) => {
    const element = document.createElement(tag);
    element.textContent = value;
    if (className) element.className = className;
    return element;
  };
  const link = (label, url) => {
    const element = text('a', label, 'dialog-link');
    element.href = url;
    element.target = '_blank';
    element.rel = 'noopener noreferrer';
    return element;
  };
  const showRegion = (region, focusItem = null) => {
    title.textContent = region.name;
    const intro = text('p', region.description, 'dialog-intro');
    const list = document.createElement('div');
    list.className = 'dialog-list';
    for (const item of region.items) {
      const button = text('button', item.name, 'dialog-place');
      button.type = 'button';
      button.dataset.name = item.name;
      const arrow = text('span', '›');
      arrow.setAttribute('aria-hidden', 'true');
      button.append(arrow);
      button.addEventListener('click', () => showItem(region, item));
      list.append(button);
    }
    content.replaceChildren(intro, list, link('Open project ↗', region.url));
    if (focusItem) [...list.querySelectorAll('button')].find(button => button.dataset.name === focusItem)?.focus();
  };
  const showItem = (region, item) => {
    title.textContent = item.name;
    const back = text('button', '← Back to ' + region.name, 'dialog-back');
    back.type = 'button';
    back.addEventListener('click', () => showRegion(region, item.name));
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    actions.append(back, link('Open destination ↗', item.url));
    content.replaceChildren(text('p', item.description, 'dialog-intro'), actions);
    back.focus();
  };
  close.addEventListener('click', () => dialog.close());
  const atlas = fetch('/teksty/githubowa-kraina/atlas.json')
    .then(response => {
      if (!response.ok) throw new Error('Atlas unavailable');
      return response.json();
    })
    .catch(error => {
      console.warn('Atlas unavailable; project links remain accessible.', error);
      return null;
    });
  let selection = 0;
  dialog.addEventListener('close', () => { selection += 1; });
  for (const card of document.querySelectorAll('[data-region]')) {
    card.setAttribute('aria-haspopup', 'dialog');
    const hint = text('span', 'Explore region', 'explore-hint');
    hint.lang = 'en';
    card.append(hint);
    card.addEventListener('click', async event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const current = ++selection;
      title.textContent = 'Loading region';
      content.replaceChildren(text('p', 'Loading places…', 'dialog-intro'));
      dialog.showModal();
      close.focus();
      const data = await atlas;
      if (current !== selection || !dialog.open) return;
      const region = data?.regions.find(entry => entry.id === card.dataset.region);
      if (region) showRegion(region);
      else {
        title.textContent = 'Region unavailable';
        content.replaceChildren(text('p', 'The atlas could not be loaded. You can still open this project.', 'dialog-intro'), link('Open project ↗', card.href));
      }
    });
  }
})();
