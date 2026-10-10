#!/usr/bin/env node
// Shared Playwright launch contract for browser agents and smoke checks.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = os.homedir();
const tools = path.join(home, '.local', 'share', 'travny-devbox');
const extension = path.join(tools, 'ubol');
const profile = path.join(tools, 'chromium-profile');

export async function launchWithUbol() {
  if (!fs.existsSync(path.join(extension, 'manifest.json'))) {
    throw new Error('uBOL not installed. Run: devbox install ubol');
  }
  const require = createRequire(path.join(tools, 'package.json'));
  const { chromium } = require('playwright');
  fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
  return chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.argv[2] ?? 'https://example.com';
  const screenshot = process.argv[3];
  if (!['http:', 'https:'].includes(new URL(url).protocol)) {
    throw new Error('Only HTTP(S) URLs are supported');
  }

  const context = await launchWithUbol();
  try {
    const page = await context.newPage();
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    console.log(`${response?.status() ?? 'no-response'} ${page.url()}`);
    console.log(`Title: ${await page.title()}`);
    if (screenshot) {
      await page.screenshot({ path: screenshot, fullPage: true });
      console.log(`Screenshot: ${screenshot}`);
    }
  } finally {
    await context.close();
  }
}
