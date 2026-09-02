export const DEFAULT_OPENROUTER_MODELS = [
  'minimax/minimax-m3:free',
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'poolside/laguna-s-2.1:free',
  'cohere/north-mini-code:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'openrouter/free',
] as const;

export function configuredOpenRouterModels(value: string | undefined): string[] {
  const configured = (value?.split(',') ?? [])
    .map((model) => model.trim())
    .filter(Boolean);
  return configured.length
    ? [...new Set(configured)]
    : [...DEFAULT_OPENROUTER_MODELS];
}
