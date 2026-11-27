import { defineCollection } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';

import { isHttpsUrl, isDigestMediaUrl, digestEmbed } from './lib/digest-magazine.mjs';

const text = z.string().trim().min(1);
const link = z.object({ label: text, url: text.refine(isHttpsUrl) });
const fact = z.object({ label: text, value: text });
const sectionKind = z.enum(["news","memes","freebies","cars","timeline","data","poland","world","science","ai","games","football","music","film","local","weather","gallery"]);
const media = z.object({
  kind: z.enum(['image', 'video', 'embed']).default('image'),
  src: text,
  alt: text,
  credit: text,
  source: text.refine(isHttpsUrl).optional(),
  aspect: z.enum(['wide', 'square', 'portrait']).optional(),
  transcript: text.optional(),
}).refine(item => item.kind === 'embed' ? Boolean(digestEmbed(item.src)) : isDigestMediaUrl(item.src), {
  message: 'Use a supported official source URL or a valid digest media URL.',
}).refine(item => item.kind !== 'embed' || item.aspect === undefined, {
  message: 'Embeds use provider-specific dimensions; omit aspect.',
}).refine(item => item.kind !== 'video' || Boolean(item.transcript), {
  message: 'Video requires a transcript or description of meaningful audio and visuals.',
});
const card = z.object({
  title: text,
  body: text.optional(),
  media: media.optional(),
  gallery: z.array(media).max(8).optional(),
  kicker: text.optional(),
  quote: z.object({ text, attribution: text }).optional(),
  score: z.object({ home: text, away: text, result: text, detail: text.optional() }).optional(),
  price: text.optional(),
  previousPrice: text.optional(),
  deadline: text.optional(),
  facts: z.array(fact).max(12).optional(),
  links: z.array(link).max(10).optional(),
});
const magazine = z.object({
  cover: media.optional(),
  stats: z.array(fact).max(6).optional(),
  sections: z.array(z.object({
    kind: sectionKind,
    layout: z.enum(['grid', 'list', 'feature']).default('grid'),
    gallery: z.array(media).max(12).optional(),
    table: z.object({
      title: text,
      columns: z.array(text).min(2).max(8),
      rows: z.array(z.array(text).min(2).max(8)).min(1).max(30),
    }).refine(table => table.rows.every(row => row.length === table.columns.length), {
      message: 'Table rows must match column count.',
    }).optional(),
    title: text,
    intro: text.optional(),
    cards: z.array(card).max(30).optional(),
    chart: z.object({
      title: text,
      unit: text,
      source: link.optional(),
      items: z.array(z.object({ label: text, value: z.number().finite().nonnegative() })).min(1).max(20),
    }).optional(),
    note: text.optional(),
  })).max(20).optional(),
  note: text.optional(),
});

const digests = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/digests' }),
  schema: z.object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    date: z.coerce.date(),
    updated: z.coerce.date().optional(),
    draft: z.boolean().default(false),
    magazine: magazine.optional(),
  }),
});

const texts = defineCollection({
  loader: file('../site/teksty/posts.json', {
    parser: content => JSON.parse(content).map(post => ({ ...post, id: post.slug })),
  }),
  schema: z.object({
    slug: z.string().regex(/^[a-z0-9-]+$/),
    title: text,
    summary: text,
    date: text,
    updated: text.optional(),
    published: text.optional(),
    kind: text,
    tags: z.array(text).default([]),
    lang: text.optional(),
    titleLang: text.optional(),
    featured: z.boolean().default(false),
  }),
});

export const collections = { digests, texts };
