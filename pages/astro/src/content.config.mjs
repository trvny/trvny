import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

import { isHttpsUrl, isDigestMediaUrl } from './lib/digest-magazine.mjs';

const text = z.string().trim().min(1);
const link = z.object({ label: text, url: text.refine(isHttpsUrl) });
const fact = z.object({ label: text, value: text });
const media = z.object({
  kind: z.enum(['image', 'video']).default('image'),
  src: text.refine(isDigestMediaUrl),
  alt: text,
  credit: text,
  source: text.refine(isHttpsUrl).optional(),
});
const card = z.object({
  title: text,
  body: text.optional(),
  media: media.optional(),
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
    kind: z.enum(['news', 'memes', 'freebies', 'cars', 'timeline', 'data']),
    title: text,
    intro: text.optional(),
    cards: z.array(card).max(30).optional(),
    chart: z.object({
      title: text,
      unit: text,
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

export const collections = { digests };
