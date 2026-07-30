# Foobar2000 bridge

`wambridge-pcm` is the process boundary planned for `foo_out_wam`. It reads
interleaved raw PCM from standard input, waits for the M5 to request the local
HTTP stream, then prints protocol markers on standard output:

```text
WAMBRIDGE READY
WAMBRIDGE PLAYING volume=4
```

The future component will wait for `READY`, write PCM until playback closes,
and then close the helper's standard input.

Manual Windows test:

```powershell
cmd /d /c "ffmpeg -hide_banner -loglevel error -i C:\Music\test.opus -f f32le -acodec pcm_f32le -ar 48000 -ac 2 - | wambridge-pcm --device M5 --sample-rate 48000 --channels 2 --sample-format f32le --format flac --volume 4"
```

Use `--format mp3` to test the lower-bandwidth compatibility profile.
