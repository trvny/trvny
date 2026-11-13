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
      button.append(text('span', '›'));
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
  fetch('/teksty/githubowa-kraina/atlas.json')
    .then(response => {
      if (!response.ok) throw new Error('Atlas unavailable');
      return response.json();
    })
    .then(data => {
      for (const region of data.regions) {
        const card = document.querySelector(`[data-region="${region.id}"]`);
        if (!card) continue;
        card.setAttribute('aria-haspopup', 'dialog');
        card.append(text('span', 'Explore region', 'explore-hint'));
        card.addEventListener('click', event => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          showRegion(region);
          dialog.showModal();
          close.focus();
        });
      }
    })
    .catch(() => {});
})();
