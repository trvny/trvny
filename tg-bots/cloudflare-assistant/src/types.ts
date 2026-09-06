export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiBinding = {
  run(model: string, input: unknown): Promise<unknown>;
};

export type QueueBinding<T> = {
  send(body: T): Promise<void>;
};

export type QueueMessage<T> = {
  body: T;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};

export type QueueBatch<T> = {
  messages: QueueMessage<T>[];
};

export type Env = {
  AI: AiBinding;
  TELEGRAM_UPDATES: QueueBinding<TelegramUpdate>;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  INGEST_SECRET?: string;
  OWNER_TELEGRAM_USER_ID?: string;
  TELEGRAM_OWNER_CHAT_ID?: string;
  ORCAROUTER_API_KEY?: string;
  OLLAMA_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  ORCAROUTER_MODEL: string;
  OLLAMA_MODEL: string;
  OPENROUTER_MODEL: string;
  WORKERS_AI_MODEL: string;
  RSS_MIN_SCORE: string;
};

export type TelegramMessage = {
  message_id: number;
  text?: string;
  chat: { id: number; type: string };
  from?: { id: number; username?: string; first_name?: string };
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

export type RssItem = {
  title: string;
  url: string;
  summary?: string;
  source?: string;
};

export type RssDecision = {
  score: number;
  reason: string;
  summary: string;
};
