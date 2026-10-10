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
const profiles = path.join(tools, 'chromium-profiles');

export async function launchWithUbol({ profileName = 'default' } = {}) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(profileName)) {
    throw new Error('Invalid profile name');
  }
  if (!fs.existsSync(path.join(extension, 'manifest.json'))) {
    throw new Error('uBOL not installed. Run: devbox install ubol');
  }
  const require = createRequire(path.join(tools, 'package.json'));
  const { chromium } = require('playwright');
  const profile = path.join(profiles, profileName);
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

  const smokeProfile = `smoke-${process.pid}`;
  const context = await launchWithUbol({ profileName: smokeProfile });
  try {
    const page = await context.newPage();
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    console.log(`${response?.status() ?? 'no-response'} ${page.url()}`);
    if (!response?.ok()) {
      throw new Error(`Browser smoke failed: HTTP ${response?.status() ?? 'no-response'}`);
    }
    console.log(`Title: ${await page.title()}`);
    if (screenshot) {
      await page.screenshot({ path: screenshot, fullPage: true });
      console.log(`Screenshot: ${screenshot}`);
    }
  } finally {
    try {
      await context.close();
    } finally {
      fs.rmSync(path.join(profiles, smokeProfile), { recursive: true, force: true });
    }
  }
}
