// ==UserScript==
// @name         Claude-Smooth
// @namespace    trvny
// @match        https://claude.ai/*
// @match        https://*.claude.ai/*
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @version      0.3.0
// @description  Perf tweaks for claude.ai on desktop + mobile
// @icon         https://cdn.jsdelivr.net/npm/@lobehub/icons-static-svg@latest/icons/claudecode-color.svg
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const DESKTOP = matchMedia('(pointer: fine)').matches && innerWidth >= 900;
  const get = (k, d) => { try { return GM_getValue(k, d); } catch { return d; } };

  const CFG = {
    killAnim:   get('killAnim', true),
    flatten:    get('flatten', true),
    dropLayers: get('dropLayers', true),
    virtualize: get('virtualize', true),
    vCode:      get('vCode', true),
    vSidebar:   get('vSidebar', !DESKTOP), // desktop sidebar is short; skip by default
    lazyImg:    get('lazyImg', true),
    enabled:    get('enabled', true),
  };

  try {
    GM_registerMenuCommand(`Claude-Smooth: ${CFG.enabled ? 'ON' : 'OFF'} (toggle)`, () => {
      GM_setValue('enabled', !CFG.enabled);
      location.reload();
    });
    GM_registerMenuCommand(`Sidebar virtualize: ${CFG.vSidebar ? 'ON' : 'OFF'}`, () => {
      GM_setValue('vSidebar', !CFG.vSidebar);
      location.reload();
    });
  } catch {}

  if (!CFG.enabled) return;

  // Elements that must never be flattened/contained: popovers, menus, dialogs,
  // tooltips. On desktop these are the whole interaction model.
  const OVERLAY = '[role="dialog"],[role="menu"],[role="tooltip"],[role="listbox"],[data-radix-popper-content-wrapper]';

  let css = '';

  if (CFG.killAnim) css += `
    *, *::before, *::after {
      animation-duration: .001s !important;
      transition-duration: .001s !important;
      scroll-behavior: auto !important;
    }
    /* keep real spinners spinning, otherwise loading states look frozen */
    [class*="animate-spin"], [class*="animate-pulse"] {
      animation-duration: 1s !important;
    }`;

  if (CFG.flatten) css += `
    [class*="blur"], [class*="backdrop"] {
      backdrop-filter: none !important; -webkit-backdrop-filter: none !important;
    }
    [class*="shadow"] { box-shadow: none !important; }
    /* put a cheap shadow back on floating layers so they read as floating */
    ${OVERLAY} { box-shadow: 0 4px 16px rgba(0,0,0,.28) !important; }`;

  if (CFG.dropLayers) css += `
    *:not(${OVERLAY}) { will-change: auto !important; }`;

  // content-visibility:auto already implies layout/style/paint containment,
  // so no extra `contain:` line -- that one was clipping hover UI on desktop.
  if (CFG.virtualize) css += `
    .cv-turn { content-visibility: auto; contain-intrinsic-size: auto ${DESKTOP ? 800 : 600}px; }`;

  if (CFG.vCode) css += `
    .cv-code { content-visibility: auto; contain-intrinsic-size: auto ${DESKTOP ? 420 : 300}px; }`;

  if (CFG.vSidebar) css += `
    .cv-side { content-visibility: auto; contain-intrinsic-size: auto 44px; }`;

  css += `
    @media print {
      .cv-turn, .cv-code, .cv-side { content-visibility: visible !important; }
    }`;

  const inject = () => GM_addStyle(css);
  if (document.head) inject();
  else new MutationObserver((_, o) => { if (document.head) { inject(); o.disconnect(); } })
    .observe(document.documentElement, { childList: true });

  // ---- tagging ----
  const TURN_SEL = [
    '[data-testid^="conversation-turn"]',
    '[data-test-render-count]',
    'div.font-claude-message',
    'div.font-claude-response',
    '[data-testid="user-message"]',
  ].join(',');
  const CODE_SEL = 'pre';
  const SIDE_SEL = 'nav a[href^="/chat/"], nav li, aside a[href^="/chat/"]';

  // Never virtualize the tail of the conversation: that is where streaming,
  // autoscroll and the sticky composer live.
  const TAIL = 2;

  const tag = () => {
    if (CFG.virtualize) {
      const turns = [...document.querySelectorAll(TURN_SEL)];
      turns.forEach((t, i) => {
        t.classList.toggle('cv-turn', i < turns.length - TAIL);
      });
    }
    if (CFG.vCode) {
      for (const c of document.querySelectorAll(CODE_SEL)) {
        if (!c.closest(OVERLAY)) c.classList.add('cv-code');
      }
    }
    if (CFG.vSidebar) {
      for (const s of document.querySelectorAll(SIDE_SEL)) s.classList.add('cv-side');
    }
    if (CFG.lazyImg) {
      for (const i of document.querySelectorAll('img:not([data-lz])')) {
        i.loading = 'lazy'; i.decoding = 'async'; i.dataset.lz = 1;
      }
    }
  };

  const ric = window.requestIdleCallback || (f => requestAnimationFrame(f));
  let queued = false;
  const obs = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    ric(() => { queued = false; tag(); }, { timeout: 500 });
  });

  const start = () => { tag(); obs.observe(document.body, { childList: true, subtree: true }); };
  if (document.body) start();
  else new MutationObserver((_, o) => { if (document.body) { start(); o.disconnect(); } })
    .observe(document.documentElement, { childList: true });
})();
