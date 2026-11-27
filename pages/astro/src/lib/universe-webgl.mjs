import Graph from 'graphology';
import Sigma from 'sigma';
import { nodeKinds } from '../../../site/assets/universe-data.js';

const edgeColors = { source: '#71839c', service: '#f6c453', storage: '#86efac', external: '#f9a8d4', project: '#a6a9ff', host: '#5eead4' };

export function mountWebGL(container, data, { select, reset, unavailable }) {
  const graph = new Graph({ type: 'directed', multi: true, allowSelfLoops: false });
  for (const node of data.nodes) {
    graph.addNode(node.id, {
      x: node.x, y: -node.y, label: node.label,
      size: node.category === 'repo' ? 8 : 5,
      color: nodeKinds[node.category]?.[1] ?? '#a6b1c4',
    });
  }
  for (const [from, to, kind] of data.edges) {
    graph.addDirectedEdge(from, to, { kind, color: edgeColors[kind], size: 1 });
  }

  let visible = null;
  let selected = null;
  let relation = '';
  let neighborhood = new Set();
  const canvas = new Sigma(graph, container, {
    labelFont: 'system-ui, sans-serif',
    labelSize: 13,
    labelColor: { color: '#eef2f7' },
    labelRenderedSizeThreshold: 6,
    defaultDrawNodeHover: () => {},
    minCameraRatio: 0.10,
    maxCameraRatio: 2.5,
    nodeReducer(id, attributes) {
      if (visible && !visible.has(id)) return { ...attributes, hidden: true };
      if (id === selected) return { ...attributes, size: attributes.size + 3, forceLabel: true, zIndex: 3 };
      if (selected && !neighborhood.has(id)) return { ...attributes, color: '#3a485a', label: '' };
      return attributes;
    },
    edgeReducer(id, attributes) {
      const [source, target] = graph.extremities(id);
      if (visible && (!visible.has(source) || !visible.has(target))) return { ...attributes, hidden: true };
      if (relation && attributes.kind !== relation) return { ...attributes, hidden: true };
      if (selected && source !== selected && target !== selected) return { ...attributes, color: '#354154' };
      if (selected) return { ...attributes, size: 2.5, zIndex: 2 };
      return attributes;
    },
    zIndex: true,
  });
  canvas.on('clickNode', ({ node }) => select(node));
  canvas.on('clickStage', reset);
  const lost = event => {
    event.preventDefault();
    unavailable();
  };
  const layers = Object.values(canvas.getCanvases());
  for (const layer of layers) layer.addEventListener('webglcontextlost', lost, { once: true });

  const camera = canvas.getCamera();
  return {
    update(next) {
      visible = next.visible;
      selected = next.selected;
      relation = next.relation;
      neighborhood = selected ? new Set(graph.neighbors(selected)) : new Set();
      canvas.refresh();
    },
    zoom(factor) {
      const ratio = Math.max(0.10, Math.min(2.5, camera.getState().ratio * factor));
      camera.setState({ ratio });
    },
    focus(id) {
      const position = canvas.getNodeDisplayData(id);
      if (position) camera.setState({ x: position.x, y: position.y });
    },
    fit() {
      camera.setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
    },
    resize() {
      canvas.refresh();
    },
    destroy() {
      for (const layer of layers) layer.removeEventListener('webglcontextlost', lost);
      canvas.kill();
    },
  };
}
