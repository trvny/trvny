export const GROK_PAID_MODEL = 'grok-4.7';
export const GROK_CACHE_ID = 'kanarek-paid-code-review-v1';

export const GROK_REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings'],
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'path', 'line', 'existing_code', 'title', 'body'],
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          path: { type: 'string' },
          line: { type: 'integer' },
          existing_code: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string' },
        },
      },
    },
  },
} as const;
