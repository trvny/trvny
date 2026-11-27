<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  let ready = $state(false);
  let text = $state('Two plus two equals four.');
  let encoding = $state('o200k_base');
  let pending = $state(false);
  let result = $state<{ count: number; ids: number[] } | null>(null);
  let error = $state('');
  let worker: Worker | undefined;
  let revision = 0;

  onMount(() => { ready = typeof Worker !== 'undefined'; });
  onDestroy(() => worker?.terminate());

  function clearResult() {
    revision += 1;
    pending = false;
    result = null;
    error = '';
  }

  function tokenize(event: SubmitEvent) {
    event.preventDefault();
    clearResult();
    pending = true;
    try {
      if (!worker) {
        worker = new Worker(new URL('../lib/tokenizer.worker.mjs', import.meta.url), { type: 'module' });
        worker.addEventListener('message', ({ data }) => {
          if (data.revision !== revision) return;
          pending = false;
          error = data.error ? 'Could not count this text. Try again.' : '';
          result = data.error ? null : { count: data.count, ids: data.ids };
        });
        worker.addEventListener('error', () => {
          worker?.terminate();
          worker = undefined;
          if (pending) {
            pending = false;
            error = 'Could not load the tokenizer. Try again.';
          }
        });
      }
      worker.postMessage({ revision, text, encoding });
    } catch {
      pending = false;
      error = 'Could not start the tokenizer.';
    }
  }
</script>

<form class="panel" onsubmit={tokenize}>
  <label for="tokenizer-input">Text</label>
  <textarea id="tokenizer-input" bind:value={text} oninput={clearResult} maxlength="20000" rows="6" spellcheck="false"></textarea>
  <div class="actions">
    <label for="tokenizer-encoding">Encoding</label>
    <select id="tokenizer-encoding" bind:value={encoding} onchange={clearResult}>
      <option value="o200k_base">o200k_base</option>
      <option value="cl100k_base">cl100k_base</option>
    </select>
    <button type="submit" disabled={!ready || pending}>Count tokens</button>
  </div>
  <p class="meta" role="status">
    {#if pending}Counting…{:else if error}{error}{:else if result}
      <strong>{result.count}</strong> {result.count === 1 ? 'token' : 'tokens'}
    {:else}
      Up to 20,000 characters.
    {/if}
  </p>
  {#if result?.ids.length}
    <details>
      <summary>{result.count > result.ids.length ? 'First 64 token IDs' : 'Token IDs'}</summary>
      <ol class="ids" aria-label="Token IDs">
        {#each result.ids as id}
          <li>{id}</li>
        {/each}
      </ol>
    </details>
  {/if}
  <noscript><p>Enable JavaScript to count tokens locally.</p></noscript>
</form>

<style>
  form { display: grid; gap: 12px; max-width: 850px; }
  label { font-weight: 700; }
  textarea, select, button {
    font: 16px/1.4 system-ui, sans-serif;
    color: var(--fg);
    border: 1px solid var(--line);
    background: #111a25;
  }
  textarea { width: 100%; padding: 12px; resize: vertical; }
  select, button { min-height: 44px; padding: 8px 12px; }
  button { background: var(--yellow); color: #101218; font-weight: 700; cursor: pointer; }
  button:disabled { opacity: .55; cursor: default; }
  textarea:focus-visible, select:focus-visible, summary:focus-visible {
    outline: 3px solid var(--yellow);
    outline-offset: 3px;
  }
  .actions, .ids { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  .meta { margin: 0; }
  .meta strong { color: var(--cyan); }
  .ids { padding: 0; list-style: none; }
  .ids li { padding: 4px 8px; background: #111a25; font: 14px/1.4 ui-monospace, monospace; }
</style>
