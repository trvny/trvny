'use strict';

const { randomInt } = require('node:crypto');

const START_MARKER = '<!--STARTS_HERE_QUOTE_README-->';
const END_MARKER = '<!--ENDS_HERE_QUOTE_README-->';
const DEFAULT_GIST_ID = '167d2271e3cf7d21e118aa7d906a7d2c';
const UPSTREAM_BASE =
  'https://raw.githubusercontent.com/offensive-vk/auto-update-quote/v7';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function decodeHtml(value) {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function normalize(value) {
  return value
    .normalize('NFKC')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[❝❞“”„«»]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pl');
}

function cleanLine(value) {
  let line = value.trim();
  if (!line || /^```/.test(line) || /^#{1,6}\s/.test(line)) {
    return null;
  }

  line = line
    .replace(/^>\s?/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/^\|\s*/, '')
    .replace(/\s*\|$/, '')
    .trim();

  if (/^https?:\/\/\S+$/i.test(line) || line.length < 8 || line.length > 600) {
    return null;
  }

  return line;
}

function fromStructuredValue(value) {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(fromStructuredValue);
  }
  if (!value || typeof value !== 'object') {
    return [];
  }

  const text = value.quote ?? value.text ?? value.content ?? value.fact;
  if (typeof text === 'string') {
    const author = value.author ?? value.source ?? value.by;
    return [author ? `${text} — ${author}` : text];
  }

  const preferred = value.quotes ?? value.facts ?? value.items ?? value.entries;
  if (preferred) {
    return fromStructuredValue(preferred);
  }

  return Object.values(value).flatMap(fromStructuredValue);
}

function parseCandidates(content) {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed);
    const structured = fromStructuredValue(parsed)
      .map(cleanLine)
      .filter(Boolean);
    if (structured.length > 0) {
      return structured;
    }
  } catch {
    // Plain text and Markdown are handled below.
  }

  const paragraphs = trimmed
    .split(/\n\s*\n+/)
    .map((block) => block.split('\n').map(cleanLine).filter(Boolean).join(' '))
    .map(cleanLine)
    .filter(Boolean);

  const lines = trimmed.split('\n').map(cleanLine).filter(Boolean);
  return [...paragraphs, ...lines];
}

function deduplicate(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = normalize(value);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function fetchText(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GET ${url} returned ${response.status}`);
  }
  return response.text();
}

async function fetchGistCandidates(gistId, token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'trvny-readme-quote',
    'X-GitHub-Api-Version': '2026-03-10',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers,
  });
  if (!response.ok) {
    throw new Error(`Gist API returned ${response.status}`);
  }

  const gist = await response.json();
  const candidates = [];
  for (const file of Object.values(gist.files ?? {})) {
    let content = file.content ?? '';
    if (file.truncated && file.raw_url) {
      content = await fetchText(file.raw_url, headers);
    }
    candidates.push(...parseCandidates(content));
  }
  return deduplicate(candidates);
}

function currentQuote(readme) {
  const pattern = new RegExp(
    `${escapeRegExp(START_MARKER)}([\\s\\S]*?)${escapeRegExp(END_MARKER)}`,
  );
  const match = readme.match(pattern);
  return match ? normalize(decodeHtml(match[1])) : '';
}

function pickSource(sources) {
  const available = sources.filter((source) => source.items.length > 0);
  if (available.length === 0) {
    throw new Error('No quote or fact candidates were loaded');
  }
  return available[randomInt(available.length)];
}

function pickItem(items, previous) {
  const fresh = items.filter((item) => normalize(item) !== previous);
  const pool = fresh.length > 0 ? fresh : items;
  return pool[randomInt(pool.length)];
}

module.exports = async function updateReadmeQuote({ github, context, core }) {
  const { owner, repo } = context.repo;
  const gistId = process.env.GIST_ID || DEFAULT_GIST_ID;
  const readmePath = process.env.README_PATH || 'README.md';

  const repository = await github.rest.repos.get({ owner, repo });
  const branch = repository.data.default_branch;
  const response = await github.rest.repos.getContent({
    owner,
    repo,
    path: readmePath,
    ref: branch,
  });

  if (Array.isArray(response.data) || response.data.type !== 'file') {
    throw new Error(`${readmePath} is not a file`);
  }

  const readme = Buffer.from(response.data.content, 'base64').toString('utf8');
  const markerPattern = new RegExp(
    `${escapeRegExp(START_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}`,
  );
  if (!markerPattern.test(readme)) {
    throw new Error(`README markers are missing from ${readmePath}`);
  }

  const sources = [];
  try {
    sources.push({
      name: 'personal gist',
      items: await fetchGistCandidates(gistId, process.env.GIST_TOKEN),
    });
  } catch (error) {
    core.warning(`Personal gist unavailable: ${error.message}`);
  }

  for (const [name, path] of [
    ['upstream quotes', 'quotes/quotes.txt'],
    ['upstream fun facts', 'funfacts/funfacts.txt'],
  ]) {
    try {
      const content = await fetchText(`${UPSTREAM_BASE}/${path}`);
      sources.push({ name, items: deduplicate(parseCandidates(content)) });
    } catch (error) {
      core.warning(`${name} unavailable: ${error.message}`);
    }
  }

  const source = pickSource(sources);
  const quote = pickItem(source.items, currentQuote(readme));
  const replacement = [
    START_MARKER,
    `<i>❝${escapeHtml(quote)}❞</i>`,
    END_MARKER,
  ].join('\n');
  const updated = readme.replace(markerPattern, replacement);

  if (updated === readme) {
    core.info('Selected text already matches README; nothing to commit.');
    return;
  }

  await github.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: readmePath,
    branch,
    message: 'chore(readme): rotate quote',
    content: Buffer.from(updated, 'utf8').toString('base64'),
    sha: response.data.sha,
  });

  core.info(`README updated from ${source.name} (${source.items.length} items).`);
};
