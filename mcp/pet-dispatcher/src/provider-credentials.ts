import { OPENAI_COMPATIBLE_BACKENDS } from "./openai-backends.js";

export const PROVIDER_CREDENTIAL_ENV_NAMES = [...new Set([
  ...OPENAI_COMPATIBLE_BACKENDS.map(({ credentialEnv }) => credentialEnv),
  "DEEPSEEK_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
])].sort();
