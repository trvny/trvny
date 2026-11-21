import { readFile } from "node:fs/promises";

// Corpus from Quarto. Creator identity from the hub.
const BASE = "https://bartek.lol/teksty/token-worldcup/";
const hub = await readFile(new URL("../site/index.html", import.meta.url), "utf8");
const graph = JSON.parse(hub.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)[1])["@graph"];
const website = graph.find(node => node["@type"] === "WebSite");
const creator = graph.find(node => node["@type"] === "Person" && node["@id"] === website?.creator?.["@id"]);
if (!creator) throw new Error("Hub creator missing");
const MODELS = [
  ["GPT-5 (o200k_base)", "tokens"], ["Claude Opus 5.5", "claude_tokens"],
  ["DeepSeek V4.1", "deepseek_tokens"], ["cl100k_base", "cl100k_tokens"],
  ["r50k_base", "r50k_tokens"], ["o200k_harmony", "harmony_tokens"],
];

const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const json = value => JSON.stringify(value).replaceAll("<", "\\u003c");

export function worldcupData(html) {
  const match = html.match(/<script type="application\/json" id="token-worldcup-data">([\s\S]*?)<\/script>/);
  if (!match) throw new Error("Worldcup data missing");
  const rows = JSON.parse(match[1]);
  if (!Array.isArray(rows) || !rows.length || new Set(rows.map(row => row.name)).size !== rows.length
    || !rows.some(row => row.name === "English") || !rows.some(row => row.name === "Polish")
    || rows.some(row => typeof row.name !== "string" || typeof row.text !== "string" || typeof row.lang !== "string"
      || MODELS.some(([, key]) => !Number.isSafeInteger(row[key]) || row[key] <= 0)
      || !["rank", "index", "overhead"].every(key => Number.isSafeInteger(row[key])))) {
    throw new Error("Invalid benchmark data");
  }
  return rows;
}

function summary(rows, english) {
  const en = rows.find(row => row.name === "English"), pl = rows.find(row => row.name === "Polish");
  const best = rows.slice().sort((a, b) => a.tokens - b.tokens || a.name.localeCompare(b.name))[0];
  const columns = MODELS.slice(0, 3).map(([name,key]) => escape(name) + ": " + pl[key] + " / " + en[key]).join("; ");
  return english
    ? "In this sample, " + escape(best.name) + " uses " + best.tokens + " GPT-5 tokens; English uses " + en.tokens + ". Polish / English token counts: " + columns + "."
    : "W tej próbce minimum dla GPT-5 to " + escape(best.name) + " (" + best.tokens + " tokenów), a angielski ma " + en.tokens + ". Liczby tokenów: polski / angielski: " + columns + ".";
}

function metadata(rows, english) {
  const url = english ? BASE + "en/" : BASE;
  const headline = english ? "AI Token Worldcup: token counts in " + rows.length + " languages" : "Tokenowy Mundial AI: tokenizacja " + rows.length + " języków";
  const description = english ? "A controlled comparison of six tokenizers on equivalent short texts. Counts, source corpus and methodology." : "Porównanie sześciu tokenizerów na krótkim równoważnym tekście. Wyniki, korpus i metodologia.";
  const dataset = BASE + "dataset.json";
  const share = {
    type: "article",
    title: headline,
    description,
    url,
    image: "https://bartek.lol/assets/og.png",
  };
  const openGraph = Object.entries(share).map(([name, value]) =>
    `<meta property="og:${name}" content="${escape(value)}">`).join("");
  return openGraph + '<script type="application/ld+json">' + json({
    "@context": "https://schema.org", "@graph": [
      { "@type": "Article", "@id": url + "#article", headline, description, url,
        mainEntityOfPage: url, inLanguage: english ? "en" : "pl", author: creator, about: { "@id": dataset } },
      { "@type": "Dataset", "@id": dataset, name: "AI Token Worldcup benchmark corpus and token counts",
        description: "Equivalent natural-language samples, exact texts, and token counts for six tokenizer configurations.",
        url: BASE, creator,
        variableMeasured: MODELS.map(([name]) => name + " token count"),
        distribution: { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: dataset } },
    ],
  }) + '</script>';
}

export function renderWorldcupPolish(html) {
  const rows = worldcupData(html);
  const tbody = /<tbody id="tableBody">[\s\S]*?<\/tbody>/;
  if (!tbody.test(html)) throw new Error("Worldcup table missing");
  const body = rows.slice().sort((a,b) => a.tokens - b.tokens || a.name.localeCompare(b.name)).map(row =>
    '<tr><td>#' + row.rank + (row.tied ? "=" : "") + '</td><td lang="en">' + escape(row.name) +
    '</td><td class="num">' + row.tokens + '</td><td class="num">' + (row.overhead > 0 ? "+" : "") +
    row.overhead + '%</td><td class="num">' + row.index + '</td></tr>').join("\n");
  const section = '<section class="panel section" id="worldcup-citation"><h2>Wyniki i ograniczenia</h2><p>' + summary(rows,false)
    + '</p><p>Pojedynczy krótki tekst na język, nie reprezentatywny korpus. Wyniki zależą od doboru słów, pisma i tokenizera; nie przewidują ogólnego kosztu ani jakości odpowiedzi modelu.</p>'
    + '<p><a href="en/" lang="en">English report</a> · <a href="dataset.json">Dane i teksty testowe (JSON)</a> · <a href="https://github.com/trvny/trvny/tree/main/pages/token-worldcup">Kod i źródła pomiaru</a></p></section>';
  const clean = html.replace(/<section class="panel section" id="worldcup-citation">[\s\S]*?<\/section>/, "")
    .replace(/<!-- worldcup-schema:start -->[\s\S]*?<!-- worldcup-schema:end -->/, "");
  if (!clean.includes("</header>") || !clean.includes("</head>")) throw new Error("Worldcup structure changed");
  return clean.replace(tbody, '<tbody id="tableBody">\n' + body + '\n</tbody>')
    .replace("</header>", "</header>" + section)
    .replace("</head>", "<!-- worldcup-schema:start -->" + metadata(rows,false) + "<!-- worldcup-schema:end --></head>");
}

export function renderWorldcupEnglish(html) {
  const rows = worldcupData(html);
  const head = MODELS.map(([name]) => '<th scope="col">' + escape(name) + '</th>').join("");
  const body = rows.slice().sort((a,b) => a.tokens - b.tokens || a.name.localeCompare(b.name)).map(row =>
    '<tr><th scope="row">' + escape(row.name) + '</th>' + MODELS.map(([,key]) => '<td>' + row[key] + '</td>').join("") + '</tr>').join("\n");
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>AI Token Worldcup: ' + rows.length + ' languages, six tokenizers</title><meta name="description" content="Compare token counts across equivalent texts in multiple languages using GPT-5, Claude Opus 5.5, DeepSeek V4.1 and three GPT encodings.">'
    + '<meta name="robots" content="index,follow"><link rel="canonical" href="' + BASE + 'en/">' + metadata(rows,true)
    + '<style>body{font:16px/1.6 system-ui,sans-serif;color:#edf1f6;background:#070d17;margin:0}main{max-width:1100px;margin:auto;padding:32px 20px}a{color:#66e4e4}h1,h2{color:#f5e94e}p{max-width:80ch}.table{overflow:auto}table{border-collapse:collapse;width:100%}th,td{padding:8px 12px;border:1px solid #405162;text-align:right}th:first-child{text-align:left}thead{background:#152638}caption{text-align:left;padding-bottom:10px}code{overflow-wrap:anywhere}</style></head><body><main>'
    + '<p><a href="../" lang="pl">Polski · interactive report</a> / TRAVNY</p><h1>AI Token Worldcup: ' + rows.length + ' languages, six tokenizers</h1><p>' + summary(rows,true) + '</p>'
    + '<h2>Results</h2><div class="table"><table><caption>Input text tokens, sorted by GPT-5 count</caption><thead><tr><th scope="col">Language</th>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>'
    + '<h2>Method</h2><p>Each language conveys the same neutral facts about balls, arithmetic and equal division. Samples are natural formulations, not word-for-word translations. GPT-5 uses o200k_base via gpt-tokenizer; DeepSeek uses its official pinned V4.1 tokenizer. Claude Opus 5.5 counts come from Anthropic count_tokens with eight framing tokens subtracted. The three additional GPT encodings are cl100k_base, r50k_base and o200k_harmony.</p>'
    + '<h2>Limitations</h2><p>One short sample per language, not a representative corpus. Counts depend on wording, script and tokenizer. They are not a general language ranking, a measure of model quality, or a prediction of total API cost.</p>'
    + '<h2>Reproduce and cite</h2><p><a href="../dataset.json">Download the exact corpus and token counts (JSON)</a> · <a href="https://github.com/trvny/trvny/tree/main/pages/token-worldcup">Quarto source, recount scripts and raw measurement files</a> · <a href="../">Interactive report and charts</a>.</p></main></body></html>';
}
