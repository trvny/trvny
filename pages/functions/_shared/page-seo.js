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
  "/teksty/token-worldcup/effort-matrix.html": [...tokenCup, { name: "Model × effort", path: "/teksty/token-worldcup/effort-matrix.html" }],
  "/teksty/githubowa-kraina/": githubWorld,
  "/teksty/githubowa-kraina/universe.html": [...githubWorld, { name: "Universe", path: "/teksty/githubowa-kraina/universe.html" }],
  "/teksty/grass-mud-horse/": [...texts, { name: "The Alpaca, the Crab and the Censor", path: "/teksty/grass-mud-horse/" }],
  "/teksty/grass-mud-horse-pl/": [...texts, { name: "Alpaka, krab i Wielki Harmonizator", path: "/teksty/grass-mud-horse-pl/" }],
};

function canonicalPath(pathname) {
  if (pathname === "/teksty/token-worldcup/token-worldcup.html" || pathname === "/teksty/token-worldcup/token-worldcup") {
    return "/teksty/token-worldcup/";
  }
  if (pathname.endsWith("/index.html")) return pathname.slice(0, -"index.html".length);
  if (!pathname.endsWith("/") && !pathname.endsWith(".html")) return pathname + "/";
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
  if (path !== "/teksty/token-worldcup/effort-matrix.html") return breadcrumb;
  // The Quarto page has no canonical metadata; its URL is distinct from the report.
  const canonical = ORIGIN + path;
  return `<link rel="canonical" href="${canonical}"><meta property="og:url" content="${canonical}">${breadcrumb}`;
}
