// Shitpost-only generation knobs. Provider/model routing lives in
// gh-apps/kanarek-review/wrangler.jsonc via the kanarek-review-free contract.
export const SHITPOST_COMPLETION_TOKEN_BUDGET = 2_048;
export const SHITPOST_TEXT_HARD_MAX_CHARS = 2_400;
export const SHITPOST_MEME_LINE_HARD_MAX_CHARS = 220;
export const SHITPOST_SKILL_FETCH_TIMEOUT_MS = 20_000;
export const SHITPOST_MYSAAS_FETCH_TIMEOUT_MS = 8_000;
export const SHITPOST_MYSAAS_MAX_REFERENCES = 5;
export const SHITPOST_ROUTER_TIMEOUT_MS = 45_000;
