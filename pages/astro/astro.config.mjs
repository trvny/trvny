import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://travny.pages.dev',
  output: 'static',
  outDir: './dist',
  integrations: [mdx()],
});
