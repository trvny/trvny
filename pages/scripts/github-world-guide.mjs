import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../site/teksty/githubowa-kraina/', import.meta.url);
const { regions } = JSON.parse(await readFile(new URL('atlas.json', root), 'utf8'));
const lines = [
  '# GitHubowa Kraina', '',
  '> An interactive atlas of public trvny and travnie projects.', '',
  'Page: https://travny.pages.dev/teksty/githubowa-kraina/',
  'Structured region data: https://travny.pages.dev/teksty/githubowa-kraina/atlas.json',
  'Infrastructure map: https://travny.pages.dev/teksty/githubowa-kraina/universe.html', '',
  'Choose a region, then a place for its description and destination. Project repositories remain the authority for current details.', '',
  '## Regions', ''
];
for (const region of regions) {
  lines.push(`### ${region.name}`, '', region.description, '', `Project: ${region.url}`, '');
  for (const item of region.items) lines.push(`- [${item.name}](${item.url}): ${item.description}`);
  lines.push('');
}
lines.push('## Other routes', '',
  '- [.ai](https://github.com/trvny/.ai): portable AI profiles, instructions, adapters and skills.',
  '- [WiFi-Automatic](https://github.com/trvny/WiFi-Automatic): maintained Android Wi-Fi automation fork.',
  '- [trvny](https://github.com/trvny) and [travnie](https://github.com/travnie): GitHub profile and organization.', '');
const output = lines.join('\n');
const destination = new URL('index.md', root);
if (process.argv.includes('--check')) {
  if (await readFile(destination, 'utf8') !== output) {
    console.error('GitHubowa Kraina guide is stale; run node pages/scripts/github-world-guide.mjs');
    process.exitCode = 1;
  }
} else await writeFile(destination, output);
