import { OPENAI_COMPATIBLE_BACKENDS } from "./openai-backends.js";

export const PROVIDER_CREDENTIAL_ENV_NAMES = [...new Set([
  ...OPENAI_COMPATIBLE_BACKENDS.map(({ credentialEnv }) => credentialEnv),
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
])].sort();
