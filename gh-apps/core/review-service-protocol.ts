export const REVIEW_SERVICE_TRUST_HEADER = 'x-kanarek-review-service-binding';
export const REVIEW_SERVICE_TRUST_VALUE = 'kanarek-review-v1';
export const REVIEW_SERVICE_INTERNAL_BEARER = 'kanarek-review-service-binding-v1';
export const REVIEW_ROUTER_PATH = '/review-router/v1/chat/completions';
export const REVIEW_ROUTER_MODELS_PATH = '/review-router/v1/models';
export const REVIEW_DECISION_PATH = '/review-router/v1/systemone';
// Backward-compatible general free contract used by existing shared callers.
export const REVIEW_ROUTER_FREE_MODEL = 'kanarek-review-free';
export const REVIEW_ROUTER_QUIP_MODEL = 'kanarek-quip-free';
export const REVIEW_ROUTER_CODE_REVIEW_MODEL = 'kanarek-code-review-free';
export const REVIEW_ROUTER_JUDGE_MODEL = 'kanarek-judge-free';
export const REVIEW_ROUTER_SHITPOST_MODEL = 'kanarek-shitpost-free';
export const REVIEW_ROUTER_REVIEW_MODEL = 'kanarek-review';
export const REVIEW_ROUTER_PAID_MODEL = 'kanarek-review-paid';
export const REVIEW_ROUTER_WORK_MODEL = 'kanarek-work-paid';
export const REVIEW_WORKERS_AI_OVERRIDE_HEADER = 'x-kanarek-review-workers-ai-enabled';
export const REVIEW_PROVIDER_EXCLUDE_HEADER = 'x-kanarek-review-exclude-provider';

export type ReviewProviderPoolHealth = {
  available: number;
  configured: number;
  freeOrder?: string[];
  taskOrders?: Partial<Record<'general' | 'quip' | 'review' | 'judge' | 'shitpost', string[]>>;
  providers: Array<{
    available: boolean;
    budgetClass?: 'free-quota' | 'monthly-free-credit' | 'daily-neurons' | 'paid-reserve';
    configured: boolean;
    cooldown?: { category: string; until: number };
    provider: string;
  }>;
  ready: boolean;
};
