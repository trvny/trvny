const PRIMARY_MODEL = 'gpt-5.6-luna';
const FALLBACK_MODEL = 'gpt-5.4-nano';
const ANTHROPIC_MODEL = 'claude-haiku-4-5';
const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const XAI_MODEL = 'grok-4.5';
const AI_STATUSES = new Set(['ready', 'blocked']);
const SYSTEM_PROMPT = [
  'Write exactly one short status quip, 45–110 characters.',
  'Choose any natural language that fits the context.',
  'Polish, English, or another language are all allowed.',
  'Use charming, lightly technical Kanarek humor.',
  'Use only the supplied facts without listing them.',
  'Do not repeat previous_quip when it is provided.',
  'No links, lists, insults, or instructions.',
].join(' ');

export interface QuipEnv {
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  KANAREK_AI_ENABLED?: string;
  KANAREK_AI_PERCENT?: string;
  KANAREK_ANTHROPIC_MODEL?: string;
  KANAREK_GEMINI_MODEL?: string;
  KANAREK_OPENAI_FALLBACK_MODEL?: string;
  KANAREK_OPENAI_MODEL?: string;
  KANAREK_XAI_MODEL?: string;
  OPENAI_API_KEY?: string;
  XAI_API_KEY?: string;
}

export const PRESETS: Readonly<Record<string, readonly string[]>> = {
  ready: [
    'Zielono. Kanarek odkłada śrubokręt.',
    'Kable spokojne, lampki zielone. Można lecieć.',
    'Maszyna mruczy poprawnie. Kanarek kiwa dziobem.',
    'Czytnik mruczy, Kanarek strzyże błędy, feed płynie.',
  ],
  waiting: [
    'Maszyny mielą. Kanarek pilnuje kabla.',
    'Lampki jeszcze myślą. Ptak zostaje na posterunku.',
    'Trochę szumu w przewodach. Kanarek cierpliwie czeka.',
    'Kanarek śledzi CI, aż kod zabulgotuje. Testy jeszcze mieszają.',
    'Kiedy CI śpi, Android mruga „już idzie”, a kabel cierpliwie czeka.',
  ],
  blocked: [
    'Czerwona lampka świeci. Kanarek woła człowieka.',
    'Coś zgrzyta w maszynie. Dziób wskazuje blokadę.',
    'Lot wstrzymany. Jeden kabel wyraźnie protestuje.',
    'Czerwona lampka świeci. Kanarek woła człowieka, CI w zawieszeniu.',
    'CI in dreamland: blockers hum while Kanarek naps through the blockade.',
  ],
  draft: [
    'Szkic w klatce. Na razie bez alarmu.',
    'Kanarek zerka na szkic i nie pogania maszyny.',
    'Roboczy lot. Pióra jeszcze nie są policzone.',
  ],
  merged: [
    'Wleciało do main. Kanarek zamyka kajet.',
    'Kod już w gnieździe. Maszyna może odpocząć.',
    'Scalone. Kanarek stawia małą pieczątkę dziobem.',
  ],
  closed: [
    'Lot odwołany. Kanarek sprząta okruszki.',
    'PR zamknięty. Klatka wraca do trybu czuwania.',
    'Akta odłożone. Kanarek gasi lampkę.',
  ],
};

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function hash(value: unknown): Promise<string> {
  const encodedValue = new TextEncoder().encode(JSON.stringify(value));
  const input = new Uint8Array(encodedValue.byteLength);
  input.set(encodedValue);
  const digest = await crypto.subtle.digest('SHA-256', input.buffer);
  return bytesToHex(new Uint8Array(digest)).slice(0, 16);
}

export function encoded(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function decoded(value: string): string {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const base64 = padded.padEnd(Math.ceil(padded.length / 4) * 4, '=');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

export function sanitize(value: unknown): string {
  return String(value ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/```(?:[a-z0-9_-]+)?/gi, ' ')
    .replace(/[`*_#]/g, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replaceAll('@', '＠')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^["'“”„«»]+|["'“”„«»]+$/g, '')
    .trim()
    .slice(0, 140);
}

export async function preset(
  key: string,
  seed: unknown,
  excluded = '',
): Promise<string> {
  const options = PRESETS[key] ?? PRESETS.waiting;
  const alternatives = options.filter((option) => option !== excluded);
  const choices = alternatives.length ? alternatives : options;
  const digest = await hash(seed);
  const index = Number.parseInt(digest.slice(0, 8), 16) % choices.length;
  return choices[index];
}

export function aiPercent(env: QuipEnv): number {
  const parsed = Number.parseInt(env.KANAREK_AI_PERCENT ?? '25', 10);
  if (!Number.isFinite(parsed)) return 25;
  return Math.min(100, Math.max(0, parsed));
}

function hasAiProvider(env: QuipEnv): boolean {
  return Boolean(
    env.OPENAI_API_KEY ||
      env.ANTHROPIC_API_KEY ||
      env.GEMINI_API_KEY ||
      env.XAI_API_KEY,
  );
}

export async function shouldAskAi(
  number: number,
  quipKey: string,
  stateKey: string,
  env: QuipEnv,
): Promise<boolean> {
  if (
    !hasAiProvider(env) ||
    env.KANAREK_AI_ENABLED === 'false' ||
    !AI_STATUSES.has(stateKey)
  ) {
    return false;
  }
  const bucket =
    Number.parseInt((await hash(`${number}:${quipKey}`)).slice(0, 8), 16) % 100;
  return bucket < aiPercent(env);
}

function openAiOutputText(response: Record<string, unknown>): string {
  if (typeof response.output_text === 'string') return response.output_text;
  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = Array.isArray((item as { content?: unknown }).content)
      ? ((item as { content: unknown[] }).content ?? [])
      : [];
    for (const value of content) {
      if (!value || typeof value !== 'object') continue;
      const part = value as { text?: unknown; type?: unknown };
      if (part.type === 'output_text' && typeof part.text === 'string') {
        return part.text;
      }
    }
  }
  return '';
}

function anthropicOutputText(response: Record<string, unknown>): string {
  const content = Array.isArray(response.content) ? response.content : [];
  return content
    .map((value) => {
      const part = value as { text?: unknown; type?: unknown };
      return part?.type === 'text' && typeof part.text === 'string' ? part.text : '';
    })
    .filter(Boolean)
    .join(' ');
}

function geminiOutputText(response: Record<string, unknown>): string {
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  const values: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const content = (candidate as { content?: unknown }).content;
    if (!content || typeof content !== 'object') continue;
    const parts = Array.isArray((content as { parts?: unknown }).parts)
      ? ((content as { parts: unknown[] }).parts ?? [])
      : [];
    for (const part of parts) {
      if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
        values.push((part as { text: string }).text);
      }
    }
  }
  return values.join(' ');
}

function supportsReasoning(model: string): boolean {
  return /^(gpt-5|o\d)/.test(model);
}

async function postJson(
  url: string,
  label: string,
  headers: Record<string, string>,
  body: unknown,
  fetcher: typeof fetch,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`${label} returned ${response.status}: ${raw.slice(0, 180)}`);
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} returned invalid JSON`);
    }
    return parsed as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestOpenAi(
  model: string,
  facts: string,
  apiKey: string,
  fetcher: typeof fetch,
): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    store: false,
    max_output_tokens: 64,
    input: [
      {
        role: 'system',
        content: [{ type: 'input_text', text: SYSTEM_PROMPT }],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: facts }],
      },
    ],
  };
  if (supportsReasoning(model)) body.reasoning = { effort: 'low' };

  const response = await postJson(
    'https://api.openai.com/v1/responses',
    `OpenAI ${model}`,
    { Authorization: `Bearer ${apiKey}` },
    body,
    fetcher,
  );
  return sanitize(openAiOutputText(response));
}

async function requestAnthropic(
  model: string,
  facts: string,
  apiKey: string,
  fetcher: typeof fetch,
): Promise<string> {
  const response = await postJson(
    'https://api.anthropic.com/v1/messages',
    `Anthropic ${model}`,
    {
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
    },
    {
      model,
      max_tokens: 64,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: facts }],
    },
    fetcher,
  );
  return sanitize(anthropicOutputText(response));
}

async function requestGemini(
  model: string,
  facts: string,
  apiKey: string,
  fetcher: typeof fetch,
): Promise<string> {
  const response = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    `Gemini ${model}`,
    { 'x-goog-api-key': apiKey },
    {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: facts }] }],
      generationConfig: { maxOutputTokens: 64 },
    },
    fetcher,
  );
  return sanitize(geminiOutputText(response));
}

async function requestXai(
  model: string,
  facts: string,
  apiKey: string,
  fetcher: typeof fetch,
): Promise<string> {
  const response = await postJson(
    'https://api.x.ai/v1/responses',
    `xAI ${model}`,
    { Authorization: `Bearer ${apiKey}` },
    {
      model,
      store: false,
      max_output_tokens: 64,
      input: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: facts },
      ],
    },
    fetcher,
  );
  return sanitize(openAiOutputText(response));
}

interface ProviderCandidate {
  label: string;
  request: () => Promise<string>;
}

function providerCandidates(
  facts: string,
  env: QuipEnv,
  fetcher: typeof fetch,
): ProviderCandidate[] {
  const candidates: ProviderCandidate[] = [];
  if (env.OPENAI_API_KEY) {
    const models = [
      env.KANAREK_OPENAI_MODEL || PRIMARY_MODEL,
      env.KANAREK_OPENAI_FALLBACK_MODEL || FALLBACK_MODEL,
    ].filter((model, index, all) => model && all.indexOf(model) === index);
    for (const model of models) {
      candidates.push({
        label: `OpenAI ${model}`,
        request: () => requestOpenAi(model, facts, env.OPENAI_API_KEY ?? '', fetcher),
      });
    }
  }
  if (env.ANTHROPIC_API_KEY) {
    const model = env.KANAREK_ANTHROPIC_MODEL || ANTHROPIC_MODEL;
    candidates.push({
      label: `Anthropic ${model}`,
      request: () => requestAnthropic(model, facts, env.ANTHROPIC_API_KEY ?? '', fetcher),
    });
  }
  if (env.GEMINI_API_KEY) {
    const model = env.KANAREK_GEMINI_MODEL || GEMINI_MODEL;
    candidates.push({
      label: `Gemini ${model}`,
      request: () => requestGemini(model, facts, env.GEMINI_API_KEY ?? '', fetcher),
    });
  }
  if (env.XAI_API_KEY) {
    const model = env.KANAREK_XAI_MODEL || XAI_MODEL;
    candidates.push({
      label: `xAI ${model}`,
      request: () => requestXai(model, facts, env.XAI_API_KEY ?? '', fetcher),
    });
  }
  return candidates;
}

export async function aiQuip(
  facts: string,
  env: QuipEnv,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  const candidates = providerCandidates(facts, env, fetcher);

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const hasFallback = index + 1 < candidates.length;
    try {
      const value = await candidate.request();
      if (value.length >= 12) return value;
      console.warn(
        `${candidate.label} returned no usable quip${hasFallback ? '; trying next provider.' : '; using preset.'}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown provider error';
      console.warn(
        `${message}${hasFallback ? '; trying next provider.' : '; using preset.'}`,
      );
    }
  }
  return null;
}
