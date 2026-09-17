#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { countTokens as countCl100k } from 'gpt-tokenizer/encoding/cl100k_base';
import { countTokens as countGpt5 } from 'gpt-tokenizer/model/gpt-5';
import { countTokens as countR50k } from 'gpt-tokenizer/encoding/r50k_base';
import { countTokens as countHarmony } from 'gpt-tokenizer/encoding/o200k_harmony';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QMD = path.join(HERE, 'token-worldcup.qmd');
const ANCHOR = 'English';
const CHECK = process.argv.includes('--check');
const DATA_RE = /(<script\b[^>]*\bid=["']token-worldcup-data["'][^>]*>)(.*?)(<\/script>)/s;

const ENCODINGS = [
  { id: 'gpt5', prefix: '', count: countGpt5 },
  { id: 'cl100k', prefix: 'cl100k_', count: countCl100k },
  { id: 'r50k', prefix: 'r50k_', count: countR50k },
  { id: 'harmony', prefix: 'harmony_', count: countHarmony },
];

function loadSource() {
  const source = fs.readFileSync(QMD, 'utf8');
  const match = source.match(DATA_RE);
  if (!match) throw new Error(`${path.basename(QMD)}: token-worldcup-data block not found`);
  const samples = JSON.parse(match[2]);
  if (!Array.isArray(samples) || samples.length === 0) throw new Error('sample array is empty');
  for (const sample of samples) {
    for (const key of ['name', 'lang', 'text']) {
      if (!(key in sample)) throw new Error(`${sample.name ?? '<unknown>'}: missing ${key}`);
    }
  }
  if (!samples.some((sample) => sample.name === ANCHOR)) {
    throw new Error(`${ANCHOR} sample is required as the EN=100 anchor`);
  }
  return { source, match, samples };
}
function annotate(samples, encoding) {
  const counts = samples.map((sample) => encoding.count(sample.text));
  const english = counts[samples.findIndex((sample) => sample.name === ANCHOR)];
  const frequency = new Map();
  for (const count of counts) frequency.set(count, (frequency.get(count) ?? 0) + 1);

  const ordered = counts
    .map((count, index) => ({ count, index, name: samples[index].name }))
    .sort((a, b) => a.count - b.count || a.name.localeCompare(b.name));
  const ranks = new Map();
  let previous;
  let heldRank = 0;
  ordered.forEach((entry, position) => {
    if (entry.count !== previous) {
      previous = entry.count;
      heldRank = position + 1;
    }
    ranks.set(entry.index, heldRank);
  });

  return counts.map((tokens, index) => {
    const score = Math.round((tokens / english) * 100);
    return {
      [`${encoding.prefix}tokens`]: tokens,
      [`${encoding.prefix}rank`]: ranks.get(index),
      [`${encoding.prefix}tied`]: frequency.get(tokens) > 1,
      [`${encoding.prefix}index`]: score,
      [`${encoding.prefix}overhead`]: score - 100,
    };
  });
}

function rebuild(samples) {
  const stats = ENCODINGS.map((encoding) => annotate(samples, encoding));
  return samples.map((sample, index) => ({
    ...sample,
    ...Object.assign({}, ...stats.map((rows) => rows[index])),
  }));
}
function main() {
  const { source, match, samples } = loadSource();
  const rebuilt = rebuild(samples);
  const json = JSON.stringify(rebuilt);
  const next = source.replace(DATA_RE, `$1${json}$3`);

  if (CHECK) {
    if (next !== source) {
      console.error('OpenAI token counts are stale. Run: npm run recount:openai');
      process.exitCode = 1;
      return;
    }
    console.log(`OpenAI token counts current for ${samples.length} samples.`);
    return;
  }

  if (next !== source) fs.writeFileSync(QMD, next, 'utf8');
  const english = rebuilt.find((sample) => sample.name === ANCHOR);
  console.log(`Recounted ${rebuilt.length} samples with gpt-tokenizer.`);
  for (const encoding of ENCODINGS) {
    console.log(`${encoding.id}: English=${english[`${encoding.prefix}tokens`]} tokens`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
