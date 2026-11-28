(() => {
  const $ = selector => document.querySelector(selector);
  const dialog = $('#atlas-dialog');
  if (!dialog) return;
  const title = $('#dialog-title');
  const content = $('#dialog-content');
  const close = dialog?.querySelector('.dialog-close');
  const languages = ['pl', 'en', 'ru', 'zh'];
  const buttons = [...document.querySelectorAll('[data-language]')];
  buttons.forEach(button => { button.disabled = true; });
  let language = 'pl';
  let dictionaries = null;
  let data = null;
  let selection = 0;
  let currentRegion = null;
  let currentItem = null;
  let loreIndex = 0;
  let activeCard = null;
  let dialogState = null;
  const fallbackLore = [
    'Konsolidacja ponad fragmentacją. Małe narzędzia dostają wspólny warsztat, duże projekty własne forty.',
    'Najkrótsza droga między dwoma projektami zwykle prowadzi przez kolejny skrypt, którego miało nie być.',
    'W tej krainie „local-first” nie jest naklejką. To plan ewakuacyjny na wypadek, gdy chmura zacznie mieć pomysły.',
    'Jeżeli urządzenie ma działający protokół z 2014 roku, istnieje niezerowa szansa, że ktoś tu właśnie pisze do niego most.',
    'RSS nie umarł. Po prostu wyniósł się z centrum i zbudował własne obserwatorium.',
  ];

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
  const translated = entry => ({ ...entry, ...(entry.translations?.[language] || {}) });
  const fallback = {"loadingTitle":"Wczytywanie regionu","loading":"Wczytywanie miejsc…","unavailableTitle":"Region niedostępny","unavailable":"Nie udało się wczytać atlasu. Możesz nadal otworzyć projekt.","openProject":"Otwórz projekt ↗","openDestination":"Otwórz stronę ↗","back":"← Wróć do: "};
  const t = key => dictionaries?.[language]?.[key] || dictionaries?.en?.[key] || fallback[key] || key;
  const set = (selector, value) => { const element = $(selector); if (element) element.textContent = value; };
  const setAttr = (selector, attr, value) => { const element = $(selector); if (element) element.setAttribute(attr, value); };
  const showRegion = (region, focusIndex = null) => {
    dialogState = 'region';
    currentRegion = region;
    currentItem = null;
    title.textContent = translated(region).name;
    const intro = text('p', translated(region).description, 'dialog-intro');
    const list = document.createElement('div');
    list.className = 'dialog-list';
    region.items.forEach((item, index) => {
      const button = text('button', translated(item).name, 'dialog-place');
      button.type = 'button';
      const arrow = text('span', '›');
      arrow.setAttribute('aria-hidden', 'true');
      button.append(arrow);
      button.addEventListener('click', () => showItem(region, index));
      list.append(button);
    });
    content.replaceChildren(intro, list, link(t('openProject'), region.url));
    if (focusIndex !== null) list.querySelectorAll('button')[focusIndex]?.focus();
  };
  const showItem = (region, index, focus = true) => {
    dialogState = 'item';
    currentRegion = region;
    currentItem = index;
    const item = translated(region.items[index]);
    title.textContent = item.name;
    const back = text('button', t('back') + translated(region).name, 'dialog-back');
    back.type = 'button';
    back.addEventListener('click', () => showRegion(region, index));
    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    actions.append(back, link(t('openDestination'), item.url));
    content.replaceChildren(text('p', item.description, 'dialog-intro'), actions);
    if (focus) back.focus();
  };
  const showStatus = () => {
    if (dialogState === 'loading') {
      title.textContent = t('loadingTitle');
      content.replaceChildren(text('p', t('loading'), 'dialog-intro'));
    } else if (dialogState === 'unavailable') {
      title.textContent = t('unavailableTitle');
      content.replaceChildren(text('p', t('unavailable'), 'dialog-intro'), link(t('openProject'), activeCard.href));
    }
  };
  const applyLanguage = next => {
    if (!dictionaries?.[next]) return;
    language = next;
    const d = dictionaries[next];
    document.documentElement.lang = next === 'zh' ? 'zh-Hans' : next;
    document.title = d.pageName + ' · TRAVNY';
    set('.brand span:last-child', d.pageName);
    set('.footer span:first-child', d.pageName + ' · 2026');
    setAttr('meta[name="description"]', 'content', d.metaDescription);
    setAttr('meta[property="og:locale"]', 'content', { pl: 'pl_PL', en: 'en_US', ru: 'ru_RU', zh: 'zh_CN' }[next]);
    for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) setAttr(selector, 'content', document.title);
    for (const selector of ['meta[property="og:description"]', 'meta[name="twitter:description"]']) setAttr(selector, 'content', d.metaDescription);
    const schema = $('#atlas-schema');
    if (schema?.textContent) {
      const metadata = JSON.parse(schema.textContent);
      schema.textContent = JSON.stringify({ ...metadata, name: d.pageName, description: d.metaDescription, inLanguage: document.documentElement.lang });
    }
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.language === next)));
    const fields = {
      '#hero-heading':'heading', '.hero h1 em':'headingEm', '.lede':'lede',
      '.hero-actions a:nth-child(1)':'explore', '.hero-actions a:nth-child(2)':'command',
      '.hero-actions a:nth-child(3)':'infrastructure', '#shuffleLore':'shuffle',
      '.realm-label':'realmLabel', '.realm-stat span':'regionsCount',
      '.atlas-section .eyebrow':'mainRegions', '.atlas-section h2':'mapTitle',
      '.atlas-section .section-heading > p':'mapIntro', '.workshop-section .eyebrow':'workshopLabel',
      '.workshop-section h2':'workshopTitle', '.workshop-section .section-heading > p':'workshopIntro',
      '.workshop-hub small':'workshopDescription', '.roads .eyebrow':'roadsLabel',
      '.roads h2':'roadsTitle', '.road-card:nth-child(1) small':'aiDescription',
      '.road-card:nth-child(2) small':'wifiDescription', '.gate:nth-child(1) small':'west',
      '.gate:nth-child(1) p':'westDescription', '.gate:nth-child(2) small':'east',
      '.gate:nth-child(2) p':'eastDescription', '.footer span:last-child':'footer',
      '.tool-grid a:nth-child(1) span':'toolCode', '.tool-grid a:nth-child(3) span':'toolDoc',
      '.tool-grid a:nth-child(5) span':'toolFeeds', '.tool-grid a:nth-child(8) span':'toolIntent',
    };
    for (const [selector, key] of Object.entries(fields)) set(selector, d[key]);
    document.querySelectorAll('.atlas .region').forEach(card => {
      const translation = d.cards[card.dataset.region];
      if (!translation) return;
      card.querySelector('.region-kicker').textContent = translation[0];
      card.querySelector('p').textContent = translation[1];
      card.querySelector('.tagline').textContent = d.tags[card.dataset.region];
    });
    set('#lore', d.lore[loreIndex]);
    setAttr('.topbar', 'aria-label', d.navigation);
    setAttr('.realm-card', 'aria-label', d.realmAria);
    setAttr('.atlas', 'aria-label', d.mapAria);
    setAttr('.dialog-close', 'aria-label', d.close);
    const nav = d.nav;
    setAttr('#trvny-nav-toggle', 'aria-label', nav[0]);
    setAttr('#trvny-nav-close', 'aria-label', nav[1]);
    setAttr('#trvny-nav-drawer', 'aria-label', nav[2]);
    const groupLabels = { '/': nav[3], 'https://weather.bartek.lol/': nav[4], '/lab/': nav[5], '/teksty/': nav[6] };
    document.querySelectorAll('.trvny-nav-group').forEach(group => {
      const label = group.querySelector('.trvny-nav-label');
      const href = group.querySelector('a')?.getAttribute('href');
      if (label && Object.hasOwn(groupLabels, href)) label.textContent = groupLabels[href];
    });
    const navText = (selector, value) => { const node = $(selector)?.firstChild; if (node && node.nodeType === Node.TEXT_NODE) node.textContent = value; };
    navText('#trvny-nav-drawer a[href="/"]', nav[7]);
    set('#trvny-nav-drawer a[href="/"] small', nav[8]);
    set('#trvny-nav-drawer a[href="/tv/"] small', nav[9]);
    navText('#trvny-nav-drawer a[href="https://weather.bartek.lol/"]', nav[10]);
    navText('#trvny-nav-drawer a[href="https://rss.bartek.lol/"]', nav[11]);
    set('#trvny-nav-drawer a[href="/badges/"] small', nav[12]);
    navText('#trvny-nav-drawer a[href="/teksty/"]', nav[13]);
    set('#trvny-nav-drawer a[href="/teksty/githubowa-kraina/"] small', nav[14]);
    navText('#trvny-nav-drawer a[href="/teksty/token-worldcup/"]', nav[15]);
    document.querySelectorAll('.explore-hint').forEach(hint => { hint.textContent = d.exploreRegion; });
    if (dialog?.open) {
      if (currentRegion && dialogState === 'region') showRegion(currentRegion);
      else if (currentRegion && dialogState === 'item') showItem(currentRegion, currentItem, false);
      else showStatus();
    }
    try { localStorage.setItem('github-world-language', next); } catch { /* Storage is optional. */ }
  };
  buttons.forEach(button => button.addEventListener('click', () => applyLanguage(button.dataset.language)));
  $('#shuffleLore')?.addEventListener('click', () => {
    const options = dictionaries?.[language]?.lore || fallbackLore;
    if (!options || options.length < 2) return;
    if (typeof crypto === 'undefined') {
      loreIndex = (loreIndex + 1) % options.length;
    } else {
      const candidates = options.map((_, index) => index).filter(index => index !== loreIndex);
      // Reject out-of-range samples; no biased modulo or immediate repeat.
      let selected;
      do {
        selected = crypto.getRandomValues(new Uint8Array(64)).find(value => value < candidates.length);
      } while (selected === undefined);
      loreIndex = candidates[selected];
    }
    set('#lore', options[loreIndex]);
  });
  fetch('/teksty/githubowa-kraina/locales.json')
    .then(response => { if (!response.ok) throw new Error('Languages unavailable'); return response.json(); })
    .then(result => {
      if (!dialog.isConnected) return;
      dictionaries = result;
      buttons.forEach(button => { button.disabled = false; });
      let stored = null;
      try { stored = localStorage.getItem('github-world-language'); } catch { /* Storage is optional. */ }
      const browser = [...(navigator.languages || []), navigator.language]
        .filter(Boolean).map(value => value.toLowerCase().split('-')[0])
        .find(value => languages.includes(value));
      applyLanguage(languages.includes(stored) ? stored : browser || 'pl');
    })
    .catch(error => { console.warn('Languages unavailable.', error); buttons.forEach(button => { button.disabled = true; }); });

  if (!dialog || typeof dialog.showModal !== 'function') return;
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { selection += 1; currentRegion = null; currentItem = null; activeCard = null; dialogState = null; });
  const atlas = fetch('/teksty/githubowa-kraina/atlas.json')
    .then(response => { if (!response.ok) throw new Error('Atlas unavailable'); return response.json(); })
    .then(result => { data = result; return data; })
    .catch(error => { console.warn('Atlas unavailable; project links remain accessible.', error); return null; });
  for (const card of document.querySelectorAll('[data-region]')) {
    card.setAttribute('aria-haspopup', 'dialog');
    const hint = text('span', 'Odkryj region', 'explore-hint');
    card.append(hint);
    card.addEventListener('click', async event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const current = ++selection;
      activeCard = card;
      currentRegion = null;
      currentItem = null;
      dialogState = 'loading';
      showStatus();
      if (!dialog.open) dialog.showModal();
      close.focus();
      const result = data || await atlas;
      if (current !== selection || !dialog.open) return;
      const region = result?.regions.find(entry => entry.id === card.dataset.region);
      if (region) showRegion(region);
      else {
        dialogState = 'unavailable';
        showStatus();
      }
    });
  }
})();
