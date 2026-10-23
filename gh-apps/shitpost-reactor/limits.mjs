// Shitpost-only generation knobs. Provider/model routing lives in
// gh-apps/kanarek-review routing policy via the kanarek-shitpost-free contract.
// Completion tokens are thinking/generation headroom, never a length target.
export const SHITPOST_COMPLETION_TOKEN_BUDGET = 16_384;
export const SHITPOST_TEXT_HARD_MAX_CHARS = 2_400;
export const SHITPOST_MEME_LINE_HARD_MAX_CHARS = 220;
export const SHITPOST_MYSAAS_FETCH_TIMEOUT_MS = 8_000;
export const SHITPOST_MYSAAS_MAX_REFERENCES = 5;
export const SHITPOST_ROUTER_TIMEOUT_MS = 20 * 60_000;
// Best-of: candidates from distinct providers, then one judge pick. Runs daily,
// so spending a few more free calls on quality is fine.
export const SHITPOST_CANDIDATES = 3;
export const SHITPOST_JUDGE_RESERVE_MS = 4 * 60_000;
export const SHITPOST_JUDGE_TOKEN_BUDGET = 4_096;
