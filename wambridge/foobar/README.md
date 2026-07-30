# Foobar2000 output

`foo_out_wam` exposes `Samsung M5 (Wi-Fi)` as a foobar2000 2.x x64 output.
It sends foobar's decoded PCM to `wambridge-pcm`, which encodes a FLAC stream
and offers it to the speaker through the existing local HTTP bridge.

## Requirements

- foobar2000 2.x x64
- the WAM Bridge Python package installed
- FFmpeg available to `wambridge-pcm`
- a saved speaker profile, for example `M5`

The component uses the foobar2000 SDK dated `2025-03-07` and implements the
stable `output_v6` API. Network and process work runs outside foobar's playback
thread.

## Configure

Create `%LOCALAPPDATA%\WAMBridge\foobar.ini`:

```ini
[wambridge]
helper=C:\Users\you\path\to\wambridge\.venv\Scripts\wambridge-pcm.exe
device=M5
volume=4
```

`helper` defaults to `wambridge-pcm.exe` from `PATH`, `device` defaults to `M5`,
and `volume` may be omitted to preserve the speaker's current level under the
helper's normal safety ceiling.

The equivalent environment overrides are `WAMBRIDGE_PCM`, `WAMBRIDGE_DEVICE`
and `WAMBRIDGE_VOLUME`.

## Install

Download `foo_out_wam.fb2k-component` from the `WAM Bridge foobar` workflow
artifact, open it with foobar2000, then select:

```text
Preferences → Playback → Output → Samsung M5 (Wi-Fi)
```

The component always sends FLAC to the M5. Foobar's volume slider applies a
software gain to PCM; the physical speaker level remains managed by WAM Bridge.

## Behaviour

- PCM is queued in memory before a background writer feeds the helper.
- Pausing stops new PCM from entering the helper.
- Seeking or changing PCM format clears the queue and starts a fresh WAM
  session.
- A helper crash invalidates the output and is reported in the foobar console.
- The expected startup delay includes the 1.5-second volume-safety silence.

## Manual helper test

<!-- markdownlint-disable-next-line MD013 -->
```powershell
cmd /d /c "ffmpeg -hide_banner -loglevel error -i C:\Music\test.opus -f f32le -acodec pcm_f32le -ar 48000 -ac 2 - | wambridge-pcm --device M5 --sample-rate 48000 --channels 2 --sample-format f32le --format flac --volume 4"
```

Expected protocol markers:

```text
WAMBRIDGE READY
WAMBRIDGE PLAYING volume=4
```
