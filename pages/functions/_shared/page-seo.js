const ORIGIN = "https://travny.pages.dev";

const home = [{ name: "TRAVNY", path: "/" }];
const texts = [...home, { name: "Teksty", path: "/teksty/" }];
const tokenCup = [...texts, { name: "Tokenowy Mundial AI", path: "/teksty/token-worldcup/" }];
const githubWorld = [...texts, { name: "GitHubowa Kraina", path: "/teksty/githubowa-kraina/" }];

const trails = {
  "/tv/": [...home, { name: "TVPI", path: "/tv/" }],
  "/papagenerator/": [...home, { name: "Papagenerator", path: "/papagenerator/" }],
  "/teksty/": texts,
  "/teksty/token-worldcup/": tokenCup,
  "/teksty/token-worldcup/effort-matrix": [...tokenCup, { name: "Model × effort", path: "/teksty/token-worldcup/effort-matrix" }],
  "/teksty/githubowa-kraina/": githubWorld,
  "/teksty/githubowa-kraina/universe": [...githubWorld, { name: "Universe", path: "/teksty/githubowa-kraina/universe" }],
  "/teksty/grass-mud-horse/": [...texts, { name: "Alpaka, krab i Wielki Harmonizator", path: "/teksty/grass-mud-horse/" }],
};

const NOINDEX = new Set(["/teksty/token-worldcup/effort-matrix"]);

function canonicalPath(pathname) {
  if (pathname === "/teksty/token-worldcup/token-worldcup.html" || pathname === "/teksty/token-worldcup/token-worldcup") {
    return "/teksty/token-worldcup/";
  }
  if (pathname.endsWith("/index.html")) return pathname.slice(0, -"index.html".length);
  if (pathname.endsWith(".html")) return pathname.slice(0, -".html".length);
  if (trails[pathname]) return pathname;
  if (!pathname.endsWith("/")) return pathname + "/";
  return pathname;
}

export function pageSeoHead(pathname) {
  const path = canonicalPath(pathname);
  const trail = trails[path];
  if (!trail) return "";
  const schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map(({ name, path: item }, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name,
      item: ORIGIN + item,
    })),
  };
  const breadcrumb = `<script type="application/ld+json">${JSON.stringify(schema)}</script>`;
  // Working pages: reachable from their parent, kept out of search; no canonical.
  if (NOINDEX.has(path)) return `<meta name="robots" content="noindex,follow">${breadcrumb}`;
  return breadcrumb;
}
