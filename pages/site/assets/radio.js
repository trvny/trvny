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
    const picker = root.querySelector('[data-station-picker]');
    const station = root.querySelector('[data-station]');
    const mark = root.querySelector('[data-mark]');
    const markLabel = root.querySelector('[data-mark-label]');
    const quality = root.querySelector('.radio-footer [data-quality]');
    if (!(audio instanceof HTMLAudioElement) || !(controls instanceof HTMLElement) ||
        !(play instanceof HTMLButtonElement) || !(volume instanceof HTMLInputElement) ||
        !(status instanceof HTMLElement) || !(cover instanceof HTMLImageElement) ||
        !(title instanceof HTMLElement) || !(artist instanceof HTMLElement) || !(album instanceof HTMLElement) ||
        !(picker instanceof HTMLElement) || !(station instanceof HTMLSelectElement) ||
        !(mark instanceof HTMLElement) || !(markLabel instanceof HTMLElement) || !(quality instanceof HTMLElement)) return;

    let wantsPlaying = false;
    let playbackAttempt = 0;
    let awaitingPlayback = false;
    let metadataVersion = 0;
    let timer;
    let hls;
    let hlsLoading;
    audio.volume = Number(volume.value);

    function loadHls() {
      if (window.Hls) return Promise.resolve(window.Hls);
      if (!hlsLoading) {
        hlsLoading = new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = '/assets/vendor/hls.min.js';
          script.onload = () => window.Hls ? resolve(window.Hls) : reject(new Error('HLS unavailable'));
          script.onerror = () => { script.remove(); reject(new Error('HLS unavailable')); };
          document.head.appendChild(script);
        }).catch((error) => { hlsLoading = undefined; throw error; });
      }
      return hlsLoading;
    }
    function showPlayback(playing, message) {
      root.dataset.playing = String(playing);
      play.setAttribute('aria-pressed', String(playing));
      status.textContent = message;
    }
    function stop() {
      wantsPlaying = false;
      playbackAttempt += 1;
      awaitingPlayback = false;
      audio.pause();
      if (hls) { hls.destroy(); hls = undefined; }
      audio.removeAttribute('src');
      audio.load();
      showPlayback(false, 'Paused');
    }
    function fail(attempt) {
      if (wantsPlaying && attempt === playbackAttempt) {
        stop();
        showPlayback(false, 'Stream unavailable. Try again.');
      }
    }
    async function start() {
      wantsPlaying = true;
      awaitingPlayback = true;
      const attempt = ++playbackAttempt;
      if (hls) { hls.destroy(); hls = undefined; }
      const option = station.selectedOptions[0];
      showPlayback(true, 'Connecting…');
      try {
        if (option.dataset.kind === 'hls' && !audio.canPlayType('application/vnd.apple.mpegurl')) {
          const Hls = await loadHls();
          if (!wantsPlaying || attempt !== playbackAttempt) return;
          if (!Hls.isSupported()) throw new Error('HLS unsupported');
          hls = new Hls({ enableWorker: false });
          hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) fail(attempt); });
          const attached = new Promise((resolve) => hls.on(Hls.Events.MEDIA_ATTACHED, resolve));
          hls.loadSource(option.dataset.url);
          hls.attachMedia(audio);
          await attached;
          if (!wantsPlaying || attempt !== playbackAttempt) return;
        } else {
          audio.src = option.dataset.url;
        }
        await audio.play();
      } catch { fail(attempt); }
    }
    play.addEventListener('click', () => { if (wantsPlaying) stop(); else void start(); });
    volume.addEventListener('input', () => { audio.volume = Number(volume.value); });
    station.addEventListener('change', () => {
      const resume = wantsPlaying;
      stop();
      metadataVersion += 1;
      clearTimeout(timer);
      const option = station.selectedOptions[0];
      mark.textContent = option.dataset.mark;
      markLabel.textContent = option.textContent;
      quality.textContent = option.dataset.quality;
      title.textContent = option.textContent;
      artist.textContent = station.value === 'paradise' ? 'Loading track details…' : 'Live radio';
      album.textContent = '';
      cover.hidden = true;
      cover.removeAttribute('src');
      if (station.value === 'paradise') void refresh();
      else if (!audio.canPlayType('application/vnd.apple.mpegurl')) void loadHls().catch(() => {});
      if (resume) void start();
    });
    audio.addEventListener('play', () => {
      awaitingPlayback = false;
      if (!wantsPlaying) {
        wantsPlaying = true;
        playbackAttempt += 1;
        if (hls) hls.startLoad();
        showPlayback(true, 'Connecting…');
      }
    });
    audio.addEventListener('pause', () => {
      if (audio.paused && wantsPlaying && !awaitingPlayback) {
        wantsPlaying = false;
        playbackAttempt += 1;
        if (hls) hls.stopLoad();
        showPlayback(false, 'Paused');
      }
    });
    audio.addEventListener('playing', () => { if (wantsPlaying) showPlayback(true, 'Playing live'); });
    audio.addEventListener('waiting', () => { if (wantsPlaying) showPlayback(true, 'Buffering…'); });
    audio.addEventListener('error', () => { if (wantsPlaying && audio.error) fail(playbackAttempt); });
    cover.addEventListener('error', () => { cover.hidden = true; cover.removeAttribute('src'); });
    audio.hidden = true;
    controls.hidden = false;
    picker.hidden = false;

    async function refresh() {
      if (document.hidden || station.value !== 'paradise') return;
      const version = ++metadataVersion;
      try {
        const response = await fetch('/api/radio-now', { cache:'no-store', signal:AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error('metadata unavailable');
        const track = await response.json();
        if (version !== metadataVersion) return;
        title.textContent = track.title;
        artist.textContent = track.artist;
        album.textContent = track.album || '';
        if (track.cover) { cover.src = track.cover; cover.hidden = false; }
        else { cover.hidden = true; cover.removeAttribute('src'); }
      } catch {
        if (version !== metadataVersion) return;
        title.textContent = 'Radio Paradise';
        artist.textContent = 'Track details unavailable';
        album.textContent = '';
        cover.hidden = true;
        cover.removeAttribute('src');
      } finally {
        if (version === metadataVersion) {
          clearTimeout(timer);
          if (!document.hidden && station.value === 'paradise') timer = setTimeout(refresh, 30000);
        }
      }
    }
    document.addEventListener('visibilitychange', () => {
      metadataVersion += 1;
      clearTimeout(timer);
      if (!document.hidden) void refresh();
    });
    artist.textContent = 'Loading track details…';
    void refresh();
  });
