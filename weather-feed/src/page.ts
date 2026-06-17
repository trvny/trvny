// Landing page served at GET /. Self-contained: theme + live data + Atom buttons.
// Theme: Arctic Frost (theme-factory) — steel/ice palette; amber/red added for
// warning severity (the theme has no alert colour). Live data is fetched
// client-side from /state.json and /feed.atom (same origin), so the HTML stays
// static and the Worker request path stays read-only.

const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
      '<path fill="#4a6fa5" d="M9 22a6 6 0 0 1-.6-11.97A8 8 0 0 1 24 11.2 5.4 5.4 0 0 1 23 22z"/>' +
      '<g stroke="#d4e4f7" stroke-width="2" stroke-linecap="round">' +
      '<line x1="12" y1="26" x2="11" y2="29"/><line x1="17" y1="26" x2="16" y2="30"/>' +
      '<line x1="22" y1="26" x2="21" y2="29"/></g></svg>',
  );

export const PAGE = `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pogoda — Kościelec (Chrzanów)</title>
<link rel="icon" href="${FAVICON}">
<link rel="alternate" type="application/atom+xml" title="Pogoda — zmiany" href="/feed.atom">
<link rel="alternate" type="application/atom+xml" title="Ostrzeżenia IMGW" href="/warnings.atom">
<style>
  :root{
    --ice:#d4e4f7; --steel:#4a6fa5; --steel-dark:#33507a; --silver:#c0c0c0;
    --white:#fafafa; --ink:#1a2333; --muted:#5b6678;
    --warn:#b45309; --warn-bg:#fef3c7; --alarm:#b91c1c; --alarm-bg:#fee2e2;
    --hydro:#0e7490; --hydro-bg:#cffafe;
  }
  *{box-sizing:border-box}
  body{
    margin:0; color:var(--ink); background:linear-gradient(160deg,var(--ice),var(--white) 55%);
    min-height:100vh; font-family:"DejaVu Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    line-height:1.5; -webkit-font-smoothing:antialiased;
  }
  main{max-width:680px; margin:0 auto; padding:32px 20px 56px}
  header h1{font-size:1.7rem; margin:0 0 2px; letter-spacing:-.01em}
  header p{margin:0 0 22px; color:var(--muted); font-size:.95rem}
  .card{background:#fff; border:1px solid #e3eaf3; border-radius:14px; padding:20px 22px; margin:14px 0;
    box-shadow:0 1px 2px rgba(26,35,51,.04)}
  .now{display:flex; align-items:baseline; gap:14px; flex-wrap:wrap}
  .temp{font-size:3rem; font-weight:700; color:var(--steel-dark); line-height:1}
  .cond{font-size:1.1rem; color:var(--steel)}
  .spread{color:var(--muted); font-size:.9rem}
  .metrics{display:flex; gap:24px; flex-wrap:wrap; margin-top:14px; font-size:.92rem}
  .metrics b{color:var(--steel-dark)}
  .src{margin-top:12px; font-size:.8rem; color:var(--muted)}
  .btns{display:flex; gap:10px; flex-wrap:wrap; margin:8px 0 4px}
  a.btn,button.btn{
    display:inline-flex; align-items:center; gap:7px; cursor:pointer;
    font:inherit; font-weight:600; font-size:.92rem; text-decoration:none;
    padding:11px 16px; border-radius:10px; border:1px solid transparent;
  }
  a.btn.primary{background:var(--steel); color:#fff}
  a.btn.primary:hover{background:var(--steel-dark)}
  a.btn.ghost{background:#fff; color:var(--steel-dark); border-color:var(--silver)}
  a.btn.ghost:hover{border-color:var(--steel)}
  button.btn.ghost{background:#fff; color:var(--steel-dark); border-color:var(--silver)}
  h2{font-size:.85rem; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin:26px 0 6px}
  .warn{border-left:4px solid var(--warn); background:var(--warn-bg); padding:11px 14px; border-radius:8px; margin:8px 0}
  .warn.alarm{border-color:var(--alarm); background:var(--alarm-bg)}
  .warn.hydro{border-color:var(--hydro); background:var(--hydro-bg)}
  .warn .wt{font-weight:700} .warn .wm{font-size:.86rem; color:var(--muted); margin-top:2px}
  .entry{padding:10px 0; border-bottom:1px solid #eef2f7}
  .entry:last-child{border-bottom:0}
  .entry .et{font-weight:600; font-size:.95rem}
  .entry .em{font-size:.86rem; color:var(--muted); margin-top:2px}
  .entry time{font-size:.75rem; color:var(--silver)}
  .empty{color:var(--muted); font-style:italic}
  footer{margin-top:34px; font-size:.78rem; color:var(--muted); text-align:center}
  footer a{color:var(--steel)}
  .toast{position:fixed; bottom:18px; left:50%; transform:translateX(-50%);
    background:var(--ink); color:#fff; padding:9px 15px; border-radius:8px; font-size:.85rem;
    opacity:0; transition:opacity .2s; pointer-events:none}
  .toast.show{opacity:1}
</style>
</head>
<body>
<main>
  <header>
    <h1>Kościelec <span style="color:var(--muted);font-weight:400">(Chrzanów)</span></h1>
    <p>Pogoda z mediany wielu źródeł · ostrzeżenia IMGW · feed zmian</p>
  </header>

  <div class="btns">
    <a class="btn primary" href="/feed.atom">＋ Subskrybuj (Atom)</a>
    <a class="btn ghost" href="/warnings.atom">⚠ Tylko ostrzeżenia</a>
    <button class="btn ghost" id="copy">Kopiuj URL feedu</button>
  </div>

  <div class="card" id="nowCard">
    <div class="now">
      <span class="temp" id="temp">—</span>
      <span>
        <span class="cond" id="cond">ładowanie…</span><br>
        <span class="spread" id="spread"></span>
      </span>
    </div>
    <div class="metrics" id="metrics"></div>
    <div class="src" id="src"></div>
  </div>

  <h2>Aktywne ostrzeżenia</h2>
  <div id="warnings"><p class="empty">—</p></div>

  <h2>Ostatnie zmiany</h2>
  <div class="card" id="entries"><p class="empty">—</p></div>

  <footer>
    Źródła: Open-Meteo · OpenWeather · Visual Crossing · IMGW-PIB.
    Aktualizacja co 2 h (pogoda) i raz dziennie (prognoza).
  </footer>
</main>
<div class="toast" id="toast"></div>

<script>
(function(){
  var PL = {clear:"bezchmurnie",clouds:"zachmurzenie",fog:"mgła",drizzle:"mżawka",
    rain:"deszcz",snow:"śnieg",storm:"burza",unknown:"—"};
  var SRC = {openmeteo:"Open-Meteo",openweather:"OpenWeather",visualcrossing:"Visual Crossing"};

  function fmt(x){ return (x===null||x===undefined) ? "—" : (Math.round(x*10)/10); }
  function el(id){ return document.getElementById(id); }
  function esc(s){ var d=document.createElement("div"); d.textContent=s==null?"":String(s); return d.innerHTML; }

  function toast(msg){
    var t=el("toast"); t.textContent=msg; t.classList.add("show");
    setTimeout(function(){ t.classList.remove("show"); },1600);
  }

  el("copy").addEventListener("click", function(){
    var url=location.origin+"/feed.atom";
    if(navigator.clipboard){ navigator.clipboard.writeText(url).then(function(){toast("Skopiowano: "+url);}); }
    else { toast(url); }
  });

  function renderNow(s){
    if(!s || !s.ensemble){ el("cond").textContent="brak danych — czekam na pierwszy cykl"; el("temp").textContent="—"; return; }
    var e=s.ensemble;
    el("temp").textContent = fmt(e.tempC.median)+"°";
    el("cond").textContent = PL[e.condition] || e.condition;
    if(e.tempC.n>1){ el("spread").textContent = "rozrzut "+fmt(e.tempC.min)+"–"+fmt(e.tempC.max)+"° · "+e.tempC.n+" źródła"; }
    else { el("spread").textContent = "1 źródło"; }
    el("metrics").innerHTML =
      "<span>wiatr <b>"+fmt(e.windMs.median)+"</b> m/s</span>"+
      "<span>wilgotność <b>"+fmt(e.humidity.median)+"</b>%</span>"+
      "<span>ciśnienie <b>"+fmt(e.pressureHpa.median)+"</b> hPa</span>";
    var names=(e.sources||[]).map(function(x){return SRC[x]||x;}).join(", ");
    var when = e.observedAt ? new Date(e.observedAt).toLocaleString("pl-PL") : "";
    el("src").textContent = (names?("Źródła: "+names):"")+(when?(" · "+when):"");
    if(s.imgwStation && s.imgwStation.tempC!=null){
      el("src").textContent += " · stacja IMGW (ref.): "+fmt(s.imgwStation.tempC)+"°";
    }
  }

  function renderWarnings(list){
    var wrap=el("warnings");
    if(!list || !list.length){ wrap.innerHTML='<p class="empty">Brak aktywnych ostrzeżeń.</p>'; return; }
    wrap.innerHTML = list.map(function(w){
      var cls = w.category==="hydro" ? "hydro" : (w.level && w.level>=3 ? "alarm" : "");
      var lvl = (w.level && w.level>=1) ? (" (stopień "+w.level+")") : "";
      var tag = w.category==="hydro" ? "IMGW hydro" : "IMGW";
      var range = (w.from||"?")+" → "+(w.to||"?");
      return '<div class="warn '+cls+'"><div class="wt">'+esc(tag+": "+w.event+lvl)+'</div>'+
        '<div class="wm">'+esc(w.content||"")+'<br>'+esc(range)+'</div></div>';
    }).join("");
  }

  function renderEntries(xmlText){
    var wrap=el("entries");
    try{
      var doc=new DOMParser().parseFromString(xmlText,"application/xml");
      var entries=Array.prototype.slice.call(doc.getElementsByTagName("entry")).slice(0,8);
      if(!entries.length){ wrap.innerHTML='<p class="empty">Brak wpisów — czekam na pierwszą zmianę.</p>'; return; }
      wrap.innerHTML = entries.map(function(en){
        function t(tag){ var n=en.getElementsByTagName(tag)[0]; return n?n.textContent:""; }
        var when=t("published"); var d=when?new Date(when).toLocaleString("pl-PL"):"";
        return '<div class="entry"><div class="et">'+esc(t("title"))+'</div>'+
          '<div class="em">'+esc(t("content"))+'</div><time>'+esc(d)+'</time></div>';
      }).join("");
    }catch(_){ wrap.innerHTML='<p class="empty">Nie udało się wczytać feedu.</p>'; }
  }

  fetch("/state.json").then(function(r){return r.json();}).then(function(s){
    renderNow(s); renderWarnings(s && s.warnings);
  }).catch(function(){ el("cond").textContent="nie udało się wczytać danych"; });

  fetch("/feed.atom").then(function(r){return r.text();}).then(renderEntries)
    .catch(function(){ el("entries").innerHTML='<p class="empty">Nie udało się wczytać feedu.</p>'; });
})();
</script>
</body>
</html>`;
