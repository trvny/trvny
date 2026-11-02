import { getDigestPosts, latestFirst, publicationPath } from "../_shared/digests.js";
import { getLatestShitpost } from "../_shared/shitpost.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderCard(post) {
  const path = publicationPath(post);
  if (!path) return "";
  const featured = post.featured === true ? '<span class="tag">FEATURED</span>' : "";
  const tags = (post.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  return `<a class="card" href="${path}">
<span class="go">OTWÓRZ ›</span>
<div class="meta">${escapeHtml(post.date)} · ${escapeHtml(post.kind)}</div>
<h2>${escapeHtml(post.title)}</h2>
<p>${escapeHtml(post.summary)}</p>
<div class="tags">${featured}${tags}</div>
</a>`;
}

function renderShitpostCard(post) {
  const tags = post.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  const meta = post.date ? `AUTO · ${escapeHtml(post.date)}` : "AUTO";
  const caption = escapeHtml(post.caption).replaceAll("\n", "<br>");
  return `<a class="card shitpost-card" href="${escapeHtml(post.url)}">
<span class="go">ŹRÓDŁO ↗</span>
<div class="meta">${meta}</div>
<h2>SHITPOST OF THE DAY</h2>
<p>${caption}</p>
<div class="tags">${tags}</div>
</a>`;
}

async function getPosts(context) {
  const url = new URL("/teksty/posts.json", context.request.url);
  const response = await context.env.ASSETS.fetch(url.toString());
  if (!response.ok) return [];
  const posts = await response.json();
  return Array.isArray(posts) ? posts : [];
}

export async function onRequest(context) {
  const [response, posts, digests, shitpost] = await Promise.all([
    context.env.ASSETS.fetch(context.request),
    getPosts(context),
    getDigestPosts(context),
    getLatestShitpost(),
  ]);
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || !contentType.includes("text/html")) return response;

  let rewriter = new globalThis.HTMLRewriter();

  const publications = [...posts, ...digests];
  if (shitpost || publications.length > 0) {
    rewriter = rewriter.on("#text-list", {
      element(element) {
        if (shitpost) {
          element.before(renderShitpostCard(shitpost), { html: true });
        }
        if (publications.length > 0) {
          element.setInnerContent(publications.sort((a, b) => Number(b.featured === true) - Number(a.featured === true) || latestFirst(a, b)).map(renderCard).join("\n"), { html: true });
        }
      },
    });
  }

  return rewriter.transform(response);
}
