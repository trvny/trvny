import { getLatestShitpost, REACTOR_HOME_URL } from "../_shared/shitpost.js";
import { serviceFetch } from "../_shared/service-fetch.js";
import { publicationLang } from "../_shared/publication-lang.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderShitpostCard(post) {
  const tags = post.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  const meta = post.date ? `<div class="meta">${escapeHtml(post.date)}</div>` : "";
  const caption = escapeHtml(post.excerpt).replaceAll("\n", "<br>");
  return `<a class="card" href="${REACTOR_HOME_URL}">
<span class="go">REACTOR ↗</span>
${meta}
<h2 lang="${publicationLang(post.titleLang ?? post.lang)}">${escapeHtml(post.title)}</h2>
${post.excerpt ? `<p lang="${publicationLang(post.lang)}">${caption}</p>` : ""}
<div class="tags">${tags}</div>
</a>`;
}

export async function onRequest(context) {
  const response = await context.env.ASSETS.fetch(context.request);
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.includes("text/html")) return response;

  const shitpost = await getLatestShitpost(serviceFetch(context, "REACTOR_SERVICE"));
  return shitpost ? new globalThis.HTMLRewriter().on("#text-list", {
    element(element) {
      element.before(renderShitpostCard(shitpost), { html: true });
    },
  }).transform(response) : response;
}
