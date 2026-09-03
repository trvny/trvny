# Feedboard

A local-first RSS/Atom widget for the Windows 11 Widgets Board.

> Status: early prototype. The provider, feed parser, OPML plumbing and adaptive-card renderer are scaffolded, and CI now produces an unsigned x64 MSIX. The next gate is an install/render smoke test on a real Windows 11 Widgets Board.

## Goal

Feedboard should feel like the missing free feed widget in Windows 11:

- RSS 2.0, Atom and RSS 1.0/RDF feeds
- headline list with feed favicon and article thumbnail when available
- small / medium / large widget layouts
- first click expands an article in-place; clicking the expanded article opens the source
- OPML import/export
- local storage, no account and no backend
- refresh while the Widgets Board is active

## Architecture

```text
Feedboard.WidgetProvider
├─ Services/FeedClient.cs      fetch + parse RSS/Atom/RDF
├─ Services/FeedStore.cs       local source persistence
├─ Services/Opml.cs            OPML import/export
├─ Widgets/FeedWidget.cs       widget lifecycle + refresh
├─ Widgets/WidgetCardRenderer  Adaptive Card JSON
├─ Interop/                    packaged COM registration helper
└─ Package.appxmanifest        single-project MSIX + widget registration
```

The Windows 11 board is the Windows Widgets host. Third-party widgets are supplied by a packaged Win32 app (or PWA) and the widget UI is an Adaptive Card. Feedboard follows Microsoft's packaged C# provider shape.

## Current prototype commands

The same executable can manage feeds while the settings UI is still being built:

```powershell
Feedboard.WidgetProvider.exe feeds list
Feedboard.WidgetProvider.exe feeds add https://example.com/feed.xml
Feedboard.WidgetProvider.exe feeds import subscriptions.opml
Feedboard.WidgetProvider.exe feeds export subscriptions.opml
```

Feed definitions are stored in `%LOCALAPPDATA%\Feedboard\feeds.json`.

## MSIX package

`Feedboard CI` builds the x64 provider as a single-project MSIX and uploads a `feedboard-msix-x64` artifact for each relevant PR/push. The artifact is intentionally unsigned for development, so no private signing key is stored in the repository or GitHub Actions.

To smoke-test it on Windows 11:

1. Enable **Developer Mode** in Settings.
2. Download and unzip the `feedboard-msix-x64` workflow artifact.
3. Run `install-dev-package.ps1` from PowerShell.
4. Open the Widgets Board, choose **Add widgets**, and look for Feedboard.

The helper installs the package with `Add-AppxPackage -AllowUnsigned`. Production/Store packaging will use a real publisher identity and signing route later.

### Local package build

Requirements:

- Windows 11
- Visual Studio 2022+ with **WinUI application development**
- .NET 8
- Windows App SDK 2.4.x

From a Developer PowerShell:

```powershell
msbuild feedboard\src\Feedboard.WidgetProvider\Feedboard.WidgetProvider.csproj `
  /restore `
  /p:Configuration=Release `
  /p:Platform=x64 `
  /p:RuntimeIdentifier=win-x64 `
  /p:UapAppxPackageBuildMode=SideloadOnly `
  /p:AppxBundle=Never `
  /p:AppxPackageSigningEnabled=false `
  /p:GenerateAppxPackageOnBuild=true
```

## Next passes

1. Install the CI artifact on Windows 11 and verify that Feedboard appears, renders, refreshes and opens articles in the real Widgets Board.
2. Add a tiny WinUI settings window for feed CRUD, refresh interval and OPML import/export.
3. Add per-widget feed selection, unread/read state and ordering.
4. Add JSON Feed and better site icon discovery (`link rel=icon`).
5. Add cache/backoff, duplicate suppression and feed-level error status.

## References

- Microsoft Learn: Windows widget providers, single-project MSIX and Windows app CI
- Microsoft Windows App SDK Widgets sample (C# packaged provider)

The COM registration helper is adapted from Microsoft's MIT-licensed Windows App SDK sample and retains its attribution comments.
