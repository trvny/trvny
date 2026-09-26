// One-off codemod: replace equivalent local copies of shared helpers in
// <src>/*.ts with imports from <src>/tools/common.ts. A copy is removed only when
// its whitespace-normalized source matches a known-equivalent form; anything
// else is left alone and listed. Idempotent: a second run changes nothing.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = process.argv[2];
if (!SRC) throw new Error('usage: node codemod-dedupe-helpers.ts <src dir>');
const COMMON = './tools/common.ts';

interface Helper {
  name: string;
  exportName: string;
  matches: (normalized: string) => boolean;
}

const same = (...forms: string[]) => (normalized: string) => forms.includes(normalized);

const HELPERS: Helper[] = [
  {
    name: 'isObject',
    exportName: 'isObject',
    matches: same(
      "function isObject(value: unknown): value is JsonObject { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }",
    ),
  },
  {
    name: 'repoPath',
    exportName: 'repoPath',
    matches: (normalized) =>
      /^function repoPath\((\w+): string\): string \{ return \1\.split\('\/'\)\.map\((?:encodeURIComponent|\(part\) => encodeURIComponent\(part\))\)\.join\('\/'\); \}$/.test(
        normalized,
      ),
  },
  {
    name: 'stringValue',
    exportName: 'stringOrNull',
    matches: same("function stringValue(value: unknown): string | null { return typeof value === 'string' ? value : null; }"),
  },
  {
    name: 'numberValue',
    exportName: 'numberOrNull',
    matches: same(
      "function numberValue(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }",
    ),
  },
  {
    name: 'internalRequest',
    exportName: 'internalRequest',
    matches: (normalized) =>
      [
        'function internalRequest(source: Request, pathname: string, body: JsonObject): Request {',
        'function internalRequest(source: Request, pathname: string, body: JsonObject = {}): Request {',
      ].some((head) => normalized.startsWith(head)) &&
      normalized.endsWith(
        "{ const url = new URL(source.url); url.pathname = pathname; url.search = ''; const headers = new Headers(source.headers); headers.set('content-type', 'application/json'); headers.delete('content-length'); return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) }); }",
      ),
  },
];

const JSON_OBJECT_LINE = 'type JsonObject = Record<string, unknown>;';

function normalize(block: string): string {
  return block.replace(/\s+/g, ' ').replace(/ \./g, '.').replace(/\( /g, '(').replace(/ \)/g, ')').trim();
}

function removeBlock(lines: string[], start: number, end: number): void {
  const before = start > 0 && lines[start - 1].trim() === '';
  const after = end + 1 < lines.length && lines[end + 1].trim() === '';
  lines.splice(before && after ? start - 1 : start, end - start + 1 + (before && after ? 1 : 0));
}

function findBlock(lines: string[], name: string): [number, number] | null {
  const start = lines.findIndex((line) => line.startsWith(`function ${name}(`));
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && line === '}');
  return end < 0 ? null : [start, end];
}

function importEnd(lines: string[]): number {
  let last = -1;
  let inImport = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!inImport && line.startsWith('import ')) inImport = true;
    if (inImport) {
      if (/from ['"][^'"]+['"];\s*$/.test(line) || /^import ['"][^'"]+['"];\s*$/.test(line)) {
        last = index;
        inImport = false;
      }
      continue;
    }
    if (line.trim() !== '' && !line.startsWith('//')) break;
  }
  return last;
}

function uses(text: string, name: string): boolean {
  return new RegExp(`(?<![\\w$.])${name}(?![\\w$])`).test(text);
}

const report: string[] = [];
let removedLines = 0;

for (const file of readdirSync(SRC).filter((entry) => entry.endsWith('.ts')).sort()) {
  const path = join(SRC, file);
  const original = readFileSync(path, 'utf8');
  const lines = original.split('\n');
  const imported = new Set<string>();
  const renames: [string, string][] = [];

  for (const helper of HELPERS) {
    const block = findBlock(lines, helper.name);
    if (!block) continue;
    const source = lines.slice(block[0], block[1] + 1).join('\n');
    if (!helper.matches(normalize(source))) {
      report.push(`kept ${file}: ${helper.name} (differs)`);
      continue;
    }
    removedLines += block[1] - block[0] + 1;
    removeBlock(lines, block[0], block[1]);
    imported.add(helper.exportName);
    if (helper.name !== helper.exportName) renames.push([helper.name, helper.exportName]);
  }

  const typeLine = lines.indexOf(JSON_OBJECT_LINE);
  if (typeLine >= 0) {
    removedLines += 1;
    removeBlock(lines, typeLine, typeLine);
  }

  if (!imported.size && typeLine < 0) continue;

  let text = lines.join('\n');
  for (const [from, to] of renames) {
    text = text.replace(new RegExp(`(?<![\\w$.])${from}(?![\\w$])`, 'g'), to);
  }

  const needed = [...imported].filter((name) => uses(text, name));
  const needType = typeLine >= 0 || imported.has('isObject') || imported.has('internalRequest');
  const wantsType = needType && uses(text, 'JsonObject');

  const body = text.split('\n');
  const existing = body.findIndex((line) => line.includes(`from '${COMMON}';`) && line.startsWith('import {'));
  if (existing >= 0) {
    const match = /^import \{ (.*) \} from/.exec(body[existing]);
    if (!match) throw new Error(`${file}: unsupported multi-line import from ${COMMON}`);
    const names = new Set(match[1].split(',').map((part) => part.trim()).filter(Boolean));
    for (const name of needed) names.add(name);
    if (wantsType && !names.has('JsonObject') && !names.has('type JsonObject')) names.add('type JsonObject');
    const ordered = [...names].sort((a, b) => a.replace(/^type /, '').localeCompare(b.replace(/^type /, '')));
    body[existing] = `import { ${ordered.join(', ')} } from '${COMMON}';`;
  } else if (needed.length || wantsType) {
    const names = [...needed, ...(wantsType ? ['type JsonObject'] : [])].sort((a, b) =>
      a.replace(/^type /, '').localeCompare(b.replace(/^type /, '')),
    );
    const at = importEnd(body);
    body.splice(at + 1, 0, ...(at < 0 ? [`import { ${names.join(', ')} } from '${COMMON}';`, ''] : [`import { ${names.join(', ')} } from '${COMMON}';`]));
  }

  const next = body.join('\n');
  if (next !== original) {
    writeFileSync(path, next);
    report.push(`updated ${file}: ${[...imported].join(', ') || 'JsonObject'}`);
  }
}

console.log(report.join('\n'));
console.log(`removed ${removedLines} duplicated lines`);
