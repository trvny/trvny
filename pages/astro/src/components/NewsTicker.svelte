<script lang="ts">
  import { onMount } from 'svelte';

  type Story = { id: number; title: string; url?: string };
  const api = 'https://hacker-news.firebaseio.com/v0/';
  let stories = $state<Story[]>([]);
  let status = $state('');
  let refreshing = $state(false);
  let mounted = $state(false);
  let icon: SVGSVGElement;
  let request: AbortController | undefined;
  let motion: { cancel(): void } | undefined;

  async function fetchJson(path: string, signal: AbortSignal) {
    const response = await fetch(api + path, { signal });
    if (!response.ok) throw new Error('Request unavailable');
    return response.json();
  }

  function storyUrl({ id, url }: Story) {
    try {
      const destination = new URL(url ?? '');
      if (['http:', 'https:'].includes(destination.protocol)) return destination.href;
    } catch { /* Discussion link below. */ }
    return 'https://news.ycombinator.com/item?id=' + id;
  }

  async function refresh() {
    if (document.hidden || refreshing) return;
    refreshing = true;
    const controller = new AbortController();
    request = controller;
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const ids = await fetchJson('topstories.json', controller.signal);
      if (!Array.isArray(ids)) throw new Error('Invalid story list');
      const items = await Promise.allSettled(
        ids.filter(Number.isSafeInteger).slice(0, 6).map(id => fetchJson('item/' + id + '.json', controller.signal)),
      );
      if (request !== controller) return;
      const available = items.flatMap(item => {
        if (item.status !== 'fulfilled') return [];
        const story = item.value;
        return Number.isSafeInteger(story?.id) && typeof story.title === 'string' && story.title.trim() ? [story] : [];
      });
      if (!available.length) throw new Error('No stories available');
      stories = available;
      status = 'Updated ' + new Date().toLocaleTimeString();
    } catch {
      if (request === controller) status = 'Could not refresh. Try again later.';
    } finally {
      clearTimeout(timer);
      if (request === controller) {
        request = undefined;
        refreshing = false;
      }
    }
  }

  function manualRefresh() {
    void refresh();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    void import('animejs/animation').then(({ animate }) => {
      if (!icon?.isConnected || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      motion?.cancel();
      motion = animate(icon, { rotate: ['0turn', '1turn'], duration: 420 });
    }).catch(() => {});
  }

  onMount(() => {
    mounted = true;
    void refresh();
    const interval = setInterval(refresh, 300_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      clearInterval(interval);
      const pending = request;
      request = undefined;
      pending?.abort();
      motion?.cancel();
    };
  });
</script>

<section class="panel news" data-hn-news aria-labelledby="hn-heading">
  <div class="news-heading">
    <h2 id="hn-heading">LIVE / Hacker News</h2>
    {#if mounted}
      <button type="button" onclick={manualRefresh} disabled={refreshing} aria-label="Refresh headlines">
        <svg bind:this={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M20 4v5h-5m5 0a8 8 0 1 0 .3 5" />
        </svg>
      </button>
    {/if}
  </div>
  <p class="meta">Top stories · refresh every 5 min · data from the official HN API</p>
  {#if stories.length}
    <ul data-hn-list>
      {#each stories as story (story.id)}
        <li><a href={storyUrl(story)} target="_blank" rel="noopener noreferrer">{story.title}</a></li>
      {/each}
    </ul>
  {/if}
  <p class="hint" role="status">{refreshing ? 'Fetching headlines…' : status}</p>
  <a href="https://news.ycombinator.com/">Open Hacker News ↗</a>
</section>

<style>
  .news-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .news-heading h2 { margin:0; }
  .news-heading button { display:grid; place-items:center; width:44px; height:44px; padding:0; flex:none; }
  button:disabled { cursor:wait; opacity:.55; }
  svg { width:20px; height:20px; }
  .hint:empty { display:none; }
</style>
