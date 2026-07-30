# WAM Bridge

Windows-first proof of concept for streaming audio over Wi-Fi to Samsung
Wireless Audio Multiroom speakers, including Shape M5 (`WAM550`/`WAM551`).

It runs FFmpeg locally, exposes a tokenized HTTP stream in the LAN and starts
it through Samsung's local `SetUrlPlayback` API. Source formats are decoded by
FFmpeg, so Opus, Ogg Vorbis, AAC, FLAC, MP3 and radio streams can all be sent
as a conservative FLAC or MP3 stream understood by the speaker.

## Status

First-stage CLI proof of concept. Foobar2000 output integration and a Windows
tray application are intentionally left for separate stages after validation
on a real M5.

## Requirements

- Windows 10/11 or another system with Python 3.11+
- FFmpeg available in `PATH`
- computer and speaker reachable in the same LAN
- Windows Firewall access for Python on private networks

## Install

```powershell
cd wambridge
py -m venv .venv
.\.venv\Scripts\Activate.ps1
py -m pip install -e .
```

Confirm FFmpeg is visible:

```powershell
ffmpeg -version
```

## Use

Discover speakers:

```powershell
wambridge --discover
```

Discovery sends repeated SSDP requests through every active IPv4 adapter.
When old firmware stays silent, it falls back to checking Samsung's API on
port `55001` in nearby `/24` networks. The result shows whether the speaker
was found through `ssdp` or `api-scan`.

Useful diagnostics:

```powershell
wambridge --discover --verbose
wambridge --discover --interface 192.168.1.25
wambridge --discover --no-scan
```

### Saved devices

A DHCP address may change. Save the speaker once under an alias instead of
using its IP permanently:

```powershell
wambridge --speaker 10.0.0.118 --remember M5
wambridge --list-devices
wambridge --device M5 --probe
wambridge "D:\Music\track.opus" --device M5
```

The profile stores the speaker's stable `device_id` and only caches its last
working IP. If the address stops matching that ID, WAM Bridge searches the
LAN, finds the same device and updates the profile. On Windows profiles are
stored in `%LOCALAPPDATA%\WAMBridge\devices.json`; this is also the device
source planned for the foobar2000 component.

Remove a saved profile:

```powershell
wambridge --forget M5
```

### Startup volume safety

Old WAM firmware may jump to a high volume while switching to URL playback.
WAM Bridge keeps the speaker at `0`, starts the stream with 1.5 seconds of
silence, then applies the requested level after decoding has begun. Without
an explicit value, the current level is preserved only up to the default
ceiling of `10`.

Choose an explicit level:

```powershell
wambridge "D:\Music\track.opus" --device M5 --volume 6
```

Change only the safety ceiling while preserving quieter current settings:

```powershell
wambridge "D:\Music\track.opus" --device M5 --max-start-volume 20
```

Test a known speaker:

```powershell
wambridge --speaker 192.168.1.50 --probe
```

Play an internet radio stream:

```powershell
wambridge "https://example.net/radio-stream" --speaker 192.168.1.50
```

Play a local Opus or Ogg file:

```powershell
wambridge "D:\Music\track.opus" --speaker 192.168.1.50
wambridge "D:\Music\track.ogg" --speaker 192.168.1.50
```

Use MP3 output when FLAC is unstable on a particular firmware:

```powershell
wambridge "D:\Music\track.opus" --speaker 192.168.1.50 --format mp3
```

When exactly one WAM speaker is discovered, `--speaker` may be omitted.

## Notes

- The local stream uses HTTP/1.0 without chunked transfer for compatibility
  with old firmware.
- The URL contains a random session token and exists only while the command
  is running.
- Do not expose port `55001` or the bridge HTTP port to the internet.
- URL playback in Samsung firmware has unreliable pause/resume behaviour.
  This PoC stops the session instead of attempting to preserve it.
- `SetUrlPlayback` may freeze malformed firmware when the served body is not
  audio. The bridge only exposes FFmpeg output and returns `404` for other
  paths.

## Validate

```powershell
py -m unittest discover -s tests -v
```
