---
name: devbox-handoff
description: Use when downloading permitted video or audio with yt-dlp and handing finished files from Codespaces to the user's phone, with deletion after stream completion.
---

# Media handoff

1. `devbox install media` if `yt-dlp` / `ffmpeg` missing.
2. `devbox download "URL"` for one video, or `--audio` for MP3; no playlists by default.
3. `devbox files` lists completed filenames under ignored `downloads/`.
4. `devbox handoff "exact filename"` starts a private one-shot HTTP page on port 8765.
5. Open the displayed private Codespaces link on the phone, click **Download file**.
6. The server removes the source after fully writing the response, not after independently verifying Android storage.
7. Interrupted stream retains the file for retry. For VS Code Explorer's normal Download menu, run the explicit cleanup yourself: it cannot signal receipt.
8. Do not publish forwarding port or copy the one-time link. No cookies, DRM workarounds or provider tokens.

Large files consume Codespaces storage until transferred. Never commit media.
