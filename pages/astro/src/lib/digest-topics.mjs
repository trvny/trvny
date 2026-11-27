const markdownTopics = [
  [/^najważniejsze\b/u, ['news']],
  [/^polska i świat\b/u, ['poland', 'world']],
  [/^polska\b/u, ['poland']],
  [/^świat\b/u, ['world']],
  [/^nauka i kosmos\b/u, ['science']],
  [/^ai i technologie\b/u, ['ai']],
  [/^gry i rozrywka\b/u, ['games']],
  [/^piłka nożna\b/u, ['football']],
  [/^(?:motoryzacja|auta)\b/u, ['cars']],
  [/^muzyka\b/u, ['music']],
  [/^filmy i seriale\b/u, ['film']],
  [/^chrzanów i okolice\b/u, ['local']],
  [/^memy\b/u, ['memes']],
  [/^freebies\b/u, ['freebies']],
  [/^pogoda\b/u, ['weather']],
];

export function digestTopics(headings, sections = []) {
  const topics = new Set(sections.map(section => section.kind));
  for (const heading of headings) {
    if (heading.depth !== 2) continue;
    const title = heading.text.toLowerCase().replace(/^[^\p{Letter}]+/u, '');
    const match = markdownTopics.find(([prefix]) => prefix.test(title));
    if (match) for (const topic of match[1]) topics.add(topic);
  }
  return [...topics];
}
