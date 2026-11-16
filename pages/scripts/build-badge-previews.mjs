import { mkdir, writeFile, rm } from "node:fs/promises";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";
import { catalogue, onRequestGet, resolve } from "../functions/badge/[[path]].js";

const PREFIX = "/assets/badge-previews/";

// Pinned CDN icons only. Share reads within this build; skip degraded previews.
export async function writeBadgePreviews(dir, fetchImpl = fetch) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const data = catalogue();
  const deadline = AbortSignal.timeout(12000);
  const responses = new Map();
  const iconFetch = async (url, init = {}) => {
    if (!responses.has(url)) responses.set(url, (async () => {
      const response = await fetchImpl(url, {
        ...init,
        signal: AbortSignal.any([deadline, ...(init.signal ? [init.signal] : [])]),
      });
      return { status: response.status, body: await response.text() };
    })());
    const { status, body } = await responses.get(url);
    return new Response(body, { status });
  };

  const rows = data.badges.filter(row => /^[a-z0-9-]+$/.test(row.slug));
  let cursor = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      const request = new Request(data.canonical + row.path);
      const params = { path: [row.slug + ".svg"] };
      if (resolve(params.path, new URLSearchParams())?.kind !== "badge") continue;
      const response = await onRequestGet({ request, params }, iconFetch);
      if (!response.ok || !response.headers.get("cache-control")?.includes("s-maxage=86400")) continue;
      const file = row.slug + ".svg";
      await writeFile(new URL(file, dir), await response.text());
      row.preview = PREFIX + file;
    }
  }));
  await writeFile(new URL("catalogue.json", dir), JSON.stringify(data) + "\n");
  return data;
}

if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  await writeBadgePreviews(new URL("../site/assets/badge-previews/", import.meta.url));
}
