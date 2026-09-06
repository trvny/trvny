<div align="center">

<img src="assets/banner.svg" alt="trvny" width="100%">

**私人控制中心：把项目、服务、工具和各种抽屉收在一个地方。**

<p align="center">
  <img src="assets/132311.gif" width="69%">
</p>
<br>

[Polski](README_pl.md) · [English](README.md) · **简体中文**

[![feedseek](https://img.shields.io/badge/feed-seek-ff7a18?style=for-the-badge&logo=rss&logoColor=white)](https://trvny.github.io/feedseek) [![tvpi](https://img.shields.io/badge/tvpi-IPTV-2563eb?style=for-the-badge&logo=jellyfin&logoColor=white)](https://trfny.com/tv/)
[![wambridge](https://img.shields.io/badge/wambridge-Samsung_M5-1428a0?style=for-the-badge&logo=samsung&logoColor=white)](https://github.com/twojstar/wambridge)
[![weather](https://img.shields.io/badge/weather-KOŚCIELEC-16a34a?style=for-the-badge&logo=cloudflareworkers&logoColor=white)](https://weather.trfny.com)  
[![codebench](https://img.shields.io/badge/codebench-barcodes-111827?style=for-the-badge&logo=qrcode&logoColor=white)](https://codebench.trfny.com) [![streambench](https://img.shields.io/badge/streambench-media-7c3aed?style=for-the-badge&logo=vlcmediaplayer&logoColor=white)](https://streambench.trfny.com) [![docbench](https://img.shields.io/badge/docbench-docs_%26_PDF-b45309?style=for-the-badge&logo=googledocs&logoColor=white)](https://docbench.travny.workers.dev)  
[![Cloudflare](https://workers.cloudflare.com/built-with-cloudflare.svg)](https://trfny.com)  
<a href="https://deepwiki.com/trvny/trvny"><img src="https://deepwiki.com/badge.svg" alt="DeepWiki"></a>
</div>

---

## 🔀 开放的拉取请求

<!--OPEN_PRS:START-->
| 仓库 | PR | 标题 | 作者 | 状态 | 更新 |
| --- | ---: | --- | --- | --- | --- |
| trvny/feedseek | [#367](https://github.com/trvny/feedseek/pull/367) | fix(sources): refresh stale upstreams | @trvny | 就绪 | 2026-09-05 |
| trvny/feedseek | [#368](https://github.com/trvny/feedseek/pull/368) | chore: disable 1337x feed | @trvny | 就绪 | 2026-09-05 |
| trvny/trvny | [#480](https://github.com/trvny/trvny/pull/480) | docs: align repository docs with current tree | @trvny | 就绪 | 2026-09-05 |
<!--OPEN_PRS:END-->

## 🧭 项目地图

### 主要仓库

| 项目 | 入口 | 内容 |
|---|---|---|
| 📡 **Feedseek** | [仓库](https://github.com/trvny/feedseek) · [网站](https://trvny.github.io/feedseek) · [阅读器](https://trvny.github.io/feedseek/reader/) | 为缺少可用原生订阅源的网站生成并发布 RSS/Atom。 |
| 🐤 **Kanarek** | [仓库](https://github.com/twojstar/kanarek) | Android RSS/Atom 阅读器，带桌面小组件以及广播/IPTV 播放。 |
| 📺 **TVPI** | [仓库](https://github.com/trvny/tvpi) · [网站](https://trfny.com/tv/) · [播放列表](https://tvpi.travny.workers.dev/playlist.m3u) | TVP 频道的稳定 IPTV 入口、Cloudflare Worker，以及用于刷新 HLS token 的住宅网络推送方案。 |
| 🚗 **Autka** | [仓库](https://github.com/twojstar/Autka) | Android 二手车聚合器，覆盖波兰、欧盟与美国进口，并包含进口成本计算。 |
| 🤖 **LlmBench** | [仓库](https://github.com/twojstar/llmbench) | Android AI 聊天中心，整合账号登录与免费 LLM 提供商。 |
| 🔊 **WAM Bridge** | [仓库](https://github.com/twojstar/wambridge) | Samsung Wireless Audio Multiroom 音频桥接，以及面向 Shape M5 的原生 foobar2000 输出。 |

### 工具与服务

| 项目 | 在线地址 | 用途 |
|---|---|---|
| 🔳 **[Codebench](https://github.com/twojstar/twojstar/tree/main/benches/codebench)** | [codebench.trfny.com](https://codebench.trfny.com) | 浏览器内运行的私有 QR/条码工作台，数据不会离开浏览器。 |
| 📻 **[Streambench](https://github.com/twojstar/twojstar/tree/main/benches/streambench)** | [streambench.trfny.com](https://streambench.trfny.com) | 用于测试、整理和播放 IPTV、广播、HLS、M3U 与 XMLTV。 |
| 📄 **[Docbench](https://github.com/twojstar/twojstar/tree/main/benches/docbench)** | [docbench.travny.workers.dev](https://docbench.travny.workers.dev) | 本地优先的文档与 PDF 工作台，可编辑、预览、验证、合并、整理页面和书签。 |
| 🌦️ **[weather-feed](https://github.com/twojstar/twojstar/tree/main/weather-feed)** | [weather.trfny.com](https://weather.trfny.com) | Kościelec/Chrzanów 的多源天气与 IMGW 警报，以 Atom 和 JSON 提供。 |
| 🩺 **[status-mcp](mcp/status-mcp/)** | MCP | 汇总检查 TVPI、Feedseek、Weather 和 Autka 健康状态的单一工具。 |
| 🐾 **[Pet Dispatcher](mcp/pet-dispatcher/)** | 本地 MCP + Worker | 限定在工作区内的开发机工具，以及仅出站连接的 Cloudflare 控制平面。 |
| 🌀 **[Loopling](loopling/)** | ChatGPT/Codex pet | 程序化生成的桌面宠物、安装脚本、预览与验证资源。 |
| 💾 **[Remotely Save GDrive patch](remotely-save-gdrive-patch/)** | 本地补丁 | 仅供个人使用的 Google Drive 去重/更新补丁，以及不重新分发构建产物的验证工具。 |
| 🤖 **[AI core](https://github.com/trvny/.ai)** | [.ai/](.ai/) | 公共 AI 配置核心，以及私有配置、归档和项目 skills。 |

## 🗄️ 抽屉

[`playlists`](stuff/playlists/) · [`configs`](stuff/configs/) ·
[`feeds`](stuff/feeds/) · [`quotes`](stuff/quotes/) · [`other`](stuff/other/)

- **Playlists**：供 Streambench 和播放器使用的工作/测试 M3U/M3U8 文件。
- **Configs**：值得共享，但没必要单独建仓库的配置片段。
- **Feeds 与 quotes**：自动化和小组件使用的辅助源。

## 🧪 其他仓库

| 仓库 | 作用 |
|---|---|
| [WiFi-Automatic](https://github.com/trvny/WiFi-Automatic) | 自动控制 Android Wi-Fi 无线状态的应用 fork |

[![gist](https://github-stats-extended.vercel.app/api/gist?id=167d2271e3cf7d21e118aa7d906a7d2c&theme=synthwave)](https://gist.github.com/trvny/167d2271e3cf7d21e118aa7d906a7d2c)

## 我和我的伙计们

<p align="left">
  <img src="assets/ziomki.png" width="420">
</p>

## [许可证](LICENSE) [![代码许可证](https://img.shields.io/github/license/trvny/trvny?label=code&logo=opensourceinitiative&logoColor=white&color=6f42c1&style=flat-square)](https://spdx.org/licenses/ISC)

[ISC](https://spdx.org/licenses/ISC)。[THIRD_PARTY_NOTICES](docs/THIRD_PARTY_NOTICES.md)。

---
## 💬 抽屉里的引语

<!-- markdownlint-disable MD033 -->
<!--STARTS_HERE_QUOTE_README-->
<i>❝IMDb is one of the oldest websites on the internet, and began on Usenet in 1990 as a list of “actresses with beautiful eyes.”❞</i>
<!--ENDS_HERE_QUOTE_README-->
<!-- markdownlint-enable MD033 -->

## 📰 最近播报

<!--README_FEED:START-->
- [How to Engage with New Media: A Strategic Guide for Nonprofit Organizations](https://carnegieendowment.org/research/2026/08/how-to-engage-with-new-media-a-strategic-guide-for-nonprofit-organizations)
- [How the U.S. Export-Import Bank Can Finally Join the Fight Against Climate Change](https://carnegieendowment.org/research/2026/09/renewable-energy-investment-united-states-exim-export-import-bank)
- [Darmowa telewizja na YouTube: ponad 210 oficjalnych kanałów na żywo z Polski i świata, sprawdzanych codziennie](https://promptowy.com/darmowa-telewizja-na-youtube-lista-kanalow-na-zywo/)
- [Przegląd AI: 5 września 2026](https://promptowy.com/przeglad-ai-2026-09-05/)
- [Zamknięcie dnia: Kto traci, gdy AI robi wszystko za nas](https://promptowy.com/zamkniecie-dnia-kto-traci-gdy-ai-robi-wszystko-za-nas/)
- [Putin says US-Russia contacts beneficial as talks begin with Witkoff and Kushner](https://www.reuters.com/world/europe/putin-says-us-russia-contacts-beneficial-talks-begin-with-witkoff-kushner-2026-09-05/)
<!--README_FEED:END-->

<div align="center">

<sub>consolidation over fragmentation · po kolei, na spokojnie</sub>

</div>
