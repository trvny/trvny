import { getCollection } from 'astro:content';

export async function GET() {
  const issues = await getCollection('digests', ({ data }) => !data.draft);
  const items = issues.map(({ id, data }) => ({
    id,
    title: data.title,
    description: data.description,
    date: data.date.toISOString(),
    updated: (data.updated ?? data.date).toISOString(),
  }));
  return new Response(JSON.stringify(items), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
