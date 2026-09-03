<div align="center">

<img src="assets/banner.svg" alt="trvny" width="100%">

**Private command center: projects, services, tools, and drawers in one place.**

<br>

[Polski](README_pl.md) · **English** · [简体中文](README_zh.md)

[![feedseek](https://img.shields.io/badge/feed-seek-ff7a18?style=for-the-badge&logo=rss&logoColor=white)](https://trvny.github.io/feedseek) [![tvpi](https://img.shields.io/badge/tvpi-IPTV-2563eb?style=for-the-badge&logo=jellyfin&logoColor=white)](https://trfny.com/tv/)
[![wambridge](https://img.shields.io/badge/wambridge-Samsung_M5-1428a0?style=for-the-badge&logo=samsung&logoColor=white)](https://github.com/twojstar/wambridge)
[![weather](https://img.shields.io/badge/weather-KOŚCIELEC-16a34a?style=for-the-badge&logo=cloudflareworkers&logoColor=white)](https://weather.trfny.com)  
[![codebench](https://img.shields.io/badge/codebench-barcodes-111827?style=for-the-badge&logo=qrcode&logoColor=white)](https://codebench.trfny.com) [![streambench](https://img.shields.io/badge/streambench-media-7c3aed?style=for-the-badge&logo=vlcmediaplayer&logoColor=white)](https://streambench.trfny.com) [![docbench](https://img.shields.io/badge/docbench-docs_%26_PDF-b45309?style=for-the-badge&logo=googledocs&logoColor=white)](https://docbench.travny.workers.dev)  
[![Cloudflare](https://workers.cloudflare.com/built-with-cloudflare.svg)](https://trfny.com)  
<a href="https://deepwiki.com/trvny/trvny"><img src="https://deepwiki.com/badge.svg" alt="DeepWiki"></a>

[![GitHub Stats](https://github-stats-extended.vercel.app/api/top-langs?username=trvny&layout=donut&hide_title=true&langs_count=10&theme=ambient_gradient)](https://github-stats-extended.vercel.app/api/top-langs?username=trvny&layout=donut&hide_title=true&langs_count=10&theme=ambient_gradient)

</div>

---

## 🔀 Open pull requests

<!--OPEN_PRS:START-->
| Repository | PR | Title | Author | State | Updated |
| --- | ---: | --- | --- | --- | --- |
| trvny/trvny | [#406](https://github.com/trvny/trvny/pull/406) | feat: add Pet Dispatcher remote transport | @trvny | ready | 2026-09-02 |
| trvny/trvny | [#408](https://github.com/trvny/trvny/pull/408) | feat(review): move Kanarek review to webhooks | @trvny | ready | 2026-09-02 |
| trvny/tvpi | [#79](https://github.com/trvny/tvpi/pull/79) | chore(deps-dev): bump wrangler from 4.125.0 to 4.127.1 in /worker in the worker-toolchain group | @dependabot[bot] | ready | 2026-09-02 |
<!--OPEN_PRS:END-->

## 🧭 Project map

### Main repositories

| project | entry points | what's inside |
|---|---|---|
| 📡 **Feedseek** | [repo](https://github.com/trvny/feedseek) · [site](https://trvny.github.io/feedseek) · [reader](https://trvny.github.io/feedseek/reader/) | RSS/Atom feed generator and publisher for sources without useful native feeds. |
| 🐤 **Kanarek** | [repo](https://github.com/twojstar/kanarek) | Android RSS/Atom reader with widgets and radio/IPTV playback. |
| 📺 **TVPI** | [repo](https://github.com/trvny/tvpi) · [site](https://trfny.com/tv/) · [playlist](https://tvpi.travny.workers.dev/playlist.m3u) | Stable IPTV entry points for TVP channels, a Worker, and residential push for refreshing HLS tokens. |
| 🚗 **Autka** | [repo](https://github.com/twojstar/Autka) | Android aggregator of car listings from Poland, the EU, and US imports, including import cost calculations. |
| 🤖 **LlmBench** | [repo](https://github.com/twojstar/llmbench) | Android hub for account-backed AI chats and free-provider LLM access. |
| 🔊 **WAM Bridge** | [repo](https://github.com/twojstar/wambridge) | Audio bridge for Samsung Wireless Audio Multiroom speakers and native foobar2000 output for Shape M5. |

### Tools in this monorepo

| project | live | purpose |
|---|---|---|
| 🔳 **[Codebench](benches/codebench/)** | [codebench.trfny.com](https://codebench.trfny.com) | Private browser-based QR and barcode studio. Data never leaves the browser. |
| 📻 **[Streambench](benches/streambench/)** | [streambench.trfny.com](https://streambench.trfny.com) | Workshop for testing, organizing, and playing IPTV, radio, HLS, M3U, and XMLTV. |
| 📄 **[Docbench](benches/docbench/)** | [docbench.travny.workers.dev](https://docbench.travny.workers.dev) | Local-first document and PDF studio for editing, previewing, validating, merging, page operations, and bookmarks. |
| 🌦️ **[weather-feed](weather-feed/)** | [weather.trfny.com](https://weather.trfny.com) | Multi-source weather and IMGW alerts for Kościelec/Chrzanów, exposed as Atom and JSON. |
| 🩺 **[status-mcp](mcp/status-mcp/)** | MCP | One tool for aggregate health checks of TVPI, Feedseek, and Autka. |
| 🤖 **[AI core](https://github.com/trvny/.ai)** | [.ai/](.ai/) | Public AI configuration core + private profile, archive, and project skills. |

## 🗄️ Drawers

[`playlists`](stuff/playlists/) · [`configs`](stuff/configs/) ·
[`feeds`](stuff/feeds/) · [`quotes`](stuff/quotes/) · [`other`](stuff/other/)

- **Playlists**: working and test M3U/M3U8 files for Streambench and players.
- **Configs**: shared pieces that are not worth putting in a separate repository.
- **Feeds and quotes**: helper sources used by automations and widgets.

## 🧪 Other repositories

| repo | role |
|---|---|
| [WiFi-Automatic](https://github.com/trvny/WiFi-Automatic) | fork of an Android app that automates Wi-Fi radio state |

[![gist](https://github-stats-extended.vercel.app/api/gist?id=167d2271e3cf7d21e118aa7d906a7d2c&theme=synthwave)](https://gist.github.com/trvny/167d2271e3cf7d21e118aa7d906a7d2c)

## [License](LICENSE) [![code license](https://img.shields.io/github/license/trvny/trvny?label=code&logo=opensourceinitiative&logoColor=white&color=6f42c1&style=flat-square)](https://spdx.org/licenses/ISC)

[ISC](https://spdx.org/licenses/ISC). [THIRD_PARTY_NOTICES](docs/THIRD_PARTY_NOTICES.md).

---
## 💬 Quote from the drawer

<!-- markdownlint-disable MD033 -->
<!--STARTS_HERE_QUOTE_README-->
<i>❝“There’s no obfuscated Perl contest because it’s pointless.”— Jeff Polk❞</i>
<!--ENDS_HERE_QUOTE_README-->
<!-- markdownlint-enable MD033 -->

## 📰 Recently on the air

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
