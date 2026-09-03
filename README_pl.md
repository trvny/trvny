<div align="center">

<img src="assets/banner.svg" alt="trvny" width="100%">

**Prywatny hol dowodzenia: projekty, usługi, narzędzia i szuflady w jednym miejscu.**

<br>

**Polski** · [English](README.md) · [简体中文](README_zh.md)

[![feedseek](https://img.shields.io/badge/feed-seek-ff7a18?style=for-the-badge&logo=rss&logoColor=white)](https://trvny.github.io/feedseek) [![tvpi](https://img.shields.io/badge/tvpi-IPTV-2563eb?style=for-the-badge&logo=jellyfin&logoColor=white)](https://trfny.com/tv/)
[![wambridge](https://img.shields.io/badge/wambridge-Samsung_M5-1428a0?style=for-the-badge&logo=samsung&logoColor=white)](https://github.com/twojstar/wambridge)
[![weather](https://img.shields.io/badge/weather-KOŚCIELEC-16a34a?style=for-the-badge&logo=cloudflareworkers&logoColor=white)](https://weather.trfny.com)  
[![codebench](https://img.shields.io/badge/codebench-barcodes-111827?style=for-the-badge&logo=qrcode&logoColor=white)](https://codebench.trfny.com) [![streambench](https://img.shields.io/badge/streambench-media-7c3aed?style=for-the-badge&logo=vlcmediaplayer&logoColor=white)](https://streambench.trfny.com) [![docbench](https://img.shields.io/badge/docbench-docs_%26_PDF-b45309?style=for-the-badge&logo=googledocs&logoColor=white)](https://docbench.travny.workers.dev)  
[![Cloudflare](https://workers.cloudflare.com/built-with-cloudflare.svg)](https://trfny.com)

[![GitHub Stats](https://github-stats-extended.vercel.app/api/top-langs?username=trvny&layout=donut&hide_title=true&langs_count=10&theme=ambient_gradient)](https://github-stats-extended.vercel.app/api/top-langs?username=trvny&layout=donut&hide_title=true&langs_count=10&theme=ambient_gradient)

</div>

---

## 🧭 Mapa projektów

### Główne repozytoria

| projekt | wejścia | co tam siedzi |
|---|---|---|
| 📡 **Feedseek** | [repo](https://github.com/trvny/feedseek) · [strona](https://trvny.github.io/feedseek) · [czytnik](https://trvny.github.io/feedseek/reader/) | Generator i publikator RSS/Atom dla źródeł bez użytecznych natywnych feedów. |
| 🐤 **Kanarek** | [repo](https://github.com/twojstar/kanarek) | Androidowy czytnik RSS/Atom, widżety oraz odtwarzacz radia/IPTV. |
| 📺 **TVPI** | [repo](https://github.com/trvny/tvpi) · [strona](https://trfny.com/tv/) · [playlista](https://tvpi.travny.workers.dev/playlist.m3u) | Stabilne wejścia IPTV do kanałów TVP, Worker oraz residential-push do odświeżania tokenów HLS. |
| 🚗 **Autka** | [repo](https://github.com/twojstar/Autka) | Androidowy agregator ofert samochodów z Polski, UE i importu z USA, razem z kalkulacją kosztu sprowadzenia. |
| 🤖 **LlmBench** | [repo](https://github.com/twojstar/llmbench) | Androidowy hub do czatów AI przez konta oraz darmowych providerów LLM. |
| 🔊 **WAM Bridge** | [repo](https://github.com/twojstar/wambridge) | Most audio do głośników Samsung Wireless Audio Multiroom oraz natywne wyjście foobar2000 dla Shape M5. |

### Narzędzia w tym monorepo

| projekt | live | przeznaczenie |
|---|---|---|
| 🔳 **[Codebench](benches/codebench/)** | [codebench.trfny.com](https://codebench.trfny.com) | Prywatne, przeglądarkowe studio QR i kodów kreskowych. Dane nie opuszczają przeglądarki. |
| 📻 **[Streambench](benches/streambench/)** | [streambench.trfny.com](https://streambench.trfny.com) | Warsztat do testowania, porządkowania i odtwarzania IPTV, radia, HLS, M3U oraz XMLTV. |
| 📄 **[Docbench](benches/docbench/)** | [docbench.travny.workers.dev](https://docbench.travny.workers.dev) | Lokalne studio dokumentów i PDF do edycji, podglądu, walidacji, łączenia, operacji na stronach i zakładkach. |
| 🌦️ **[weather-feed](weather-feed/)** | [weather.trfny.com](https://weather.trfny.com) | Wieloźródłowa pogoda i alerty IMGW dla Kościelca/Chrzanowa, wystawione jako Atom i JSON. |
| 🩺 **[status-mcp](mcp/status-mcp/)** | MCP | Jedno narzędzie do zbiorczego sprawdzania zdrowia TVPI, Feedseek i Autek. |
| 🤖 **[AI core](https://github.com/trvny/.ai)** | [.ai/](.ai/) | Publiczny rdzeń konfiguracji AI + prywatny profil, archiwum i projektowe skillsy. |

## 🗄️ Szuflady

[`playlists`](stuff/playlists/) · [`configs`](stuff/configs/) ·
[`feeds`](stuff/feeds/) · [`quotes`](stuff/quotes/) · [`other`](stuff/other/)

- **Playlisty**: robocze i testowe M3U/M3U8 dla Streambencha oraz
  odtwarzaczy.
- **Konfiguracje**: rzeczy współdzielone, których nie warto zamykać w osobnym
  repo.
- **Feedy i cytaty**: źródła pomocnicze używane przez automaty i widżety.

## 🧪 Pozostałe repozytoria

| repo | rola |
|---|---|
| [WiFi-Automatic](https://github.com/trvny/WiFi-Automatic) | fork aplikacji automatyzującej radio Wi-Fi na Androidzie |

[![gist](https://github-stats-extended.vercel.app/api/gist?id=167d2271e3cf7d21e118aa7d906a7d2c&theme=synthwave)](https://gist.github.com/trvny/167d2271e3cf7d21e118aa7d906a7d2c)

## [Licencja](LICENSE) i [materiały zewnętrzne](docs/THIRD_PARTY_NOTICES.md)

Oryginalny kod i dokumentację obejmuje [ISC](https://spdx.org/licenses/ISC).
[THIRD_PARTY_NOTICES](docs/THIRD_PARTY_NOTICES.md).
[![code license](https://img.shields.io/github/license/trvny/trvny?label=code&logo=opensourceinitiative&logoColor=white&color=6f42c1&style=flat-square)](https://spdx.org/licenses/ISC)

---
## 💬 Cytat z szuflady

<!-- markdownlint-disable MD033 -->
<!--STARTS_HERE_QUOTE_README-->
<i>❝“There’s no obfuscated Perl contest because it’s pointless.”— Jeff Polk❞</i>
<!--ENDS_HERE_QUOTE_README-->
<!-- markdownlint-enable MD033 -->

## 📰 Ostatnio w eterze

<!--README_FEED:START-->
- [How to Engage with New Media: A Strategic Guide for Nonprofit Organizations](https://carnegieendowment.org/research/2026/08/how-to-engage-with-new-media-a-strategic-guide-for-nonprofit-organizations)
- [Zestaw Lego PlayStation już w sklepach. Mamy pierwsze zdjęcie](https://antyweb.pl/zestaw-lego-playstation-juz-w-sklepach-mamy-pierwsze-zdjecie)
- [15-letni Adam zginął pod Olkuszem. Bliscy podejrzanego przerwali milczenie - Fakt](https://news.google.com/atom/articles/CBMivAFBVV95cUxOejVDdXZiZEhmVXBrOURFazl2dXZmRGk2MFY5QjZsVXBHcWkwVWJLUHI5WmZNSlpMY0FCRVZ5elI4elozUm5oTFhsSVNVSVgtdWFDV2xPV25weG5SX1pOZGxJS1d3SGM0U0lDaEpjYXd4b25FWmFhMmM0Z09Xbjl2am1waEhoTWhYT2NHeUd1Q28wQVpIMmVnYmE2Xy1zNU5POV9JYW10VUtwU0JMZmNOTXZ6MkdEVi1XZjM3dg?oc=5)
- [Product of the Day — A Bike That Has A Motor And Protects From The Elements](https://anycrap.shop/product/a-bike-that-has-a-motor-and-protects-from-the-elements)
- [Cat Fact of the Day](https://github.com/wh-iterabb-it/meowfacts)
- [Joke of the Day](http://www.laughnet.net/archive/jokes/groan.htm)
<!--README_FEED:END-->

<div align="center">

<sub>consolidation over fragmentation · po kolei, na spokojnie</sub>

</div>
