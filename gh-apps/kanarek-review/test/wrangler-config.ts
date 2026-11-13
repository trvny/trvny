import { readFileSync } from 'node:fs';

// JSONC comments and trailing commas, with quoted strings preserved.
const source = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const withoutComments = source.replace(
  /"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
  (match) => match.startsWith('"') ? match : '',
);
const json = withoutComments.replace(
  /"(?:\\.|[^"\\])*"|,(?=\s*[}\]])/g,
  (match) => match.startsWith('"') ? match : '',
);
export const wranglerConfig = JSON.parse(json) as { vars: Record<string, unknown> };
export const wranglerVars = wranglerConfig.vars;
