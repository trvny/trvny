import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import test from 'node:test';

const SRC = new URL('../src/', import.meta.url).pathname;
// Static relative imports/exports, with or without `from` (side-effect form), any quote.
const IMPORT_RE = /(?:^|[\n;])\s*(?:import|export)\b(?:[^'";]*?\bfrom)?\s*(['"])(\.[^'"]+)\1/g;

function resolveImport(from: string, specifier: string): string {
  const path = normalize(join(dirname(from), specifier));
  return path.endsWith('.ts') ? path : `${path}.ts`;
}

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
    graph.set(file, [...text.matchAll(IMPORT_RE)].map((m) => resolveImport(file, m[2])));
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

test('import extractor sees side-effect, double-quoted and extensionless imports', () => {
  const text = [
    "import './a.ts';",
    'import { b } from "./b.ts";',
    "export * from './c';",
    "import type { D } from './d.ts';",
  ].join('\n');
  assert.deepEqual(
    [...text.matchAll(IMPORT_RE)].map((m) => resolveImport('/src/x.ts', m[2])),
    ['/src/a.ts', '/src/b.ts', '/src/c.ts', '/src/d.ts'],
  );
});

test('src has no import cycles', () => {
  assert.deepEqual(importCycles(), []);
});
