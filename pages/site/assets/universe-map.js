import { buildExplorerGraph, edgeColors, nodeKinds, relationLabels } from './universe-data.js';

function get(id) {
  return document.getElementById(id);
}

function make(tag, text) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}

function addField(fields, term, value) {
  const definition = make('dd');
  definition.append(value);
  fields.append(make('dt', term), definition);
}
const svgNamespace = 'http://www.w3.org/2000/svg';

function graphic(tag, attributes, text) {
  const element = document.createElementNS(svgNamespace, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  return element;
}

async function loadData(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(path, { signal: controller.signal });
    if (!response.ok) throw new Error('Map data unavailable');
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function makeDiagram(svg, data, snapshot, byId, selectNode) {
  const nodes = get('nodes');
  const edges = get('edges');
  const clusters = get('clusters');
  const width = Math.max(1330, ...data.nodes.map(node => node.x + 176));
  const height = Math.max(930, ...data.nodes.map(node => node.y + 72));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  for (const { x, y, w, h, label } of snapshot.clusters) {
    clusters.append(
      graphic('rect', { class: 'cluster', x, y, width: w, height: h }),
      graphic('text', { class: 'cluster-label', x: x + 12, y: y + 20 }, label),
    );
  }
  for (const [from, to, kind] of data.edges) {
    const a = byId.get(from), b = byId.get(to);
    const x1 = a.x + 78, x2 = b.x + 78, y1 = a.y + 26, y2 = b.y + 26;
    const bend = Math.max(35, Math.abs(x2 - x1) * 0.42);
    const path = graphic('path', {
      class: 'edge ' + kind,
      stroke: edgeColors[kind],
      d: `M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`,
    });
    path.dataset.from = from;
    path.dataset.to = to;
    path.dataset.kind = kind;
    edges.append(path);
  }
  for (const { id, category, x, y, label, sub } of data.nodes) {
    const group = graphic('g', {
      class: 'node ' + category, transform: `translate(${x} ${y})`,
      tabindex: 0, role: 'button', 'aria-label': label + ', ' + sub, 'aria-pressed': 'false',
    });
    group.dataset.id = id;
    group.append(
      graphic('rect', { class: 'body', width: 156, height: 52 }),
      graphic('rect', { class: 'strip', width: 6, height: 52, fill: nodeKinds[category]?.[1] ?? '#a6b1c4' }),
      graphic('text', { class: 'title', x: 14, y: 21 }, label),
      graphic('text', { class: 'sub', x: 14, y: 38 }, sub),
    );
    group.addEventListener('click', () => selectNode(id));
    group.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectNode(id);
      }
    });
    nodes.append(group);
  }
}

function download(name, type, body) {
  const link = make('a');
  link.href = URL.createObjectURL(new Blob([body], { type }));
  link.download = name;
  document.body.append(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
    link.remove();
  }, 0);
}

function exportDiagram(svg, date) {
  const copy = svg.cloneNode(true);
  copy.removeAttribute('hidden');
  for (const node of copy.querySelectorAll('.dim,.active')) node.classList.remove('dim', 'active');
  const rules = [...document.styleSheets].filter(sheet => sheet.ownerNode?.matches('style'))
    .flatMap(sheet => [...sheet.cssRules])
    .filter(rule => /^:root|^\.(?:edge|node|cluster)\b/.test(rule.selectorText ?? ''))
    .map(rule => rule.cssText).join(' ');
  copy.prepend(graphic('style', {}, rules));
  download('trvny-universe-' + date + '.svg', 'image/svg+xml', new XMLSerializer().serializeToString(copy));
}

async function mount() {
  const [snapshot, atlas] = await Promise.all([
    loadData('./infrastructure.json'),
    loadData('./atlas.json').catch(() => null),
  ]);
  const data = buildExplorerGraph(snapshot, atlas);
  const byId = new Map(data.nodes.map(node => [node.id, node]));
  const { nodes, edges } = data;
  const directory = get('node-list');
  const details = get('details');
  const search = get('search');
  const category = get('node-kind');
  const relation = get('relation-kind');
  const svg = get('graph');
  const viewport = get('map-webgl');
  const graphButton = get('map-view');
  const graphStatus = get('map-view-status');
  const zoom = get('map-zoom');
  const neighbors = new Map(nodes.map(node => [node.id, new Set()]));
  for (const [from, to] of edges) {
    neighbors.get(from).add(to);
    neighbors.get(to).add(from);
  }
  let selected = null;
  let preset = 'all';
  let webgl;

  get('snapshot').textContent = 'Infrastructure snapshot · ' + snapshot.snapshot;
  const categoryOptions = Object.entries(nodeKinds);
  const legend = get('map-legend');
  for (const [kind, [label, color]] of categoryOptions) {
    const option = make('option', label);
    option.value = kind;
    category.append(option);
    const item = make('span', label);
    const dot = make('i');
    dot.className = 'dot';
    dot.style.background = color;
    item.prepend(dot);
    legend.append(item);
  }
  for (const [kind, label] of Object.entries(relationLabels)) {
    const option = make('option', label);
    option.value = kind;
    relation.append(option);
  }

  const rows = new Map();
  for (const node of [...nodes].sort((a, b) => a.label.localeCompare(b.label))) {
    const entry = make('li');
    const button = make('button', node.label);
    button.type = 'button';
    button.append(make('small', node.sub));
    button.addEventListener('click', () => selectNode(node.id));
    entry.append(button);
    directory.append(entry);
    rows.set(node.id, { entry, button });
  }

  function showDetails(count) {
    const node = byId.get(selected);
    if (!node) {
      details.replaceChildren(make('h2', 'Universe map'), make('p', count + ' matching nodes. Select a node to see its connections.'));
      return;
    }
    const label = make('span', nodeKinds[node.category]?.[0] ?? node.category);
    label.className = 'pill';
    const heading = make('h2', node.label);
    const fields = make('dl');
    addField(fields, 'Role', node.sub);
    if (node.url) {
      const source = make('a', node.url);
      source.href = node.url;
      source.target = '_blank';
      source.rel = 'noopener noreferrer';
      addField(fields, 'Open', source);
    }
    const connections = edges.filter(([from, to, kind]) =>
      (from === selected || to === selected) && (!relation.value || relation.value === kind)
    ).map(([from, to, kind]) => ({
      other: byId.get(from === selected ? to : from), kind,
    })).sort((a, b) => a.other.label.localeCompare(b.other.label));
    if (connections.length) {
      const links = make('ul');
      for (const { other, kind } of connections) {
        const entry = make('li');
        const link = make('a', other.label);
        link.href = '#' + other.id;
        entry.append(link, make('small', ' · ' + relationLabels[kind]));
        links.append(entry);
      }
      addField(fields, 'Direct connections', links);
    }
    details.replaceChildren(label, heading, make('p', node.info), fields);
  }

  function render() {
    const query = search.value.trim().toLowerCase();
    const matching = nodes.filter(node => {
      const text = [node.label, node.sub, node.info, node.translated].join(' ').toLowerCase();
      return (preset === 'all' || node.tags.includes(preset))
        && (!category.value || node.category === category.value)
        && (!query || text.includes(query));
    });
    const visible = new Set(matching.map(node => node.id));
    if (selected) visible.add(selected);
    const highlighted = selected ? neighbors.get(selected) : null;
    for (const [id, { entry, button }] of rows) {
      entry.hidden = !visible.has(id);
      button.setAttribute('aria-pressed', String(id === selected));
    }
    get('node-count').textContent = '(' + visible.size + ')';
    for (const element of svg.querySelectorAll('.node')) {
      const id = element.dataset.id;
      const active = id === selected;
      element.classList.toggle('active', active);
      element.setAttribute('aria-pressed', String(active));
      element.classList.toggle('dim', !visible.has(id) || Boolean(selected && !active && !highlighted.has(id)));
    }
    for (const element of svg.querySelectorAll('.edge')) {
      const { from, to, kind } = element.dataset;
      const active = selected === from || selected === to;
      const filtered = (relation.value && relation.value !== kind) || (!visible.has(from) || !visible.has(to));
      element.classList.toggle('active', !filtered && active);
      element.classList.toggle('dim', Boolean(filtered || (selected && !active)));
    }
    for (const button of document.querySelectorAll('[data-preset]')) {
      const active = button.dataset.preset === preset;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    webgl?.update({ visible, selected, relation: relation.value });
    showDetails(matching.length);
  }

  function selectNode(id, { push = false, focus = false, write = true } = {}) {
    selected = byId.has(id) ? id : null;
    if (write) {
      const url = new URL(location.href);
      url.hash = selected ?? '';
      if (url.hash !== location.hash) history[push ? 'pushState' : 'replaceState'](history.state, '', url);
    }
    render();
    if (selected) webgl?.focus(selected);
    if (focus) {
      const heading = details.querySelector('h2');
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }

  function syncHash(event) {
    if (event && new URL(event.newURL).hash !== location.hash) return;
    selectNode(location.hash.slice(1), { write: false });
  }

  details.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    selectNode(link.hash.slice(1), { push: true, focus: true });
  });
  addEventListener('hashchange', syncHash);
  makeDiagram(svg, data, snapshot, byId, selectNode);
  function resetFiltersView() {
    selectNode(null);
    webgl?.fit();
  }
  for (const button of document.querySelectorAll('[data-preset]')) {
    button.addEventListener('click', () => {
      preset = button.dataset.preset;
      search.value = '';
      category.value = '';
      relation.value = '';
      resetFiltersView();
    });
  }
  search.addEventListener('input', resetFiltersView);
  category.addEventListener('change', resetFiltersView);
  relation.addEventListener('change', render);

  function showDiagram() {
    webgl?.destroy();
    webgl = undefined;
    viewport.replaceChildren();
    viewport.hidden = true;
    svg.removeAttribute('hidden');
    zoom.hidden = true;
    graphButton.setAttribute('aria-pressed', 'false');
  }

  function unavailable() {
    showDiagram();
    graphStatus.textContent = 'Interactive graph unavailable. Diagram and node list are still available.';
  }

  graphButton.addEventListener('click', async () => {
    graphStatus.textContent = '';
    if (!viewport.hidden) {
      showDiagram();
      return;
    }
    graphButton.disabled = true;
    graphStatus.textContent = 'Loading interactive graph…';
    try {
      const { mountWebGL } = await import('/assets/vendor/universe-webgl.1.js');
      viewport.hidden = false;
      svg.setAttribute('hidden', '');
      webgl = mountWebGL(viewport, data, { select: selectNode, reset: () => selectNode(null), unavailable });
      zoom.hidden = false;
      graphButton.setAttribute('aria-pressed', 'true');
      webgl.resize();
      render();
      if (selected) webgl.focus(selected);
      graphStatus.textContent = '';
    } catch (error) {
      console.warn("Interactive graph could not start.", error);
      unavailable();
    } finally {
      graphButton.disabled = false;
    }
  });

  get('zoom-in').addEventListener('click', () => webgl?.zoom(0.75));
  get('zoom-out').addEventListener('click', () => webgl?.zoom(1.33));
  get('zoom-fit').addEventListener('click', () => webgl?.fit());
  addEventListener('pagehide', event => {
    if (!event.persisted) webgl?.destroy();
  });

  get('download-json').addEventListener('click', () => {
    const { snapshot: date } = snapshot;
    download('trvny-universe-' + date + '.json', 'application/json', JSON.stringify({ snapshot: date, nodes, edges }, null, 2));
  });
  get('download-svg').addEventListener('click', () => exportDiagram(svg, snapshot.snapshot));

  syncHash();
  get('map-loading').hidden = true;
  document.querySelectorAll('.controls, .legend, .layout').forEach(element => { element.hidden = false; });
}

mount().catch(() => {
  get('map-loading').hidden = true;
  get('map-error').hidden = false;
});
