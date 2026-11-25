# GitHubowa Kraina

> An interactive atlas of public trvny and travnie projects.

Page: <https://bartek.lol/teksty/githubowa-kraina/>
Structured region data: <https://bartek.lol/teksty/githubowa-kraina/atlas.json>
Languages: PL, EN, RU, ZH. The separate infrastructure map is English.
Infrastructure map: <https://bartek.lol/teksty/githubowa-kraina/universe.html>

Choose a region, then a place for its description and destination. Project repositories remain the authority for current details.

Browser WebMCP: `search_travny_projects` (optional query and region). HTTP clients can read the structured atlas directly; no authentication required.

## Regions

### Feedseek

The observatory for generated and enhanced feeds.

Project: <https://github.com/trvny/feedseek>

- [Feed directory](https://trvny.github.io/feedseek/): Browse the published RSS, Atom and JSON feeds.
- [Web reader](https://trvny.github.io/feedseek/reader/): Read entries from the Feedseek catalogue in a browser.
- [Source registry](https://github.com/trvny/feedseek/blob/main/feeds.yaml): The configuration that lists feed sources and generators.
- [Model feeds](https://github.com/trvny/feedseek/blob/main/docs/model-feeds.md): Machine-readable feed output and guidance for agents.

### Kanarek

Android news, widgets and streaming in one app.

Project: <https://github.com/travnie/Kanarek>

- [News reader](https://github.com/travnie/Kanarek#news): Follow RSS and Atom sources, save articles and use offline content.
- [Home-screen widget](https://github.com/travnie/Kanarek): A configurable news slideshow with navigation and source settings.
- [Radio and TV](https://github.com/travnie/Kanarek): Background radio and IPTV playback with playlists and Cast.
- [Optional Worker](https://github.com/travnie/Kanarek): An optional Cloudflare backend for fetching and network features. The app can parse feeds directly.

### WAM Bridge

Local Wi-Fi audio bridge for Samsung speakers on Windows and Android.

Project: <https://github.com/travnie/wambridge>

- [Audio bridge](https://github.com/travnie/wambridge): A local stream and Samsung playback API send audio to supported speakers.
- [foobar2000 output](https://github.com/travnie/wambridge): A component streams audio playing in foobar2000, including internet radio.
- [Speaker compatibility](https://github.com/travnie/wambridge#speaker-compatibility): Shape M5 WAM550 was tested; other models remain candidates.
- [Android adapter](https://github.com/travnie/wambridge#status-working-rolling-release): Speaker discovery, radio, UPnP renderer, Quick Settings and widgets; physical playback reliability varies.

### Aistee

An Android-first AI workbench with shared Kotlin Multiplatform logic.

Project: <https://github.com/travnie/aistee>

- [Android app](https://github.com/travnie/aistee): The first client for a workbench bringing multiple AI providers together.
- [Provider connections](https://github.com/travnie/aistee): Use native providers and web-based services from one workbench.
- [Shared core](https://github.com/travnie/aistee): Kotlin Multiplatform hosts shared provider and domain logic. Desktop and iOS are planned.
- [Rolling APK](https://github.com/travnie/aistee/releases): The current rolling Android build, published by the project.

### Autka

A car-shopping project spanning Poland, Europe and US imports.

Project: <https://github.com/travnie/Autka>

- [Car shopping](https://github.com/travnie/Autka): Brings marketplace routes and car-shopping tools together. Reliable licensed listings remain a project constraint.
- [Import calculator](https://github.com/travnie/Autka): Estimates the cost of bringing a car from the USA to Poland.
- [Android app](https://github.com/travnie/Autka): The Android-first open-source project and its current development status.

### TVPI

Stable entry points for TVP IPTV streams.

Project: <https://github.com/trvny/tvpi>

- [TV player](https://bartek.lol/tv/): Open the TVP channels from the TRAVNY hub.
- [Stable playlist](https://tvpi.travny.workers.dev/playlist.m3u): A saveable M3U with Worker endpoints for each channel.
- [Residential refresh](https://github.com/trvny/tvpi): A Polish home connection can refresh upstream manifests. Continuous availability is not guaranteed.

### twojstar workshop

A shared home for tools, utilities and experiments.

Project: <https://github.com/travnie/twojstar>

- [Codebench](https://codebench.bartek.lol/): Generate, scan and export QR codes and barcodes in the browser.
- [Streambench](https://streambench.bartek.lol/): A local-first workshop for IPTV, radio, playlists and streams.
- [Docbench](https://docbench.bartek.lol/): Work with documents and PDFs locally in the browser.
- [Weather Feed](https://weather.bartek.lol/): Local weather, air quality and alerts for Kościelec and Chrzanów.
- [Feedboard](https://github.com/travnie/twojstar/tree/main/feedboard): Windows 11 feed widget and settings application.
- [Paint.NET plugins](https://github.com/travnie/twojstar/tree/main/addons/paintdotnet): ICO import/export, AI Restore, DeJPEG, Denoise and Smart Transparency; local image processing.
- [Audacity plugins](https://github.com/travnie/twojstar/tree/main/addons/audacity): Auto Declip VST3 and experimental Smart Transition for cut/join repair on Windows and Linux.
- [Intent Keyboard](https://github.com/travnie/twojstar/tree/main/intent-keyboard): An experiment turning rough intent into natural text.
- [Xiaomi ADB Tools](https://github.com/travnie/twojstar/tree/main/xiaomi-adb-tools): Desktop ADB/Fastboot utility with platform-specific JavaFX builds.
- [SpaceMolt / SMX](https://github.com/travnie/twojstar/tree/main/spacemolt): SpaceMolt v2 CLI companion and game tooling.
- [GPTomek pet](https://github.com/travnie/twojstar/tree/main/pets/gptomek): Animated teal token gremlin for ChatGPT and Codex.
- [Loopling pet](https://github.com/travnie/twojstar/tree/main/pets/loopling): Procedurally generated desktop pet with animation atlas and installers.
- [Remotely Save GDrive patch](https://github.com/travnie/twojstar/tree/main/addons/remotely-save-gdrive-patch): Personal-use Google Drive deduplication/update patch and verification harness; no redistributed upstream code.

## Other routes

- [.ai](https://github.com/trvny/.ai): portable AI profiles, instructions, adapters and skills.
- [WiFi-Automatic](https://github.com/trvny/WiFi-Automatic): maintained Android Wi-Fi automation fork.
- [trvny](https://github.com/trvny) and [travnie](https://github.com/travnie): GitHub profile and organization.
