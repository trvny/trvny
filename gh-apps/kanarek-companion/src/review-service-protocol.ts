export const REVIEW_SERVICE_TRUST_HEADER = 'x-kanarek-review-service-binding';
export const REVIEW_SERVICE_TRUST_VALUE = 'kanarek-review-v1';
export const REVIEW_SERVICE_INTERNAL_BEARER = 'kanarek-review-service-binding-v1';
export const REVIEW_ROUTER_PATH = '/review-router/v1/chat/completions';
export const REVIEW_ROUTER_MODELS_PATH = '/review-router/v1/models';
export const REVIEW_WORKERS_AI_OVERRIDE_HEADER = 'x-kanarek-review-workers-ai-enabled';

export type ReviewProviderPoolHealth = {
  available: number;
  configured: number;
  providers: Array<{
    available: boolean;
    configured: boolean;
    cooldown?: { category: string; until: number };
    provider: string;
  }>;
  ready: boolean;
};
