# remotely-save-gdrive-patch

Third-party patch for the [Remotely Save](https://github.com/remotely-save/remotely-save)
Obsidian plugin: its Google Drive backend `writeFile`/`mkdir` always `POST` a new file
instead of updating the existing one, so Drive accumulates duplicate copies of every
note on each sync.

Upstream ships the Google Drive backend only in the built `main.js` - the source tree
(`src/fsGoogleDrive.ts` and friends) is closed, "pro"-only, and does not exist in the
public repo. There is nothing to fork or patch at the source level, so this patches the
minified `main.js` directly by locating the Google Drive class body and splicing in a
name+parent lookup, switching the upload calls to `PATCH` on an existing file id, and
trashing extra duplicate **files** it finds along the way (folders are never trashed).

## Files

- `patch_gdrive.py` - applies the patch to a `main.js`. `python patch_gdrive.py [path] [--apply]`;
  without `--apply` it only reports whether every anchor matches. Defaults to the local
  Obsidian vault's installed copy when no path is given.
- `build_test.py` - `python build_test.py <patched_main.js> <out.mjs>` extracts the patched
  class and writes it as a standalone ES module importing `test_stubs.mjs`.
- `test_stubs.mjs` - real exports for the handful of symbols the compiled bundle provides
  around the Drive class (same short names as the actual minified build, on purpose - the
  extracted class calls them directly).
- `test_runner.mjs` - `node test_runner.mjs <out.mjs>` dynamically imports the generated
  class module and runs 9 dedup/upload checks against a fake Drive. No Obsidian, no real
  Drive account, no network.

## Anchors are pinned to a specific upstream build

Every anchor is an exact substring of the *minified* `main.js`. A new upstream release
reminifies and very likely renames the local variables the anchors depend on
(`Vp`, `kh`, `Bh`, ...), so a version bump usually needs the anchors re-derived by hand
against the new build. `patch_gdrive.py` aborts loudly ("an anchor did not match exactly
once") instead of silently no-op'ing or writing something broken - that failure is the
signal that this file needs updating, not a bug.

## Rolling release

`.github/workflows/remotely-save-gdrive-patch-release.yml` downloads upstream's latest
release assets (`main.js`, `manifest.json`, `styles.css`), applies the patch, runs the
generated test, and republishes the three files under the moving
`remotely-save-gdrive-patch-latest` tag - same pattern as `kanarek`/`autka`'s rolling
releases (moving tag, assets replaced in place, no per-version history). It triggers on
push to this directory or the workflow file,
plus manual `workflow_dispatch` - deliberately **no schedule**, since a scheduled run
would just fail loudly (burning private-repo Actions minutes) every time upstream ships
a build the anchors do not match, with nobody watching. Re-run it by hand after an
upstream release to notice a mismatch, or after fixing one.

## Installing the patched build

Obsidian's own plugin updater does not know about this fork and will overwrite the
patched `main.js` with vanilla upstream on its next auto-update - that is what originally
required re-applying the patch by hand after every plugin update. Two ways around it:

- Manual: download `main.js`/`manifest.json`/`styles.css` from the
  `remotely-save-gdrive-patch-latest` release and drop them into
  `<vault>/.obsidian/plugins/remotely-save/`, replacing Obsidian's own copies. Disable
  auto-update for this plugin so Obsidian does not silently revert it.
- [BRAT](https://github.com/TfTHacker/obsidian42-brat) can track a manifest-carrying
  release like this one directly, without going through the Obsidian community list.
