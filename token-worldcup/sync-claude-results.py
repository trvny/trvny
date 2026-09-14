#!/usr/bin/env python3
"""Merge measured Claude tokenizer results into the maintained Quarto reports.

`token-worldcup.qmd` remains the only source for the sample corpus. The recount
JSON is the measurement record for Claude. This script joins the two by language
name, embeds the measured fields into the offline report, and updates the Claude
cost matrix to use the same language overheads.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
WORLDCUP = ROOT / "token-worldcup.qmd"
EFFORT = ROOT / "effort-matrix.qmd"
DEFAULT_RESULTS = ROOT / "claude-token-counts.json"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one exact match, found {count}")
    return text.replace(old, new, 1)


def model_label(model: str) -> str:
    known = {"claude-opus-5": "Claude Opus 5"}
    return known.get(model, model.replace("-", " ").title())


def load_results(path: pathlib.Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = payload.get("rows")
    if not isinstance(rows, list) or not rows:
        raise SystemExit(f"{path.name}: missing non-empty rows array")
    required = {"name", "claude_tokens", "claude_index", "claude_rank", "claude_rank_tied"}
    for row in rows:
        missing = required - row.keys()
        if missing:
            raise SystemExit(f"{path.name}: {row.get('name', '?')} missing {sorted(missing)}")
    return payload


def load_worldcup_data(source: str) -> list[dict]:
    match = re.search(r"const data=(\[.*?\]);const base=", source, re.S)
    if not match:
        raise SystemExit("token-worldcup.qmd: could not locate embedded data array")
    return json.loads(match.group(1))


def merge_rows(samples: list[dict], payload: dict) -> list[dict]:
    measured = {row["name"]: row for row in payload["rows"]}
    sample_names = {row["name"] for row in samples}
    if sample_names != set(measured):
        raise SystemExit(
            "Claude result languages differ from the QMD corpus: "
            f"missing={sorted(sample_names - set(measured))}, extra={sorted(set(measured) - sample_names)}"
        )
    merged = []
    for sample in samples:
        result = measured[sample["name"]]
        row = dict(sample)
        row.update(
            claude_tokens=result["claude_tokens"],
            claude_rank=result["claude_rank"],
            claude_tied=result["claude_rank_tied"],
            claude_index=result["claude_index"],
            claude_overhead=result["claude_index"] - 100,
        )
        merged.append(row)
    return merged


def compact(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def worldcup_script(rows: list[dict], payload: dict) -> str:
    data = compact(rows)
    label = json.dumps(model_label(payload["model"]), ensure_ascii=False)
    model = json.dumps(payload["model"], ensure_ascii=False)
    overhead = int(payload.get("framing_overhead", 0))
    return f'''  <script>
    (()=>{{
      const data={data};
      const claudeLabel={label},claudeModel={model},claudeFraming={overhead};
      const SOURCES={{
        o200k:{{label:'o200k_base',tokens:'tokens',rank:'rank',tied:'tied',index:'index',overhead:'overhead'}},
        claude:{{label:claudeLabel,tokens:'claude_tokens',rank:'claude_rank',tied:'claude_tied',index:'claude_index',overhead:'claude_overhead'}}
      }};
      const $=id=>document.getElementById(id);
      const ranking=$('ranking'),tableBody=$('tableBody'),selectedInfo=$('selectedInfo'),sampleText=$('sampleText'),sampleLanguage=$('sampleLanguage'),tokensBtn=$('tokensBtn'),overheadBtn=$('overheadBtn');
      const podium=document.querySelector('.podium'),latinSpot=document.querySelector('.spot.latin'),polishSpot=document.querySelector('.spot.polish'),wideSpot=document.querySelector('.spot.wide');
      const eyebrow=document.querySelector('.eyebrow'),headline=document.querySelector('.headline-stat'),footer=document.querySelector('footer');
      let source='o200k',mode='tokens',selected='Polish';

      const switcher=document.createElement('div');
      switcher.className='controls';switcher.style.marginTop='18px';switcher.style.width='fit-content';
      switcher.setAttribute('role','group');switcher.setAttribute('aria-label','Tokenizer');
      switcher.innerHTML='<button id="o200kSourceBtn" type="button" aria-pressed="true">o200k_base</button><button id="claudeSourceBtn" type="button" aria-pressed="false">Claude Opus 5</button>';
      document.querySelector('header').appendChild(switcher);
      const o200kSourceBtn=$('o200kSourceBtn'),claudeSourceBtn=$('claudeSourceBtn');

      const spec=()=>SOURCES[source];
      const stat=item=>{{const s=spec();return{{tokens:item[s.tokens],rank:item[s.rank],tied:item[s.tied],index:item[s.index],overhead:item[s.overhead]}}}};
      const signed=n=>(n>0?'+':'')+n+'%';
      const placeText=s=>s.tied?`#${{s.rank}}=`:`#${{s.rank}}`;
      const ordered=()=>data.slice().sort((a,b)=>stat(a).tokens-stat(b).tokens||a.name.localeCompare(b.name));
      const item=name=>data.find(row=>row.name===name);
      const accent=name=>({{English:'en',Chinese:'zh',Latin:'la',Polish:'pl'}}[name]||'');

      function renderHeader(){{
        const pl=stat(item('Polish'));
        eyebrow.innerHTML=`<span class="dot"></span> ${{spec().label}} · ${{data.length}} języków`;
        headline.textContent=`Polski: ${{signed(pl.overhead)}} względem angielskiego. 🇵🇱💸`;
        o200kSourceBtn.setAttribute('aria-pressed',String(source==='o200k'));
        claudeSourceBtn.setAttribute('aria-pressed',String(source==='claude'));
      }}

      const place=(row,cls,medal)=>{{const s=stat(row);return `<article class="place ${{cls}}"><div class="medal">${{medal}}</div><div class="lang">${{row.name}}</div><div class="tokens">${{s.tokens}}</div><div class="meta">${{placeText(s)}} · ${{signed(s.overhead)}} vs EN · indeks ${{s.index}}</div></article>`}};
      function renderHero(){{
        const top=ordered(),first=top[0],second=top[1],third=top[2];
        podium.innerHTML=place(second,'second','🥈')+place(first,'first','🥇')+place(third,'third','🥉');
        const la=stat(item('Latin')),pl=stat(item('Polish'));
        latinSpot.innerHTML=`<small>Łacina · ${{placeText(la)}}</small><strong>${{la.tokens}}</strong><small>${{signed(la.overhead)}}</small>`;
        polishSpot.innerHTML=`<small>Polski · ${{placeText(pl)}}</small><strong>${{pl.tokens}}</strong><small>${{signed(pl.overhead)}}</small>`;
        const winner=la.tokens<=pl.tokens?'Łacina':'Polski',loser=winner==='Łacina'?'polskiego':'łaciny';
        wideSpot.innerHTML=`<small>Praktyczna konkluzja</small><div class="quote">Ave GPT, refactorium meum perfice.</div><small style="margin-top:7px">${{winner}} jest w tym pomiarze bardziej tokeno-oszczędny od ${{loser}}. Imperium aktualizuje tabelę.</small>`;
      }}

      function showSelected(row){{
        const s=stat(row),where=s.tied?`miejsce ${{s.rank}} (remis)`:`miejsce ${{s.rank}}`;
        selectedInfo.innerHTML=`<b>${{row.name}}:</b> ${{s.tokens}} tokenów · ${{signed(s.overhead)}} vs EN · indeks ${{s.index}} · ${{where}} · ${{spec().label}}`;
        sampleLanguage.textContent=row.name;
        sampleText.lang=row.lang;sampleText.dir=['ar','he'].includes(row.lang)?'rtl':'ltr';sampleText.textContent=row.text;
      }}

      function renderRanking(){{
        const rows=ordered(),values=rows.map(r=>stat(r).tokens),min=Math.min(...values),max=Math.max(...values),span=Math.max(max-min,1);
        ranking.replaceChildren();
        rows.forEach(row=>{{
          const s=stat(row),button=document.createElement('button');
          button.type='button';button.className='rank-row';button.dataset.lang=row.name;button.setAttribute('aria-pressed',String(row.name===selected));
          const width=24+76*(s.tokens-min)/span,value=mode==='tokens'?`${{s.tokens}} tok`:`${{signed(s.overhead)}}`;
          button.innerHTML=`<span class="rank-no">${{placeText(s)}}</span><span class="rank-name">${{row.name}}</span><span class="track"><span class="bar" style="width:${{width.toFixed(1)}}%"></span></span><span class="rank-value">${{value}}</span>`;
          button.addEventListener('click',()=>{{selected=row.name;renderRanking();showSelected(row)}});
          ranking.appendChild(button);
        }});
        showSelected(item(selected)||rows[0]);
      }}

      function renderTable(){{
        tableBody.innerHTML=ordered().map(row=>{{const s=stat(row),a=accent(row.name);return `<tr${{a?` class="accent-${{a}}"`:''}}><td>${{placeText(s)}}</td><td>${{row.name}}</td><td class="num">${{s.tokens}}</td><td class="num">${{signed(s.overhead)}}</td><td class="num">${{s.index}}</td></tr>`}}).join('');
      }}

      function renderMethod(){{
        const card=[...document.querySelectorAll('.method-card')].find(c=>c.querySelector('b')?.textContent==='Tokenizer');
        if(card)card.innerHTML=`<b>Tokenizer</b><p>Przełącznik porównuje dokładnie ten sam korpus na <code>o200k_base</code> (OpenAI) i ${{claudeLabel}}. Ranking, podium, tabela i narzut względem EN przeliczają się razem.</p><p>Claude jest zmierzony przez <code>messages.count_tokens</code>; stały framing requestu (${{claudeFraming}} tokenów) jest odejmowany. Surowy wynik zostaje w <a href="claude-token-counts.json"><code>claude-token-counts.json</code></a>, a odświeżenie wykonuje <a href="recount-claude-tokens.py"><code>recount-claude-tokens.py</code></a>.</p>`;
        footer.innerHTML=`Neutralny benchmark tokenizacji: ${{data.length}} naturalnych wersji tego samego zestawu informacji. Aktywny pomiar: <code>${{spec().label}}</code>. Kliknięcie języka pokazuje dokładny tekst użyty w obu pomiarach.`;
      }}

      function render(){{renderHeader();renderHero();renderRanking();renderTable();renderMethod()}}
      tokensBtn.addEventListener('click',()=>{{mode='tokens';tokensBtn.setAttribute('aria-pressed','true');overheadBtn.setAttribute('aria-pressed','false');renderRanking()}});
      overheadBtn.addEventListener('click',()=>{{mode='overhead';tokensBtn.setAttribute('aria-pressed','false');overheadBtn.setAttribute('aria-pressed','true');renderRanking()}});
      o200kSourceBtn.addEventListener('click',()=>{{source='o200k';render()}});
      claudeSourceBtn.addEventListener('click',()=>{{source='claude';render()}});
      render();
    }})();
  </script>'''


def update_worldcup(source: str, rows: list[dict], payload: dict) -> str:
    source = replace_once(
        source,
        'description: "Porównanie liczby tokenów dla równoważnego tekstu w 27 językach na tokenizerze o200k_base."',
        'description: "Porównanie tokenizacji równoważnego tekstu w 27 językach: o200k_base i zmierzony Claude Opus 5."',
        "worldcup description",
    )
    pattern = re.compile(r"  <script>\s*\(\(\)=>\{.*?\}\)\(\);\s*</script>", re.S)
    source, count = pattern.subn(worldcup_script(rows, payload), source, count=1)
    if count != 1:
        raise SystemExit(f"token-worldcup.qmd: expected one report script, found {count}")
    return source


def update_effort(source: str, rows: list[dict], payload: dict) -> str:
    o200k = compact([{"n": row["name"], "o": row["overhead"]} for row in rows])
    claude = compact([{"n": row["name"], "o": row["claude_overhead"]} for row in rows])
    label = model_label(payload["model"])

    source, count = re.subn(
        r"      const LANGS=\[.*?\];",
        f"      const LANGS_O200K={o200k};\n      const LANGS_CLAUDE={claude};\n      let tokenizer='claude';\n      const langs=()=>tokenizer==='claude'?LANGS_CLAUDE:LANGS_O200K;",
        source,
        count=1,
        flags=re.S,
    )
    if count != 1:
        raise SystemExit(f"effort-matrix.qmd: expected one LANGS array, found {count}")

    source = replace_once(
        source,
        "      langSel.innerHTML=LANGS.map((l,i)=>`<option value=\"${i}\"${l.n==='Polish'?' selected':''}>${l.n} (${l.o>=0?'+':''}${l.o}%)</option>`).join('');",
        "      const fillLangSelect=(wanted='Polish')=>{const list=langs(),idx=Math.max(0,list.findIndex(l=>l.n===wanted));langSel.innerHTML=list.map((l,i)=>`<option value=\"${i}\">${l.n} (${l.o>=0?'+':''}${l.o}%)</option>`).join('');langSel.value=String(idx)};\n      fillLangSelect();",
        "effort language options",
    )
    source = replace_once(source, "      const lang=()=>LANGS[+langSel.value];", "      const lang=()=>langs()[+langSel.value];", "effort lang accessor")

    marker = "      let mode='usd',sel={model:'sonnet',effort:'xhigh'};"
    controls = marker + f'''\n      const tokenizerControls=document.createElement('div');
      tokenizerControls.className='controls';tokenizerControls.style.marginTop='18px';tokenizerControls.style.width='fit-content';
      tokenizerControls.setAttribute('role','group');tokenizerControls.setAttribute('aria-label','Tokenizer narzutu językowego');
      tokenizerControls.innerHTML='<button id="o200kTokenizerBtn" type="button" aria-pressed="false">o200k_base</button><button id="claudeTokenizerBtn" type="button" aria-pressed="true">{label}</button>';
      document.querySelector('header').appendChild(tokenizerControls);
      const o200kTokenizerBtn=$('o200kTokenizerBtn'),claudeTokenizerBtn=$('claudeTokenizerBtn');'''
    source = replace_once(source, marker, controls, "effort tokenizer controls")

    old_hint = '<small class="hint">Narzut z <code>o200k_base</code>, mnoży wyłącznie tokeny wejściowe.</small>'
    new_hint = '<small class="hint" id="tokenizerHint">Narzut z <code>Claude Opus 5</code>, mnoży wyłącznie tokeny wejściowe.</small>'
    source = replace_once(source, old_hint, new_hint, "effort tokenizer hint")

    render_marker = "      function render(){\n        $('inRead').textContent=num(+inTok.value)+' tok';"
    render_replacement = f'''      function render(){{
        o200kTokenizerBtn.setAttribute('aria-pressed',String(tokenizer==='o200k'));
        claudeTokenizerBtn.setAttribute('aria-pressed',String(tokenizer==='claude'));
        $('tokenizerHint').innerHTML=`Narzut z <code>${{tokenizer==='claude'?'{label}':'o200k_base'}}</code>, mnoży wyłącznie tokeny wejściowe.`;
        const method=[...document.querySelectorAll('.method-card')].find(c=>c.querySelector('b')?.textContent==='Czego tu nie ma');
        const methodPs=method?.querySelectorAll('p');
        if(methodPs?.[1])methodPs[1].innerHTML=`Tokenizer językowy: aktywny <code>${{tokenizer==='claude'?'{label}':'o200k_base'}}</code>. Claude jest zmierzony przez <code>messages.count_tokens</code>; przełącznik zachowuje stary o200k jako punkt porównania.`;
        $('inRead').textContent=num(+inTok.value)+' tok';'''
    source = replace_once(source, render_marker, render_replacement, "effort render hook")

    listener_marker = "      langSel.addEventListener('change',render);"
    listener_replacement = listener_marker + "\n      const setTokenizer=next=>{const keep=lang().n;tokenizer=next;fillLangSelect(keep);render()};\n      o200kTokenizerBtn.addEventListener('click',()=>setTokenizer('o200k'));\n      claudeTokenizerBtn.addEventListener('click',()=>setTokenizer('claude'));"
    source = replace_once(source, listener_marker, listener_replacement, "effort tokenizer listeners")
    return source


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--results", type=pathlib.Path, default=DEFAULT_RESULTS)
    ap.add_argument("--check", action="store_true", help="validate and report whether files are already synchronized")
    args = ap.parse_args()

    payload = load_results(args.results)
    worldcup_source = WORLDCUP.read_text(encoding="utf-8")
    rows = merge_rows(load_worldcup_data(worldcup_source), payload)
    new_worldcup = update_worldcup(worldcup_source, rows, payload)
    new_effort = update_effort(EFFORT.read_text(encoding="utf-8"), rows, payload)

    changed = []
    if new_worldcup != worldcup_source:
        changed.append(WORLDCUP.name)
    effort_source = EFFORT.read_text(encoding="utf-8")
    if new_effort != effort_source:
        changed.append(EFFORT.name)

    if args.check:
        if changed:
            raise SystemExit("not synchronized: " + ", ".join(changed))
        print("Claude tokenizer results are synchronized")
        return 0

    WORLDCUP.write_text(new_worldcup, encoding="utf-8")
    EFFORT.write_text(new_effort, encoding="utf-8")
    print(f"synchronized {len(rows)} languages from {args.results.name}: {', '.join(changed) or 'no changes'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
