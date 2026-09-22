import type { DispatcherConfig } from "./config.js";

export const OPENAI_COMPATIBLE_BACKEND_IDS = [
  "openrouter",
  "orcarouter",
  "aihubmix",
  "ollama-cloud",
  "groq",
  "huggingface-publicai",
] as const;

export type OpenAICompatibleBackendId = typeof OPENAI_COMPATIBLE_BACKEND_IDS[number];

export interface OpenAICompatibleBackendDefinition {
  id: OpenAICompatibleBackendId;
  credentialEnv: string;
  endpoint: string;
  costClass: "free-tier";
  priority: number;
  defaultModel?: string;
  modelEnv?: string;
  extraHeaders?: Readonly<Record<string, string>>;
}

export const OPENAI_COMPATIBLE_BACKENDS: readonly OpenAICompatibleBackendDefinition[] = [
  {
    id: "openrouter", credentialEnv: "OPENROUTER_API_KEY",
    endpoint: "https://openrouter.ai/api/v1/chat/completions", costClass: "free-tier", priority: 10,
    extraHeaders: {
      "HTTP-Referer": "https://github.com/trvny/trvny",
      "X-OpenRouter-Title": "Pet Dispatcher",
    },
  },
  {
    id: "orcarouter", credentialEnv: "ORCAROUTER_API_KEY",
    endpoint: "https://api.orcarouter.ai/v1/chat/completions", costClass: "free-tier", priority: 20,
    defaultModel: "orcarouter/free",
  },
  {
    id: "aihubmix", credentialEnv: "AIHUBMIX_API_KEY",
    endpoint: "https://aihubmix.com/v1/chat/completions", costClass: "free-tier", priority: 30,
    defaultModel: "coding-glm-5.3-free", modelEnv: "PET_DISPATCHER_AIHUBMIX_MODEL",
  },
  {
    id: "ollama-cloud", credentialEnv: "OLLAMA_API_KEY",
    endpoint: "https://ollama.com/v1/chat/completions", costClass: "free-tier", priority: 40,
    modelEnv: "PET_DISPATCHER_OLLAMA_CLOUD_MODEL",
  },
  {
    id: "groq", credentialEnv: "GROQ_API_KEY",
    endpoint: "https://api.groq.com/openai/v1/chat/completions", costClass: "free-tier", priority: 50,
    modelEnv: "PET_DISPATCHER_GROQ_MODEL",
  },
  {
    id: "huggingface-publicai", credentialEnv: "HUGGINGFACE_API_KEY",
    endpoint: "https://router.huggingface.co/v1/chat/completions", costClass: "free-tier", priority: 55,
    defaultModel: "aisingapore/Qwen-SEA-LION-v4-32B-IT:publicai",
    modelEnv: "PET_DISPATCHER_HUGGINGFACE_MODEL",
  },
];

export function backendModel(
  definition: OpenAICompatibleBackendDefinition,
  config: DispatcherConfig,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (definition.id === "openrouter") return config.openRouterModel;
  return definition.modelEnv ? env[definition.modelEnv]?.trim() || definition.defaultModel : definition.defaultModel;
}

export function backendReadinessReason(
  definition: OpenAICompatibleBackendDefinition,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!definition.modelEnv) return undefined;
  const model = env[definition.modelEnv]?.trim() || definition.defaultModel;
  if (!model) return `missing model env: ${definition.modelEnv}`;
  if (definition.id === "aihubmix" && !model.endsWith("-free")) return "AIHubMix routed model must use a -free id";
  if (definition.id === "huggingface-publicai" && !model.endsWith(":publicai")) {
    return "Hugging Face model must pin the :publicai provider";
  }
  return undefined;
}
