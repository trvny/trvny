<div align="center">

<img src="assets/banner.svg" alt="trvny" width="100%">

<p align="center">
  <img src="assets/132311.gif" width="75%">
</p>
<br>

[Polski](README_pl.md) · **English** · [简体中文](README_zh.md)

[![feedseek](https://img.shields.io/badge/feed-seek-ff7a18?style=for-the-badge&logo=rss&logoColor=white)](https://trvny.github.io/feedseek) [![tvpi](https://img.shields.io/badge/tvpi-IPTV-2563eb?style=for-the-badge&logo=jellyfin&logoColor=white)](https://trfny.com/tv/)
[![wambridge](https://img.shields.io/badge/wambridge-Samsung_M5-1428a0?style=for-the-badge&logo=samsung&logoColor=white)](https://github.com/travnie/wambridge)
[![weather](https://img.shields.io/badge/weather-KOŚCIELEC-16a34a?style=for-the-badge&logo=cloudflareworkers&logoColor=white)](https://weather.trfny.com)  
[![codebench](https://img.shields.io/badge/codebench-barcodes-111827?style=for-the-badge&logo=qrcode&logoColor=white)](https://codebench.trfny.com) [![streambench](https://img.shields.io/badge/streambench-media-7c3aed?style=for-the-badge&logo=vlcmediaplayer&logoColor=white)](https://streambench.trfny.com) [![docbench](https://img.shields.io/badge/docbench-docs_%26_PDF-b45309?style=for-the-badge&logo=googledocs&logoColor=white)](https://docbench.travny.workers.dev)  
[![Cloudflare](https://workers.cloudflare.com/built-with-cloudflare.svg)](https://trfny.com)  
[![Docs7](https://raw.githubusercontent.com/travnie/.github/main/assets/badges/docs7.svg)](https://twojstar.docs7.io/)
<a href="https://deepwiki.com/trvny/trvny"><img src="https://deepwiki.com/badge.svg" alt="DeepWiki"></a>

</div>

---

### Ja i moje ziomki

<p align="left">
  <img src="assets/ziomki2.png" width="420">
</p>
<a href="https://git.io/typing-svg"><img src="https://readme-typing-svg.demolab.com?font=VT323&weight=600&letterSpacing=-95%25&duration=1234&pause=100&color=D718CE&center=true&random=true&width=500&height=150&lines=Co%C5%9B+si%C4%99+popsu%C5%82o+i+nie+by%C5%82o+mnie+s%C5%82ycha%C4%87;KURDE;2137;twojstarytotwojstary" alt="Typing-SVG" /></a>

## 🔀 Open pull requests

<!--OPEN_PRS:START-->
| Repository | PR | Title | Author | State | Updated |
| --- | ---: | --- | --- | --- | --- |
| trvny/tvpi | [#106](https://github.com/trvny/tvpi/pull/106) | revert: remove ChatGPT WAF automation | @trvny | ready | 2026-09-23 |
| trvny/tvpi | [#107](https://github.com/trvny/tvpi/pull/107) | chore(deps-dev): bump wrangler from 4.131.1 to 4.135.0 in /worker in the worker-toolchain group | @dependabot[bot] | ready | 2026-09-23 |
<!--OPEN_PRS:END-->

**Private command center: projects, services, tools, and drawers in one place.**

## 🧭 Project map

### Main repositories

| project | entry points | what's inside |
|---|---|---|
| 📡 **Feedseek** | [repo](https://github.com/trvny/feedseek) · [site](https://trvny.github.io/feedseek) · [reader](https://trvny.github.io/feedseek/reader/) | RSS/Atom feed generator and publisher for sources without useful native feeds. |
| 🐤 **Kanarek** | [repo](https://github.com/travnie/kanarek) | Android RSS/Atom reader with widgets and radio/IPTV playback. |
| 📺 **TVPI** | [repo](https://github.com/trvny/tvpi) · [site](https://trfny.com/tv/) · [playlist](https://tvpi.travny.workers.dev/playlist.m3u) | Stable IPTV entry points for TVP channels, a Worker, and residential push for refreshing HLS tokens. |
| 🚗 **Autka** | [repo](https://github.com/travnie/Autka) | Android aggregator of car listings from Poland, the EU, and US imports, including import cost calculations. |
| 🤖 **Aistee** | [repo](https://github.com/travnie/aistee) | Kotlin Multiplatform AI workspace combining account-backed WebViews, native/API chats and shared tooling. |
| 🔊 **WAM Bridge** | [repo](https://github.com/travnie/wambridge) | Audio bridge for Samsung Wireless Audio Multiroom speakers and native foobar2000 output for Shape M5. |

### Tools and services

| project | entry | purpose |
|---|---|---|
| 🔳 **[Codebench](https://github.com/travnie/twojstar/tree/main/benches/codebench)** | [codebench.trfny.com](https://codebench.trfny.com) | Private browser-based QR and barcode studio. Data never leaves the browser. |
| 📻 **[Streambench](https://github.com/travnie/twojstar/tree/main/benches/streambench)** | [streambench.trfny.com](https://streambench.trfny.com) | Workshop for testing, organizing, and playing IPTV, radio, HLS, M3U, and XMLTV. |
| 📄 **[Docbench](https://github.com/travnie/twojstar/tree/main/benches/docbench)** | [docbench.travny.workers.dev](https://docbench.travny.workers.dev) | Local-first document and PDF studio for editing, previewing, validating, merging, page operations, and bookmarks. |
| 🌦️ **[weather-feed](https://github.com/travnie/twojstar/tree/main/weather-feed)** | [weather.trfny.com](https://weather.trfny.com) | Multi-source weather and IMGW alerts for Kościelec/Chrzanów, exposed as Atom and JSON. |
| 🩺 **[status-mcp](mcp/status-mcp/)** | MCP | One tool for aggregate health checks of TVPI, Feedseek, Weather, and Autka. |
| 🐾 **[Pet Dispatcher](mcp/pet-dispatcher/)** | local MCP + Worker | Workspace-confined development-machine tools with an outbound-only Cloudflare control plane. |
| 🌀 **[Loopling](loopling/)** | ChatGPT/Codex pet | Procedurally generated desktop pet, installers, previews, and validation assets. |
| 🤖 **[AI core](https://github.com/trvny/.ai)** | [.ai/](.ai/) | Public AI configuration core + private profile, archive, and project skills. |

### 🗄️ Drawers

[`playlists`](stuff/playlists/) · [`configs`](stuff/configs/) ·
[`feeds`](stuff/feeds/) · [`quotes`](stuff/quotes/) · [`other`](stuff/other/)

- **Playlists**: working and test M3U/M3U8 files for Streambench and players.
- **Configs**: shared pieces that are not worth putting in a separate repository.
- **Feeds and quotes**: helper sources used by automations and widgets.

### 🧪 Other repositories

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
<i>❝Go put your creed into the deed. Nor speak with double tongue. — Ralph Emerson❞</i>
<!--ENDS_HERE_QUOTE_README-->
<!-- markdownlint-enable MD033 -->

## 📰 Recently on the air

<!--README_FEED:START-->
- [Untangling the Nuclear Knot: A Constructive Agenda for Managing China’s Nuclear Relations with the United States and Its Allies](https://carnegieendowment.org/research/2026/09/untangling-the-nuclear-knot-a-constructive-agenda-for-managing-chinas-nuclear-relations-with-the-united-states-and-its-allies)
- [Ponad 620 tys. zł przepadło. 33-latek uwierzył oszustom - Przelom.pl - portal ziemi chrzanowskiej](https://news.google.com/atom/articles/CBMiowFBVV95cUxOb2U5dGY5S2tzcXR6WWdwZHBFN2ZNTUhhMFQydnpuNDF3blFPNG0tS3dTdjlOeHVHUjRPdTd4T29wUXRST09ORGZHMjZ2bG9mSXRlbG1qYVdrSllCeDhKX2ZFWnRyWWRjUml0eHhaNmxMTFZfZU9SX196aHJ2NUh4YnR6aWNEUHJtaG9fdmZnMW5BX0I0eUFTS2dtVlhyMzk3X1FR?oc=5)
- [Incident across several services](https://www.githubstatus.com/incidents/8zc63m64hy36)
- [More ways to request and configure Copilot code reviews](https://github.blog/changelog/2026-09-23-copilot-code-review-more-ways-to-request-and-configure-reviews)
- [Warcraft III: Forsaken Kingdom - to już nie jest RTS](https://antyweb.pl/warcraft-iii-forsaken-kingdom-to-juz-nie-jest-rts)
- [EXCLUSIVE: Hacked FBI data has sensitive information about employees’ intelligence roles](https://www.reuters.com/world/hacked-fbi-data-has-sensitive-information-about-employees-intelligence-roles-2026-09-23/)
<!--README_FEED:END-->

<div align="center">

<sub>consolidation over fragmentation · po kolei, na spokojnie</sub>

</div>
