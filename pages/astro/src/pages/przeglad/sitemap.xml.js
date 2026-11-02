import { getCollection } from 'astro:content';

export async function GET() {
  const issues = await getCollection('digests', ({ data }) => !data.draft);
  const entries = issues.map((issue) => {
    const url = new URL(`/przeglad/${encodeURIComponent(issue.id)}/`, 'https://travny.pages.dev');
    return `<url><loc>${url.href}</loc><lastmod>${issue.data.date.toISOString().slice(0, 10)}</lastmod></url>`;
  }).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}</urlset>`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}
