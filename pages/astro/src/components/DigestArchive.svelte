<script lang="ts">
  import { onMount } from 'svelte';

  type Issue = { id: string; date: string; title: string; summary: string; topics: string[] };
  let { issues }: { issues: Issue[] } = $props();
  let ready = $state(false);
  let query = $state('');
  let topic = $state('');

  const topicLabels: Record<string, string> = {
    ai: 'AI', cars: 'Cars', data: 'Data', film: 'Film', football: 'Football',
    freebies: 'Freebies', gallery: 'Gallery', games: 'Games', local: 'Local',
    memes: 'Memes', music: 'Music', news: 'News', poland: 'Poland',
    science: 'Science', timeline: 'Timeline', weather: 'Weather', world: 'World',
  };
  const normalize = (value: string) => value.toLocaleLowerCase('pl')
    .normalize('NFD').replace(/\p{Mark}/gu, '').replaceAll('ł', 'l');
  let topics = $derived([...new Set(issues.flatMap(issue => issue.topics))].sort());
  let terms = $derived(normalize(query).trim().split(/\s+/).filter(Boolean));
  let matches = $derived(issues.filter(issue => {
    if (topic && !issue.topics.includes(topic)) return false;
    const text = normalize([issue.id, issue.date, issue.title, issue.summary].join(' '));
    return terms.every(term => text.includes(term));
  }));

  onMount(() => { ready = true; });
</script>

{#if ready && issues.length}
  <div class="filters" lang="en">
    <label>Search issues <input type="search" bind:value={query} maxlength="120" /></label>
    {#if topics.length}
      <label>Topic
        <select bind:value={topic}>
          <option value="">All topics</option>
          {#each topics as item (item)}
            <option value={item}>{topicLabels[item] ?? item}</option>
          {/each}
        </select>
      </label>
    {/if}
    <p role="status">{matches.length} of {issues.length} issues</p>
  </div>
{/if}

{#each matches as issue (issue.id)}
  <a class="issue" href={'/przeglad/' + issue.id + '/'}>
    <span class="date">{issue.date}</span>
    <h2>{issue.title}</h2>
    <p>{issue.summary}</p>
  </a>
{:else}
  {#if issues.length}
    <p class="lede" lang="en">No issues match the filters.</p>
  {:else}
    <p class="lede">Pierwsze publiczne wydanie pojawi się tutaj po przygotowaniu.</p>
  {/if}
{/each}

<style>
  .filters { display:flex; flex-wrap:wrap; gap:12px; align-items:end; margin:0 0 16px; }
  label { display:grid; gap:4px; min-width:0; max-width:100%; font:14px/1.4 system-ui,sans-serif; }
  label:first-child { flex:1 1 210px; }
  input, select { box-sizing:border-box; width:100%; min-height:44px; border:1px solid #435168; border-radius:4px; padding:8px 10px; background:#0b0f16; color:var(--text); font:16px system-ui,sans-serif; }
  input:focus-visible, select:focus-visible { outline:2px solid var(--yellow); outline-offset:2px; }
  .filters p { flex:1 0 100%; margin:0; color:var(--muted); }
</style>
