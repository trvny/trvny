import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import test from 'node:test';

const SRC = new URL('../src/', import.meta.url).pathname;
const IMPORT_RE = /(?:import|export)\s[^;]*?from\s+'(\.[^']+)'/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

// Tarjan SCC over relative imports; any component with >1 file is a cycle.
function importCycles(): string[][] {
  const graph = new Map<string, string[]>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    graph.set(file, [...text.matchAll(IMPORT_RE)].map((m) => normalize(join(dirname(file), m[1]))));
  }
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];
  let next = 0;
  const visit = (node: string): void => {
    index.set(node, next);
    low.set(node, next);
    next += 1;
    stack.push(node);
    onStack.add(node);
    for (const dep of graph.get(node) ?? []) {
      if (!graph.has(dep)) continue;
      if (!index.has(dep)) {
        visit(dep);
        low.set(node, Math.min(low.get(node)!, low.get(dep)!));
      } else if (onStack.has(dep)) {
        low.set(node, Math.min(low.get(node)!, index.get(dep)!));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member.slice(SRC.length));
      } while (member !== node);
      if (component.length > 1) cycles.push(component.sort());
    }
  };
  for (const node of graph.keys()) if (!index.has(node)) visit(node);
  return cycles;
}

test('src has no import cycles', () => {
  assert.deepEqual(importCycles(), []);
});
