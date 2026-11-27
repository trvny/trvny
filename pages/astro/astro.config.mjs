import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import svelte from '@astrojs/svelte';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  site: 'https://bartek.lol',
  output: 'static',
  outDir: './dist',
  integrations: [mdx(), svelte()],
  vite: {
    worker: { format: 'es' },
    server: { fs: { allow: [
      fileURLToPath(new URL('.', import.meta.url)),
      fileURLToPath(new URL('../site/assets/', import.meta.url)),
    ] } },
  },
});
