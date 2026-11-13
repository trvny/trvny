  document.querySelectorAll('[data-radio]').forEach((root) => {
    const audio = root.querySelector('[data-audio]');
    const controls = root.querySelector('[data-controls]');
    const play = root.querySelector('[data-play]');
    const volume = root.querySelector('[data-volume]');
    const status = root.querySelector('[data-status]');
    const cover = root.querySelector('[data-cover]');
    const title = root.querySelector('[data-title]');
    const artist = root.querySelector('[data-artist]');
    const album = root.querySelector('[data-album]');
    if (!(audio instanceof HTMLAudioElement) || !(controls instanceof HTMLElement) ||
        !(play instanceof HTMLButtonElement) || !(volume instanceof HTMLInputElement) ||
        !(status instanceof HTMLElement) || !(cover instanceof HTMLImageElement) ||
        !(title instanceof HTMLElement) || !(artist instanceof HTMLElement) || !(album instanceof HTMLElement)) return;

    const stream = audio.getAttribute('src');
    if (!stream) return;
    let wantsPlaying = false;
    let playbackAttempt = 0;
    let timer;
    let fetching = false;
    audio.volume = Number(volume.value);

    function showPlayback(playing, message) {
      root.dataset.playing = String(playing);
      play.setAttribute('aria-pressed', String(playing));
      status.textContent = message;
    }
    function stop() {
      wantsPlaying = false;
      playbackAttempt += 1;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      showPlayback(false, 'Paused');
    }
    async function start() {
      wantsPlaying = true;
      const attempt = ++playbackAttempt;
      audio.src = stream;
      showPlayback(true, 'Connecting…');
      try { await audio.play(); }
      catch { if (wantsPlaying && attempt === playbackAttempt) { wantsPlaying = false; showPlayback(false, 'Stream unavailable. Try again.'); } }
    }
    play.addEventListener('click', () => { if (wantsPlaying) stop(); else void start(); });
    volume.addEventListener('input', () => { audio.volume = Number(volume.value); });
    audio.addEventListener('play', () => {
      if (!wantsPlaying) { wantsPlaying = true; playbackAttempt += 1; showPlayback(true, 'Connecting…'); }
    });
    audio.addEventListener('pause', () => {
      if (audio.paused && wantsPlaying) { wantsPlaying = false; playbackAttempt += 1; showPlayback(false, 'Paused'); }
    });
    audio.addEventListener('playing', () => { if (wantsPlaying) showPlayback(true, 'Playing live'); });
    audio.addEventListener('waiting', () => { if (wantsPlaying) showPlayback(true, 'Buffering…'); });
    audio.addEventListener('error', () => { if (wantsPlaying) { wantsPlaying = false; showPlayback(false, 'Stream unavailable. Try again.'); } });
    cover.addEventListener('error', () => { cover.hidden = true; cover.removeAttribute('src'); });
    audio.hidden = true;
    controls.hidden = false;

    async function refresh() {
      if (document.hidden || fetching) return;
      fetching = true;
      try {
        const response = await fetch('/api/radio-now', { cache:'no-store', signal:AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error('metadata unavailable');
        const track = await response.json();
        title.textContent = track.title;
        artist.textContent = track.artist;
        album.textContent = track.album || '';
        if (track.cover) { cover.src = track.cover; cover.hidden = false; }
        else { cover.hidden = true; cover.removeAttribute('src'); }
      } catch {
        title.textContent = 'Radio Paradise';
        artist.textContent = 'Track details unavailable';
        album.textContent = '';
        cover.hidden = true;
        cover.removeAttribute('src');
      } finally {
        fetching = false;
        clearTimeout(timer);
        if (!document.hidden) timer = setTimeout(refresh, 30000);
      }
    }
    document.addEventListener('visibilitychange', () => {
      clearTimeout(timer);
      if (!document.hidden) void refresh();
    });
    artist.textContent = 'Loading track details…';
    void refresh();
  });
