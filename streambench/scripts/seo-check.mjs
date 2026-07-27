import { readFile } from "node:fs/promises";

const publicUrl = new URL("../public/", import.meta.url);

async function text(path) {
  return readFile(new URL(path, publicUrl), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [index, robots, sitemap, llms, manifestSource, socialImage] = await Promise.all([
  text("index.html"),
  text("robots.txt"),
  text("sitemap.xml"),
  text("llms.txt"),
  text("site.webmanifest"),
  text("og.svg"),
]);

const origin = "https://streambench.travny.workers.dev";
assert(index.includes(`<link rel="canonical" href="${origin}/">`), "canonical URL is missing");
assert(index.includes(`<meta property="og:url" content="${origin}/">`), "Open Graph URL is missing");
assert(index.includes(`<meta name="twitter:card" content="summary_large_image">`), "Twitter card is missing");
assert(index.includes("max-image-preview:large"), "crawler preview directives are missing");
assert(index.includes(`<link rel="sitemap" type="application/xml" href="/sitemap.xml">`), "sitemap link is missing");
assert(index.includes(`<link rel="alternate" type="text/plain" href="/llms.txt"`), "llms.txt link is missing");

assert(robots.includes(`Sitemap: ${origin}/sitemap.xml`), "robots sitemap URL is missing");
assert(robots.includes("Disallow: /api/"), "API crawler rule is missing");
assert(sitemap.includes(`<loc>${origin}/</loc>`), "sitemap application URL is missing");
assert(llms.includes("# Streambench"), "llms.txt title is missing");
assert(llms.includes("https://tvpi.pages.dev/"), "TRAVNY hub is missing from llms.txt");

const manifest = JSON.parse(manifestSource);
assert(manifest.id === "/", "manifest id is missing");
assert(manifest.lang === "pl", "manifest language is missing");
assert(manifest.categories?.includes("utilities"), "manifest category is missing");
assert(socialImage.includes('viewBox="0 0 1200 630"'), "social preview dimensions are invalid");

console.log("SEO and discovery checks passed");
