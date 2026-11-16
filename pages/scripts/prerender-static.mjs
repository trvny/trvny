import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { argv } from "node:process";
import { NAV_HEAD, NAV_BODY } from "../functions/_shared/navigation.js";
import { pageSeoHead } from "../functions/_shared/page-seo.js";

const ORIGIN = "https://travny.pages.dev";
const PAGES = [
  { path: "/teksty/githubowa-kraina/", lang: "pl", markdown: true },
  { path: "/teksty/githubowa-kraina/universe", lang: "en" },
  { path: "/teksty/token-worldcup/", lang: "pl", canonical: true },
  { path: "/teksty/token-worldcup/effort-matrix", lang: "pl" },
  { path: "/papagenerator/", lang: "en", canonical: true },
  { path: "/badges/", lang: "pl" },
];

export function staticAliases(path) {
  if (path.endsWith("/")) {
    const base = path.slice(0, -1);
    return [base, path, path + "index", path + "index.html"];
  }
  return [path, path + ".html"];
}

export function decorateStaticPage(html, page) {
  // Only our marked additions are replaced on repeated builds.
  const clean = html.replace(/<!-- hub-static-(head|body):start -->[\s\S]*?<!-- hub-static-\1:end -->/g, "");
  const canonical = page.canonical && !/<link\b[^>]*\brel=["']canonical["']/i.test(clean)
    ? '<link rel="canonical" href="' + ORIGIN + page.path + '">' : "";
  const og = page.path === "/teksty/token-worldcup/" && !/<meta\b[^>]*\bproperty=["']og:url["']/i.test(clean)
    ? '<meta property="og:url" content="' + ORIGIN + page.path + '">' : "";
  const head = NAV_HEAD + pageSeoHead(page.path) + canonical + og;
  // Checked-in/generated templates have explicit closing tags. Reject malformed output.
  if ([...clean.matchAll(/<\/head\s*>/gi)].length !== 1) throw new Error(page.path + ": expected exactly one closing head tag");
  if ([...clean.matchAll(/<\/body\s*>/gi)].length !== 1) throw new Error(page.path + ": expected exactly one closing body tag");
  const insert = (tag, value) => "<!-- hub-static-" + tag + ":start -->" + value + "<!-- hub-static-" + tag + ":end -->";
  return clean
    .replace(/<\/head\s*>/i, tag => insert("head", head) + tag)
    .replace(/<\/body\s*>/i, tag => insert("body", NAV_BODY) + tag);
}

export async function prerenderStatic(site, baseRoutes) {
  const routes = { ...baseRoutes, exclude: [...baseRoutes.exclude] };
  // Production deployment hashes also live on a prefixed host, not the canonical host.
  const headers = ['https://:version.travny.pages.dev/*\n  X-Robots-Tag: noindex, follow'];
  for (const page of PAGES) {
    const file = new URL(page.path.slice(1) + (page.path.endsWith("/") ? "index.html" : ".html"), site);
    const html = await readFile(file, "utf8");
    await writeFile(file, decorateStaticPage(html, page));
    const link = (page.markdown ? "<" + page.path + "index.md>; rel=\"alternate\"; type=\"text/markdown\", " : "") + '</llms.txt>; rel="describedby"';
    for (const alias of staticAliases(page.path)) {
      routes.exclude.push(alias);
      headers.push(alias + "\n  Content-Language: " + page.lang + "\n  Link: " + link);
    }
  }
  routes.exclude = [...new Set(routes.exclude)];
  if (routes.include.length + routes.exclude.length > 100) throw new Error("Pages route limit exceeded");
  await writeFile(new URL("_routes.json", site), JSON.stringify(routes, null, 2) + "\n");
  await writeFile(new URL("_headers", site), headers.join("\n\n") + "\n");
  return routes;
}

if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  const baseRoutes = JSON.parse(await readFile(new URL("../routes.json", import.meta.url), "utf8"));
  await prerenderStatic(new URL("../site/", import.meta.url), baseRoutes);
}
