// Flat config for the Pages Functions in functions/.
//
// Run by .github/workflows/travny-pages-ci.yml (repo MegaLinter has no
// JAVASCRIPT_ES). Dependency-free: no imports, no install step.

// The list is deliberately broader than what functions/ uses today. With
// no-undef on and no `globals` package to import, a Function added later that
// reaches for a standard Workers API would otherwise fail lint with a
// misleading "X is not defined" instead of a real correctness signal.
const workerGlobals = Object.fromEntries(
  [
    // Fetch / HTTP
    "Response", "Request", "Headers", "URL", "URLSearchParams", "fetch",
    "FormData", "Blob", "File",
    // Cloudflare-specific
    "HTMLRewriter", "WebSocketPair", "caches",
    // Streams
    "ReadableStream", "WritableStream", "TransformStream",
    // Encoding
    "TextEncoder", "TextDecoder", "atob", "btoa", "crypto",
    // Timers and scheduling
    "setTimeout", "clearTimeout", "setInterval", "clearInterval",
    "queueMicrotask", "scheduler",
    // Events and misc
    "AbortController", "AbortSignal", "Event", "EventTarget", "WebSocket",
    "DOMException", "structuredClone", "performance", "navigator", "console",
    "addEventListener", "removeEventListener",
  ].map((name) => [name, "readonly"]),
);

export default [
  {
    // Everything that is not a Pages Function: linted elsewhere or not at all.
    ignores: ["site/**", "node_modules/**"],
  },
  {
    // This config file is matched too. eslint 9 warns "no matching
    // configuration" for any file it is handed but no block covers, and
    // MegaLinter hands it over whenever it changes.
    files: ["functions/**/*.js", "tests/**/*.mjs", "*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: workerGlobals,
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      // Correctness only. Formatting is prettier's job (JAVASCRIPT_PRETTIER),
      // so nothing here argues about whitespace or quotes.
      "no-undef": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-unreachable": "error",
      "no-dupe-keys": "error",
      "no-dupe-args": "error",
      "no-duplicate-case": "error",
      "no-const-assign": "error",
      "no-self-assign": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-fallthrough": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
      eqeqeq: ["error", "smart"],
    },
  },
];
