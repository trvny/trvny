import { getDigestPosts, latestFirst, publicationPath } from "./_shared/digests.js";
import { getShitposts, REACTOR_HOME_URL } from "./_shared/shitpost.js";
import { serviceFetch } from "./_shared/service-fetch.js";
import { publicationLang } from "./_shared/publication-lang.js";

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
  .textdigestcategory{font-family:"Silkscreen";font-size:10px;color:var(--k);background:var(--v);padding:3px 7px;text-decoration:none;text-shadow:none}
  .textdigest:nth-child(2n) .textdigestcategory{background:var(--y)}
  .textdigestcategory:hover,.textdigestcategory:focus-visible{outline:2px solid var(--w);outline-offset:2px}
  .textdigest .texttitlelink{color:inherit;text-decoration:none}
  .textdigest .texttitlelink:hover,.textdigest .texttitlelink:focus-visible{text-decoration:underline}
  .textdigest:focus-within{background:#111826}
  .textsheadinglink{color:inherit;text-decoration:none}
  .textsheadinglink:hover,.textsheadinglink:focus-visible{color:var(--c);text-decoration:underline}
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
    <h3 lang="${publicationLang(post.titleLang ?? post.lang)}">${escapeHtml(post.title)}</h3>
    <p lang="${publicationLang(post.lang)}">${escapeHtml(post.summary)}</p>
    <div class="texttags">${tags}</div>
  </a>`;
}

function renderDigestTextCard(post) {
  const path = publicationPath(post);
  if (!path) return "";
  const tags = (post.tags || []).slice(0, 3).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
  return `<article class="textitem textdigest">
    <div class="textmeta"><a class="textdigestcategory" href="/przeglad/">CoCzyDziennik</a><time datetime="${escapeHtml(post.date)}">${escapeHtml(post.date)}</time></div>
    <h3 lang="${publicationLang(post.titleLang ?? post.lang)}"><a class="texttitlelink" href="${path}">${escapeHtml(post.title)}</a></h3>
    <p lang="${publicationLang(post.lang)}">${escapeHtml(post.summary)}</p>
    <div class="texttags">${tags}</div>
  </article>`;
}

function renderShitpostTextCard(post) {
  const tags = post.tags.slice(0, 3).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
  const meta = post.date ? escapeHtml(post.date) : "";
  const caption = escapeHtml(post.excerpt).replaceAll("\n", "<br>");
  return `<article class="textitem textdigest">
    <div class="textmeta"><a class="textdigestcategory" href="${REACTOR_HOME_URL}">Reactor</a>${meta}</div>
    <h3 lang="${publicationLang(post.titleLang ?? post.lang)}"><a class="texttitlelink" href="${escapeHtml(post.url)}">${escapeHtml(post.title)}</a></h3>
    ${post.excerpt ? `<p lang="${publicationLang(post.lang)}">${caption}</p>` : ""}
    <div class="texttags">${tags}</div>
  </article>`;
}

function renderTexts(posts, digests, shitposts) {
  const latestDigest = digests.filter((post) => publicationPath(post)).sort(latestFirst)[0];
  const entries = [
    ...posts.filter((post) => publicationPath(post)).map((value) => ({ type: "text", value })),
    ...(latestDigest ? [{ type: "digest", value: latestDigest }] : []),
    ...shitposts.slice(0, 1).map((value) => ({ type: "shitpost", value })),
  ].sort((a, b) => latestFirst(a.value, b.value));
  // Keep exactly one latest digest and Shitpost among the visible cards.
  const required = [
    entries.find((entry) => entry.type === "digest"),
    entries.find((entry) => entry.type === "shitpost"),
  ].filter(Boolean);
  const remaining = entries.filter((entry) => !required.includes(entry));
  const openSlots = 3 - required.length;
  const visible = new Set([...required, ...remaining.slice(0, openSlots)]);
  const hidden = remaining.slice(openSlots, 10 - required.length);
  const featured = posts.filter((post) => post.featured === true);
  const pinned = featured.length ? `<section class="featurehome" aria-labelledby="featuredHeading"><div class="labhead"><h2 id="featuredHeading">P600 · FEATURED</h2></div><div class="featuregrid">${featured.map((post, index) => renderTextCard(post, index, 601)).join("")}</div></section>` : "";
  const cards = (items, offset = 0) => items.map((entry, index) =>
    entry.type === "shitpost"
      ? renderShitpostTextCard(entry.value)
      : entry.type === "digest"
        ? renderDigestTextCard(entry.value)
        : renderTextCard(entry.value, offset + index)
  ).join("");
  const expansion = hidden.length ? `<details class="textexpand">
    <summary class="texttoggle"><span class="textexpandmore">▼ POKAŻ KOLEJNE ${hidden.length}</span><span class="textexpandless">▲ ZWIŃ</span></summary>
    <div class="textgrid">${cards(hidden, 3)}</div>
  </details>` : "";
  return `<section class="texthome" aria-labelledby="textsHeading">
    <div class="labhead">
      <h2 id="textsHeading"><a class="textsheadinglink" href="/teksty/">P500 · TEKSTY</a></h2>
      <a class="textfeed" href="/teksty/feed.xml" title="Kanał Atom">ATOM ↗</a>
    </div>
    <div class="textgrid">${cards(entries.filter((entry) => visible.has(entry)))}</div>
    ${expansion}
    <a class="textsall" href="/teksty/">▶ WSZYSTKIE TEKSTY</a>
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
    getShitposts(serviceFetch(context, "REACTOR_SERVICE"), 1, latestFirst),
  ]);
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok || !contentType.includes("text/html")) {
    return response;
  }

  let rewriter = new globalThis.HTMLRewriter()
    .on("head", {
      element(element) {
        element.append(
          TEXTS_HEAD,
          { html: true },
        );
      },
    });

  rewriter = rewriter.on(".fastext", {
    element(element) {
      element.before(renderTexts(posts, digests, shitposts), { html: true });
    },
  });

  return rewriter.transform(response);
}
