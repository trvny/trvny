<div align="center">

<img src="assets/banner.svg" alt="trvny" width="100%">

**私人控制中心：把项目、服务、工具和各种抽屉收在一个地方。**

<br>

[Polski](README_pl.md) · [English](README.md) · **简体中文**

[![feedseek](https://img.shields.io/badge/feed-seek-ff7a18?style=for-the-badge&logo=rss&logoColor=white)](https://trvny.github.io/feedseek) [![tvpi](https://img.shields.io/badge/tvpi-IPTV-2563eb?style=for-the-badge&logo=jellyfin&logoColor=white)](https://trfny.com/tv/)
[![wambridge](https://img.shields.io/badge/wambridge-Samsung_M5-1428a0?style=for-the-badge&logo=samsung&logoColor=white)](https://github.com/twojstar/wambridge)
[![weather](https://img.shields.io/badge/weather-KOŚCIELEC-16a34a?style=for-the-badge&logo=cloudflareworkers&logoColor=white)](https://weather.trfny.com)  
[![codebench](https://img.shields.io/badge/codebench-barcodes-111827?style=for-the-badge&logo=qrcode&logoColor=white)](https://codebench.trfny.com) [![streambench](https://img.shields.io/badge/streambench-media-7c3aed?style=for-the-badge&logo=vlcmediaplayer&logoColor=white)](https://streambench.trfny.com) [![docbench](https://img.shields.io/badge/docbench-docs_%26_PDF-b45309?style=for-the-badge&logo=googledocs&logoColor=white)](https://docbench.travny.workers.dev)  
[![Cloudflare](https://workers.cloudflare.com/built-with-cloudflare.svg)](https://trfny.com)

[![GitHub Stats](https://github-stats-extended.vercel.app/api/top-langs?username=trvny&layout=donut&hide_title=true&langs_count=10&theme=ambient_gradient)](https://github-stats-extended.vercel.app/api/top-langs?username=trvny&layout=donut&hide_title=true&langs_count=10&theme=ambient_gradient)

</div>

---

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

### 此 monorepo 中的工具

| 项目 | 在线地址 | 用途 |
|---|---|---|
| 🔳 **[Codebench](benches/codebench/)** | [codebench.trfny.com](https://codebench.trfny.com) | 浏览器内运行的私有 QR/条码工作台，数据不会离开浏览器。 |
| 📻 **[Streambench](benches/streambench/)** | [streambench.trfny.com](https://streambench.trfny.com) | 用于测试、整理和播放 IPTV、广播、HLS、M3U 与 XMLTV。 |
| 📄 **[Docbench](benches/docbench/)** | [docbench.travny.workers.dev](https://docbench.travny.workers.dev) | 本地优先的文档与 PDF 工作台，可编辑、预览、验证、合并、整理页面和书签。 |
| 🌦️ **[weather-feed](weather-feed/)** | [weather.trfny.com](https://weather.trfny.com) | Kościelec/Chrzanów 的多源天气与 IMGW 警报，以 Atom 和 JSON 提供。 |
| 🩺 **[status-mcp](mcp/status-mcp/)** | MCP | 汇总检查 TVPI、Feedseek 和 Autka 健康状态的单一工具。 |
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

## [许可证](LICENSE)与[第三方材料](docs/THIRD_PARTY_NOTICES.md)

原创代码与文档采用 [ISC](https://spdx.org/licenses/ISC) 许可。
第三方材料见 [THIRD_PARTY_NOTICES](docs/THIRD_PARTY_NOTICES.md)。
[![code license](https://img.shields.io/github/license/trvny/trvny?label=code&logo=opensourceinitiative&logoColor=white&color=6f42c1&style=flat-square)](https://spdx.org/licenses/ISC)

---
## 💬 抽屉里的引语

<!-- markdownlint-disable MD033 -->
<!--STARTS_HERE_QUOTE_README-->
<i>❝The fact that keyboard have ‘Q’ ‘W’ ‘E’ ‘R’ ‘T’ ‘Y’ types of button: When keyboard was invented, it had buttons in alphabetical order, as a result, the typing speed was too fast and the computer used to hang. So, to reduce the speed of a person, qwerty keyboard were invented.❞</i>
<!--ENDS_HERE_QUOTE_README-->
<!-- markdownlint-enable MD033 -->

## 📰 最近播报

<!--README_FEED:START-->
- [Urban Word of the Day — Back when I lived in upstate new york](https://www.urbandictionary.com/define.php?term=Back%20when%20I%20lived%20in%20upstate%20new%20york&defid=5432275)
- [Urban Word of the Day — Salad Days](https://www.urbandictionary.com/define.php?term=Salad%20Days&defid=6122902)
- [Urban Word of the Day — grebo](https://www.urbandictionary.com/define.php?term=grebo&defid=1975218)
- [How to Engage with New Media: A Strategic Guide for Nonprofit Organizations](https://carnegieendowment.org/research/2026/08/how-to-engage-with-new-media-a-strategic-guide-for-nonprofit-organizations)
- [Urban Word of the Day — board chow](https://www.urbandictionary.com/define.php?term=board%20chow&defid=2568411)
- [BERDZENISHVILI MAMUKA - Gazeta Krakowska](https://news.google.com/atom/articles/CBMi0AFBVV95cUxQLV84Z0gzRmxEUHJWRjNpM2E5dlAzeENfcDBCTGtTU05kNDVhLUVZYzJHeFZSeGdYMkhra1FxRVJnaC1zMENSVmN1TW1lQmxFQ0owd3hUcmNWWnkwNkhyLTBtS1ItQnBQT3BEZFBzYUtTblRDZ2JTMWVMVzlqMzJMZFhzQ29Neml0dDJ3T0duRlZNa09SU3RUc29HSThGa3B2ZGJzUGlFMGtCejBKNnFYU2NHVzd6WTVxMTBSb3lsU2dpeTR5QWlnT243RWZHRVNz?oc=5)
<!--README_FEED:END-->

<div align="center">

<sub>consolidation over fragmentation · po kolei, na spokojnie</sub>

</div>
