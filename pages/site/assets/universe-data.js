export const nodeKinds = {
  repo: ['Repository', '#7dd3fc'],
  component: ['Source component', '#c4b5fd'],
  worker: ['Cloudflare runtime', '#f6c453'],
  storage: ['Storage and state', '#86efac'],
  external: ['External system', '#f9a8d4'],
  project: ['Project', '#a6a9ff'],
  app: ['App', '#d8b4fe'],
  agent: ['Agent', '#fca5a5'],
  domain: ['Domain', '#5eead4'],
};

export const relationLabels = {
  source: 'Source', service: 'Service', storage: 'Storage', external: 'External',
  project: 'Project', host: 'Domain',
};

export const edgeColors = { source: '#71839c', service: '#f6c453', storage: '#86efac', external: '#f9a8d4', project: '#a6a9ff', host: '#5eead4' };

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    return url.origin + (url.hostname === 'github.com' ? url.pathname.toLowerCase() : url.pathname).replace(/\/$/, '') + url.search + url.hash;
  } catch {
    return null;
  }
}

export function buildExplorerGraph(snapshot, atlas) {
  const nodes = snapshot.nodes.map(node => ({ ...node, category: node.category || node.kind }));
  const edges = [...snapshot.edges];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const reposByUrl = new Map(nodes.filter(node => node.kind === 'repo' && node.url).map(node => [canonicalUrl(node.url), node.id]));
  const keys = new Set(edges.map(edge => edge.join('|')));
  let added = 0;

  function addNode(node) {
    const index = added++;
    const positioned = { ...node, x: 45 + (index % 8) * 165, y: 1000 + Math.floor(index / 8) * 100 };
    nodes.push(positioned);
    byId.set(node.id, positioned);
    return node.id;
  }

  function connect(from, to, kind) {
    if (from === to) return;
    const key = [from, to, kind].join('|');
    if (keys.has(key)) return;
    keys.add(key);
    edges.push([from, to, kind]);
  }

  for (const region of Array.isArray(atlas?.regions) ? atlas.regions : []) {
    const parent = reposByUrl.get(canonicalUrl(region?.url));
    if (!parent || typeof region.id !== 'string' || !Array.isArray(region.items)) continue;
    const tags = byId.get(parent).tags;
    for (const item of region.items) {
      if (!canonicalUrl(item?.url) || typeof item.name !== 'string') continue;
      const translated = Object.values(item.translations ?? {}).flatMap(entry => entry?.name ?? []).join(' ');
      const existing = byId.get(item.infrastructureId);
      if (existing) {
        existing.translated = [existing.translated, item.name, translated].filter(Boolean).join(' ');
        connect(parent, existing.id, 'project');
        continue;
      }
      const slug = item.name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const id = 'atlas-' + region.id + '-' + slug;
      if (!slug || byId.has(id)) continue;
      const category = item.category === 'app' ? 'app' : 'project';
      addNode({
        id, label: item.name, sub: region.name, info: item.description, category, kind: category,
        url: item.url, tags, translated,
      });
      connect(parent, id, 'project');
    }
  }

  for (const node of [...nodes]) {
    if (!node.url) continue;
    const url = new URL(node.url);
    const host = url.hostname;
    if (host !== 'bartek.lol' && !host.endsWith('.bartek.lol') && !host.endsWith('.travny.workers.dev')) continue;
    const id = 'domain-' + host.replaceAll('.', '-');
    if (!byId.has(id)) {
      addNode({
        id, label: host, sub: 'Public hostname', info: 'Public URL listed by a connected project.',
        category: 'domain', kind: 'domain', url: url.origin, tags: ['all', 'web'],
      });
    }
    connect(node.id, id, 'host');
  }
  return { nodes, edges };
}
