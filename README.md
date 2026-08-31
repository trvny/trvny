<div align="center">

<img src="assets/banner.svg" alt="trvny" width="100%">

**Private command center: projects, services, tools, and drawers in one place.**

<br>

[Polski](README_pl.md) · **English** · [简体中文](README_zh.md)

[![feedseek](https://img.shields.io/badge/feed-seek-ff7a18?style=for-the-badge&logo=rss&logoColor=white)](https://trvny.github.io/feedseek) [![tvpi](https://img.shields.io/badge/tvpi-IPTV-2563eb?style=for-the-badge&logo=jellyfin&logoColor=white)](https://trfny.com/tv/)
[![wambridge](https://img.shields.io/badge/wambridge-Samsung_M5-1428a0?style=for-the-badge&logo=samsung&logoColor=white)](https://github.com/trvny/wambridge)
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
| trvny/feedseek | [#330](https://github.com/trvny/feedseek/pull/330) | Add Tencent newsroom feed | @trvny | ready | 2026-08-29 |
| trvny/trvny | [#351](https://github.com/trvny/trvny/pull/351) | fix(review): pin AIHubMix worker to merged commit | @trvny | ready | 2026-08-29 |
| trvny/tvpi | [#74](https://github.com/trvny/tvpi/pull/74) | fix(seo): consolidate hub discovery | @trvny | ready | 2026-08-29 |
| trvny/wambridge | [#128](https://github.com/trvny/wambridge/pull/128) | Add foobar sleep timer controls | @trvny | ready | 2026-08-29 |
<!--OPEN_PRS:END-->

## 🧭 Project map

### Main repositories

| project | entry points | what's inside |
|---|---|---|
| 📡 **Feedseek** | [repo](https://github.com/trvny/feedseek) · [site](https://trvny.github.io/feedseek) · [reader](https://trvny.github.io/feedseek/reader/) | RSS/Atom feed generator and publisher for sources without useful native feeds. |
| 🐤 **Kanarek** | [repo](https://github.com/trvny/kanarek) | Android RSS/Atom reader with widgets and radio/IPTV playback. |
| 📺 **TVPI** | [repo](https://github.com/trvny/tvpi) · [site](https://trfny.com/tv/) · [playlist](https://tvpi.travny.workers.dev/playlist.m3u) | Stable IPTV entry points for TVP channels, a Worker, and residential push for refreshing HLS tokens. |
| 🚗 **Autka** | [repo](https://github.com/twojstar/Autka) | Android aggregator of car listings from Poland, the EU, and US imports, including import cost calculations. |
| 🤖 **LlmBench** | [repo](https://github.com/twojstar/llmbench) | Android hub for account-backed AI chats and free-provider LLM access. |
| 🔊 **WAM Bridge** | [repo](https://github.com/trvny/wambridge) | Audio bridge for Samsung Wireless Audio Multiroom speakers and native foobar2000 output for Shape M5. |

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
<i>❝“On two occasions I have been asked, ‘If you put into the machine wrong figures, will the right answers come out?’  I am not able rightly to apprehend the kind of confusion of ideas that could provoke such a question.”— Charles Babbage❞</i>
<!--ENDS_HERE_QUOTE_README-->
<!-- markdownlint-enable MD033 -->

## 📰 Recently on the air

<!--README_FEED:START-->
- [Urban Word of the Day — Salad Days](https://www.urbandictionary.com/define.php?term=Salad%20Days&defid=6122902)
- [Urban Word of the Day — grebo](https://www.urbandictionary.com/define.php?term=grebo&defid=1975218)
- [How to Engage with New Media: A Strategic Guide for Nonprofit Organizations](https://carnegieendowment.org/research/2026/08/how-to-engage-with-new-media-a-strategic-guide-for-nonprofit-organizations)
- [Urban Word of the Day — board chow](https://www.urbandictionary.com/define.php?term=board%20chow&defid=2568411)
- [100 lat na straży! - malopolska.pl](https://news.google.com/atom/articles/CBMickFVX3lxTFBxWXFKbUs0MnJrS3B0V3hET1VNVHRjLXc5RGFEM0ZZdlJoMlhrbjFJeExPNU5pQ2lvdHNfTHRUVG5pV0Z2RzA0Z3lZM1lPWDgzMEswbFdvVXM2RnoydFV2VjdIb05KZk0xbHJEcjNKSDhTdw?oc=5)
- [Nowy rozkład jazdy PKP od 30 sierpnia. Zmiany także na trasie przez Krzeszowice, Trzebinię i Chrzanów - Przelom.pl - portal ziemi chrzanowskiej](https://news.google.com/atom/articles/CBMijwFBVV95cUxQV254VnUyMEllanZ3RFh5YUZEOVlaRDQxREg1SE1wLWtIWmV5cnYwQ2F1UlFXMmk3dmhzQ0NOV2NqQWxpV3h0WVV2ajJuUGYzTnIxWEJEMkY5bk9aTHlWMVpac0djYVM2Q0pHSmlOeHJKWS1nQ19DZG43TzVXVzFaZ191cXl4S0NqZkFmdkt0TQ?oc=5)
<!--README_FEED:END-->

<div align="center">

<sub>consolidation over fragmentation · po kolei, na spokojnie</sub>

</div>
