import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  site: 'https://travny.pages.dev',
  output: 'static',
  outDir: './dist',
  integrations: [mdx()],
  vite: { server: { fs: { allow: [fileURLToPath(new URL('.', import.meta.url)), fileURLToPath(new URL('../site/assets/', import.meta.url))] } } },
});
