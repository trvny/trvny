import { GoogleGenAI, type Content, type FunctionDeclaration } from "@google/genai";
import type { DispatcherConfig } from "./config.js";
import { AgentTools, agentToolDefinitions } from "./agent-tools.js";

export type AgentProvider = "openrouter" | "gemini";

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

export async function runOpenRouter(
  config: DispatcherConfig, tools: AgentTools, sessionId: string, goal: string, model = config.openRouterModel, maxSteps = 16,
  signal?: AbortSignal,
): Promise<{ provider: "openrouter"; model: string; text: string; steps: number }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured on the worker");
  const messages: OpenRouterMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: goal },
  ];
  const apiTools = (tools.definitions?.() ?? agentToolDefinitions).map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));

  for (let step = 1; step <= maxSteps; step++) {
    signal?.throwIfAborted();
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/trvny/trvny",
        "X-OpenRouter-Title": "Pet Dispatcher",
      },
      body: JSON.stringify({ model, messages, tools: apiTools, tool_choice: "auto" }),
      signal: signal ? AbortSignal.any([AbortSignal.timeout(120_000), signal]) : AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${(await response.text()).slice(0, 1000)}`);
    const body = await response.json() as { choices?: Array<{ message?: OpenRouterMessage }> };
    const message = body.choices?.[0]?.message;
    if (!message) throw new Error("OpenRouter returned no assistant message");
    messages.push(message);
    const calls = message.tool_calls ?? [];
    if (calls.length === 0) {
      return { provider: "openrouter", model, text: message.content ?? "", steps: step };
    }
    for (const call of calls) {
      const fn = call?.function;
      if (!call?.id) throw new Error("OpenRouter returned malformed tool_call without id");
      const toolCallId = call.id;
      if (!fn?.name) {
        messages.push({ role: "tool", tool_call_id: toolCallId, name: "invalid_tool_call", content: JSON.stringify({ error: "malformed tool_call" }) });
        continue;
      }
      let args: unknown = {};
      try { args = JSON.parse(fn.arguments || "{}"); }
      catch { args = { parseError: "invalid JSON tool arguments" }; }
      const result = await toolResult(tools, sessionId, fn.name, args);
      messages.push({ role: "tool", tool_call_id: toolCallId, name: fn.name, content: JSON.stringify(result) });
    }
  }
  throw new Error(`OpenRouter agent exceeded ${maxSteps} steps`);
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
