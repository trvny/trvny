# Feedboard

A local-first RSS/Atom widget for the Windows 11 Widgets Board.

> Status: early prototype. The provider, feed parser, OPML plumbing and adaptive-card renderer are scaffolded, and CI now produces a locally signed x64 MSIX development artifact. The next gate is an install/render smoke test on a real Windows 11 Widgets Board.

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

`Feedboard CI` builds the x64 provider as a single-project MSIX and uploads a `feedboard-msix-x64` artifact for each relevant PR/push. CI assigns a monotonically increasing development package version, includes the x86/x64 Windows App Runtime dependencies needed by the x64 package, and signs the MSIX with a fresh self-signed development certificate. Only the public `Feedboard.cer` is uploaded; the temporary private signing key is deleted on the runner.

To smoke-test it on Windows 11:

1. Download and unzip the `feedboard-msix-x64` workflow artifact.
2. Run `install-dev-package.ps1` from PowerShell and approve the administrator prompt.
3. The helper verifies that `Feedboard.cer` matches the certificate that signed `Feedboard.msix`, imports the public certificate into `LocalMachine\TrustedPeople`, installs the bundled Windows App Runtime dependencies, and installs Feedboard.
4. Open the Widgets Board, choose **Add widgets**, and look for Feedboard.

The certificate is a development-only trust anchor for this CI artifact. Remove it from `LocalMachine\TrustedPeople` when the build is no longer needed. Production/Store packaging will use a stable publisher identity and a publicly trusted signing route instead.

### Local package build

Requirements:

- Windows 11
- Visual Studio 2022+ with **WinUI application development**
- .NET 8
- Windows App SDK 2.4.x
- a package-signing certificate whose subject exactly matches `CN=Feedboard Development`, or a corresponding local manifest publisher override

The CI workflow is the reference packaging path because it creates the temporary development signing certificate and MSIX together.

## Next passes

1. Install the CI artifact on Windows 11 and verify that Feedboard appears, renders, refreshes and opens articles in the real Widgets Board.
2. Add a tiny WinUI settings window for feed CRUD, refresh interval and OPML import/export.
3. Add per-widget feed selection, unread/read state and ordering.
4. Add JSON Feed and better site icon discovery (`link rel=icon`).
5. Add cache/backoff, duplicate suppression and feed-level error status.

## References

- Microsoft Learn: Windows widget providers, MSIX package signing, single-project MSIX and Windows app CI
- Microsoft Windows App SDK Widgets sample (C# packaged provider)

The COM registration helper is adapted from Microsoft's MIT-licensed Windows App SDK sample and retains its attribution comments.
