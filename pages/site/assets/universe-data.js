export const nodeKinds = {
  repo: ['Repository', '#7dd3fc'],
  component: ['Source component', '#c4b5fd'],
  worker: ['Cloudflare runtime', '#f6c453'],
  storage: ['Storage and state', '#86efac'],
  external: ['External system', '#f9a8d4'],
  project: ['Project', '#a6a9ff'],
  app: ['App', '#d8b4fe'],
  agent: ['Agent', '#f9a8d4'],
  domain: ['Domain', '#5eead4'],
};

export const relationLabels = {
  source: 'Source', service: 'Service', storage: 'Storage', external: 'External',
  project: 'Project', host: 'Domain',
};

function canonicalUrl(value) {
  const url = new URL(value);
  return url.origin + (url.hostname === 'github.com' ? url.pathname.toLowerCase() : url.pathname).replace(/\/$/, '');
}

export function buildExplorerGraph(snapshot, atlas) {
  const nodes = snapshot.nodes.map(node => ({ ...node, category: node.category || node.kind }));
  const edges = [...snapshot.edges];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const idsByUrl = new Map(nodes.filter(node => node.url).map(node => [canonicalUrl(node.url), node.id]));
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

  for (const region of atlas?.regions ?? []) {
    const parent = idsByUrl.get(canonicalUrl(region.url));
    if (!parent) continue;
    const tags = byId.get(parent).tags;
    for (const item of region.items) {
      const key = canonicalUrl(item.url);
      const existing = idsByUrl.get(key);
      if (existing) {
        connect(parent, existing, 'project');
        continue;
      }
      const slug = item.name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const id = 'atlas-' + region.id + '-' + slug;
      if (byId.has(id)) throw new Error('Duplicate atlas entry: ' + id);
      const category = item.category === 'app' ? 'app' : 'project';
      addNode({
        id, label: item.name, sub: region.name, info: item.description, category, kind: category,
        url: item.url, tags, translated: Object.values(item.translations ?? {}).map(entry => entry.name).join(' '),
      });
      idsByUrl.set(key, id);
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
