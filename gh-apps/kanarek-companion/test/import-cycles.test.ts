import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';

// esbuild ships with wrangler; its metafile is the real (AST) module graph:
// comments and strings are ignored, type-only imports are erased.
import { build } from 'esbuild';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.d.ts') ? [path] : [];
  });
}

async function importGraph(root: string, entryPoints: string[]): Promise<Map<string, string[]>> {
  const result = await build({
    entryPoints,
    absWorkingDir: root,
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'neutral',
    packages: 'external',
    external: ['cloudflare:*', 'node:*'],
    outdir: 'out',
    logLevel: 'silent',
  });
  const graph = new Map<string, string[]>();
  for (const [file, input] of Object.entries(result.metafile.inputs)) {
    graph.set(file, input.imports.filter((entry) => !entry.external).map((entry) => entry.path));
  }
  return graph;
}

// Tarjan SCC; any component with >1 file is a cycle.
function cycles(graph: Map<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const found: string[][] = [];
  let next = 0;
  const visit = (node: string): void => {
    index.set(node, next);
    low.set(node, next);
    next += 1;
    stack.push(node);
    onStack.add(node);
    for (const dep of graph.get(node) ?? []) {
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
        component.push(member);
      } while (member !== node);
      if (component.length > 1) found.push(component.sort());
    }
  };
  for (const node of graph.keys()) if (!index.has(node)) visit(node);
  return found;
}

test('cycle guard follows side-effect/quoted imports and ignores comments', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cycles-'));
  writeFileSync(join(dir, 'a.ts'), 'import "./b.ts";\nexport const a = 1;\n');
  writeFileSync(join(dir, 'b.ts'), "import './c';\nexport const b = 1;\n");
  writeFileSync(join(dir, 'c.ts'), "/*\nimport './a.ts';\n*/\nimport type { T } from './d.ts';\nexport const c = 1;\n");
  writeFileSync(join(dir, 'd.ts'), "import './a.ts';\nexport type T = 1;\n");
  const entries = ['a.ts', 'b.ts', 'c.ts', 'd.ts'];
  assert.deepEqual(cycles(await importGraph(dir, entries)), []);

  writeFileSync(join(dir, 'c.ts'), "import './a.ts';\nexport const c = 1;\n");
  assert.deepEqual(cycles(await importGraph(dir, entries)), [['a.ts', 'b.ts', 'c.ts']]);
});

test('src has no import cycles', async () => {
  const entries = sourceFiles(SRC).map((file) => relative(ROOT, file));
  assert.deepEqual(cycles(await importGraph(ROOT, entries)), []);
});
