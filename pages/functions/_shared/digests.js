export async function getDigestPosts(context) {
  try {
    const url = new URL('/przeglad/index.json', context.request.url);
    const response = await context.env.ASSETS.fetch(url.toString());
    if (!response.ok) return [];
    const items = await response.json();
    if (!Array.isArray(items)) return [];
    return items.filter((item) =>
      item && /^\d{4}-\d{2}-\d{2}$/.test(item.id)
      && typeof item.title === 'string' && item.title.trim()
      && typeof item.description === 'string' && item.description.trim()
      && typeof item.date === 'string' && Number.isFinite(Date.parse(item.date))
      && (item.updated === undefined || (typeof item.updated === 'string' && Number.isFinite(Date.parse(item.updated))))
    ).map((item) => ({
      slug: item.id,
      title: item.title,
      summary: item.description,
      date: item.date.slice(0, 10),
      updated: new Date(item.updated ?? item.date).toISOString(),
      kind: 'PRZEGLĄD',
      tags: ['CoCzyDziennik'],
      lang: 'pl',
      digest: true,
    }));
  } catch {
    return [];
  }
}

export function publicationPath(post) {
  const slug = String(post.slug || '');
  if (!/^[a-z0-9-]+$/.test(slug)) return '';
  return `/${post.digest === true ? 'przeglad' : 'teksty'}/${slug}/`;
}

// Newest publication first; edits (`updated`) only break ties within one date.
export function latestFirst(first, second) {
  return (Date.parse(second.date) || 0) - (Date.parse(first.date) || 0)
    || (Date.parse(second.updated) || 0) - (Date.parse(first.updated) || 0);
}
