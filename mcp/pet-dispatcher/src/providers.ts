import { GoogleGenAI, type Content, type FunctionDeclaration } from "@google/genai";
import type { DispatcherConfig } from "./config.js";
import { AgentTools, agentToolDefinitions } from "./agent-tools.js";
import { probeModelBackends, rankModelBackendProbes } from "./agent-router.js";
import {
  backendModel, OPENAI_COMPATIBLE_BACKENDS,
  type OpenAICompatibleBackendDefinition, type OpenAICompatibleBackendId,
} from "./openai-backends.js";

export type AgentProvider = "openrouter" | "orcarouter" | "aihubmix" | "ollama-cloud" | "groq" | "gemini";

export const AGENT_PROVIDER_ENV_NAMES = [...new Set([
  ...OPENAI_COMPATIBLE_BACKENDS.flatMap(({ credentialEnv, modelEnv }) => modelEnv ? [credentialEnv, modelEnv] : [credentialEnv]),
  "GEMINI_API_KEY", "GOOGLE_API_KEY",
])].sort();

const SYSTEM_PROMPT = `You are a coding worker inside a Pet Dispatcher session.
Use the provided tools to inspect, edit and validate the assigned repository.
Never assume host filesystem access outside the session. Finish with a concise summary and validation evidence.`;

interface OpenRouterToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}
interface OpenRouterMessage {
  role: string;
  content?: string | null;
  tool_calls?: OpenRouterToolCall[];
  tool_call_id?: string;
  name?: string;
}

async function toolResult(tools: AgentTools, sessionId: string, name: string, args: unknown): Promise<unknown> {
  try { return await tools.execute(sessionId, name, args); }
  catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
}

type OpenAIProvider = OpenAICompatibleBackendId;
interface RuntimeOpenAIBackend {
  id: OpenAIProvider;
  endpoint: string;
  apiKey: string;
  model: string;
  headers: Record<string, string>;
}

function runtimeBackend(
  definition: OpenAICompatibleBackendDefinition,
  config: DispatcherConfig,
  env: NodeJS.ProcessEnv,
  openRouterModel?: string,
): RuntimeOpenAIBackend | undefined {
  const apiKey = env[definition.credentialEnv]?.trim();
  const model = definition.id === "openrouter"
    ? openRouterModel ?? backendModel(definition, config, env)
    : backendModel(definition, config, env);
  if (!apiKey || !model) return undefined;
  return {
    id: definition.id,
    endpoint: definition.endpoint,
    apiKey,
    model,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...definition.extraHeaders,
    },
  };
}

async function healthyOpenAIBackends(
  config: DispatcherConfig, env: NodeJS.ProcessEnv = process.env, openRouterModel?: string,
): Promise<RuntimeOpenAIBackend[]> {
  const probes = rankModelBackendProbes(await probeModelBackends({ env }));
  return probes
    .filter(({ availability }) => availability === "available")
    .map(({ id }) => OPENAI_COMPATIBLE_BACKENDS.find((backend) => backend.id === id))
    .filter((backend): backend is OpenAICompatibleBackendDefinition => Boolean(backend))
    .map((backend) => runtimeBackend(backend, config, env, openRouterModel))
    .filter((backend): backend is RuntimeOpenAIBackend => Boolean(backend));
}

class OpenAIBackendAttemptError extends Error {
  constructor(
    readonly backendId: OpenAIProvider,
    readonly toolCallsExecuted: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

async function runOpenAIBackend(
  tools: AgentTools,
  sessionId: string,
  goal: string,
  backend: RuntimeOpenAIBackend,
  maxSteps: number,
  signal?: AbortSignal,
): Promise<{ provider: OpenAIProvider; model: string; text: string; steps: number }> {
  const messages: OpenRouterMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: goal },
  ];
  const apiTools = (tools.definitions?.() ?? agentToolDefinitions).map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
  let toolCallsExecuted = 0;

  try {
    for (let step = 1; step <= maxSteps; step++) {
      signal?.throwIfAborted();
      const response = await fetch(backend.endpoint, {
        method: "POST",
        headers: backend.headers,
        body: JSON.stringify({ model: backend.model, messages, tools: apiTools, tool_choice: "auto" }),
        signal: signal ? AbortSignal.any([AbortSignal.timeout(120_000), signal]) : AbortSignal.timeout(120_000),
      });
      if (!response.ok) {
        const detail = (await response.text()).replaceAll(backend.apiKey, "[redacted]").slice(0, 1000);
        throw new Error(`${backend.id} ${response.status}: ${detail}`);
      }
      const body = await response.json() as { choices?: Array<{ message?: OpenRouterMessage }> };
      const message = body.choices?.[0]?.message;
      if (!message) throw new Error(`${backend.id} returned no assistant message`);
      messages.push(message);
      const calls = message.tool_calls ?? [];
      if (calls.length === 0) {
        return { provider: backend.id, model: backend.model, text: message.content ?? "", steps: step };
      }
      for (const call of calls) {
        const fn = call?.function;
        if (!call?.id) throw new Error(`${backend.id} returned malformed tool_call without id`);
        const toolCallId = call.id;
        if (!fn?.name) {
          messages.push({ role: "tool", tool_call_id: toolCallId, name: "invalid_tool_call", content: JSON.stringify({ error: "malformed tool_call" }) });
          continue;
        }
        let args: unknown = {};
        try { args = JSON.parse(fn.arguments || "{}"); }
        catch { args = { parseError: "invalid JSON tool arguments" }; }
        toolCallsExecuted += 1;
        const result = await toolResult(tools, sessionId, fn.name, args);
        messages.push({ role: "tool", tool_call_id: toolCallId, name: fn.name, content: JSON.stringify(result) });
      }
    }
    throw new Error(`${backend.id} agent exceeded ${maxSteps} steps`);
  } catch (error) {
    if (error instanceof OpenAIBackendAttemptError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new OpenAIBackendAttemptError(backend.id, toolCallsExecuted, message, { cause: error });
  }
}

export async function runOpenRouter(
  config: DispatcherConfig, tools: AgentTools, sessionId: string, goal: string, model = config.openRouterModel, maxSteps = 16,
  signal?: AbortSignal,
): Promise<{ provider: "openrouter"; model: string; text: string; steps: number }> {
  const definition = OPENAI_COMPATIBLE_BACKENDS.find(({ id }) => id === "openrouter");
  if (!definition) throw new Error("OpenRouter backend definition is missing");
  const backend = runtimeBackend(definition, config, process.env, model);
  if (!backend) throw new Error("OPENROUTER_API_KEY is not configured on the worker");
  return runOpenAIBackend(tools, sessionId, goal, backend, maxSteps, signal) as Promise<{
    provider: "openrouter"; model: string; text: string; steps: number;
  }>;
}

export async function runRoutedOpenAI(
  config: DispatcherConfig, tools: AgentTools, sessionId: string, goal: string, maxSteps = 16,
  signal?: AbortSignal,
): Promise<{ provider: OpenAIProvider; model: string; text: string; steps: number }> {
  const backends = await healthyOpenAIBackends(config);
  if (backends.length === 0) throw new Error("No healthy OpenAI-compatible backend is configured on the worker");
  const failures: string[] = [];
  for (const backend of backends) {
    signal?.throwIfAborted();
    try {
      return await runOpenAIBackend(tools, sessionId, goal, backend, maxSteps, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      if (error instanceof OpenAIBackendAttemptError && error.toolCallsExecuted > 0) throw error;
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${backend.id}: ${message}`);
    }
  }
  throw new Error(`All healthy OpenAI-compatible backends failed before tool execution: ${failures.join(" | ")}`);
}

export async function runGemini(
  config: DispatcherConfig, tools: AgentTools, sessionId: string, goal: string, model = config.geminiModel, maxSteps = 16,
  signal?: AbortSignal,
): Promise<{ provider: "gemini"; model: string; text: string; steps: number }> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY or GOOGLE_API_KEY is not configured on the worker");
  const ai = new GoogleGenAI({ apiKey });
  const declarations: FunctionDeclaration[] = (tools.definitions?.() ?? agentToolDefinitions).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.parameters,
  }));
  const contents: Content[] = [{ role: "user", parts: [{ text: goal }] }];

  for (let step = 1; step <= maxSteps; step++) {
    signal?.throwIfAborted();
    const response = await ai.models.generateContent({
      model,
      contents,
      config: { systemInstruction: SYSTEM_PROMPT, tools: [{ functionDeclarations: declarations }], abortSignal: signal },
    });
    const modelContent = response.candidates?.[0]?.content;
    if (modelContent) contents.push(modelContent);
    const calls = response.functionCalls ?? [];
    if (calls.length === 0) return { provider: "gemini", model, text: response.text ?? "", steps: step };

    const parts = [];
    for (const call of calls) {
      if (!call.name) continue;
      const result = await toolResult(tools, sessionId, call.name, call.args ?? {});
      parts.push({ functionResponse: { name: call.name, id: call.id, response: { result } } });
    }
    contents.push({ role: "user", parts });
  }
  throw new Error(`Gemini agent exceeded ${maxSteps} steps`);
}
