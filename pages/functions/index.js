import { getDigestPosts, latestFirst, publicationPath } from "./_shared/digests.js";
import { getShitposts } from "./_shared/shitpost.js";

const TEXTS_HEAD = `
<style>
  .texthome{margin-top:28px}
  .textfeed{color:var(--c);font-family:"Silkscreen";font-size:10px;text-shadow:none;text-decoration:none;letter-spacing:.03em}
  .textfeed:hover{color:var(--w)}
  .textgrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
  .textitem{display:block;min-width:0;padding:15px 16px 16px;border-top:6px solid var(--v);background:#0b0f16;color:var(--w);text-decoration:none;transition:background .12s,transform .12s}
  .textitem:nth-child(2n){border-color:var(--y)}
  .textitem:hover,.textitem:focus-visible{background:#111826;transform:translateY(-1px);outline:none}
  .textmeta{display:flex;align-items:center;gap:9px;color:var(--dim);font-size:17px;letter-spacing:.04em}
  .textmeta b{font-family:"Silkscreen";font-size:10px;font-weight:400;color:var(--k);background:var(--v);padding:3px 7px;text-shadow:none}
  .textitem:nth-child(2n) .textmeta b{background:var(--y)}
  .textitem h3{margin-top:12px;color:var(--v);font-family:"Silkscreen";font-size:18px;line-height:1.1;letter-spacing:.02em}
  .textitem:nth-child(2n) h3{color:var(--y)}
  .textitem p{margin-top:9px;color:var(--w);font-size:21px;line-height:1.18}
  .texttags{display:flex;flex-wrap:wrap;gap:5px;margin-top:12px}
  .texttags span{font-family:"Silkscreen";font-size:9px;text-shadow:none;border:1px solid var(--faint);color:var(--dim);padding:3px 5px;background:#070b12}
  .textexpand{margin-top:14px}
  .texttoggle{display:inline-block;cursor:pointer;list-style:none;color:var(--c);font-family:"Silkscreen";font-size:11px;text-shadow:none;letter-spacing:.03em}
  .texttoggle::-webkit-details-marker{display:none}
  .texttoggle:hover,.texttoggle:focus-visible{color:var(--w)}
  .textexpandless,.textexpand[open] .textexpandmore{display:none}
  .textexpand[open] .textexpandless{display:inline}
  .textexpand .textgrid{margin-top:14px}
  .featurehome{margin-top:28px}
  .featuregrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
  .featuregrid .textitem,.featuregrid .textitem:nth-child(2n){border-color:var(--c)}
  .featuregrid .textmeta b,.featuregrid .textitem:nth-child(2n) .textmeta b{background:var(--c)}
  .featuregrid .textitem h3{color:var(--c)}
  @media (max-width:640px){.featuregrid{grid-template-columns:minmax(0,1fr)}}
  .textsall{display:inline-block;margin-top:10px;color:var(--v);font-family:"Silkscreen";font-size:11px;text-shadow:none;text-decoration:none;letter-spacing:.03em}
  .textsall:hover{color:var(--w)}
  @media (max-width:640px){.textgrid{grid-template-columns:minmax(0,1fr)}}
</style>`;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderTextCard(post, index, firstPage = 501) {
  const path = publicationPath(post);
  if (!path) return "";
  const tags = (post.tags || []).slice(0, 3).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
  return `<a class="textitem" href="${path}">
    <div class="textmeta"><b>P${firstPage + index}</b>${escapeHtml(post.date)} · ${escapeHtml(post.kind)}</div>
    <h3>${escapeHtml(post.title)}</h3>
    <p>${escapeHtml(post.summary)}</p>
    <div class="texttags">${tags}</div>
  </a>`;
}

function renderShitpostTextCard(post, index) {
  const tags = post.tags.slice(0, 3).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
  const meta = post.date ? escapeHtml(post.date) : "";
  const caption = escapeHtml(post.excerpt).replaceAll("\n", "<br>");
  return `<a class="textitem" href="${escapeHtml(post.url)}">
    <div class="textmeta"><b>P${501 + index}</b>${meta}</div>
    <h3>${escapeHtml(post.title)}</h3>
    ${post.excerpt ? `<p>${caption}</p>` : ""}
    <div class="texttags">${tags}</div>
  </a>`;
}

function renderTexts(posts, shitposts) {
  const entries = [
    ...posts.filter((post) => publicationPath(post)).map((post) => ({ type: "text", value: post, updated: post.updated })),
    ...shitposts.map((post) => ({ type: "shitpost", value: post, updated: post.updated })),
  ].sort(latestFirst).slice(0, 10);
  const featured = posts.filter((post) => post.featured === true);
  const pinned = featured.length ? `<section class="featurehome" aria-labelledby="featuredHeading"><div class="labhead"><h2 id="featuredHeading">P600 · FEATURED</h2></div><div class="featuregrid">${featured.map((post, index) => renderTextCard(post, index, 601)).join("")}</div></section>` : "";
  const cards = (items, offset = 0) => items.map((entry, index) =>
    entry.type === "shitpost"
      ? renderShitpostTextCard(entry.value, offset + index)
      : renderTextCard(entry.value, offset + index)
  ).join("");
  const hidden = entries.slice(3);
  const expansion = hidden.length ? `<details class="textexpand">
    <summary class="texttoggle"><span class="textexpandmore">▼ POKAŻ KOLEJNE ${hidden.length}</span><span class="textexpandless">▲ ZWIŃ</span></summary>
    <div class="textgrid">${cards(hidden, 3)}</div>
  </details>` : "";
  return `<section class="texthome" aria-labelledby="textsHeading">
    <div class="labhead">
      <h2 id="textsHeading">P500 · TEKSTY</h2>
      <a class="textfeed" href="/teksty/feed.xml" title="Kanał Atom">ATOM ↗</a>
    </div>
    <div class="textgrid">${cards(entries.slice(0, 3))}</div>
    ${expansion}
    <a class="textsall" href="/teksty/">▶ WSZYSTKIE TEKSTY</a> · <a class="textsall" href="/przeglad/">CoCzyDziennik</a>
  </section>${pinned}`;
}

async function getPosts(context) {
  try {
    const url = new URL("/teksty/posts.json", context.request.url);
    const response = await context.env.ASSETS.fetch(url.toString());
    if (!response.ok) return [];
    const posts = await response.json();
    return Array.isArray(posts) ? posts : [];
  } catch {
    return [];
  }
}

export async function onRequest(context) {
  const [response, posts, digests, shitposts] = await Promise.all([
    context.env.ASSETS.fetch(context.request),
    getPosts(context),
    getDigestPosts(context),
    getShitposts(fetch, 10),
  ]);
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok || !contentType.includes("text/html")) {
    return response;
  }

  let rewriter = new globalThis.HTMLRewriter()
    .on("head", {
      element(element) {
        element.append(
          `<meta name="msvalidate.01" content="23A368B2C5F4DF3471A67EA6CB057149">${TEXTS_HEAD}`,
          { html: true },
        );
      },
    });

  const publications = [...posts, ...digests];
  if (shitposts.length > 0 || publications.length > 0) {
    rewriter = rewriter.on(".fastext", {
      element(element) {
        element.before(renderTexts(publications, shitposts), { html: true });
      },
    });
  }

  return rewriter.transform(response);
}
