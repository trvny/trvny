export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiBinding = {
  run(model: string, input: unknown): Promise<unknown>;
};

export type FetcherBinding = {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
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

export type DurableObjectIdLike = object;

export type DurableObjectStubLike = {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
};

export type DurableObjectNamespaceLike = {
  idFromName(name: string): DurableObjectIdLike;
  get(id: DurableObjectIdLike): DurableObjectStubLike;
};

export type DurableObjectStorageLike = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  deleteAll(): Promise<void>;
  setAlarm(scheduledTime: number): Promise<void>;
};

export type DurableObjectStateLike = {
  storage: DurableObjectStorageLike;
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

export type TelegramReply = {
  chatId: string | number;
  text: string;
};

export type TelegramDeadLetter = {
  update: TelegramUpdate;
  reason: string;
  detail?: string;
  createdAt: string;
};

export type TelegramUpdateRecord = {
  status: "prepared" | "sending" | "sent" | "failed" | "ambiguous";
  reply?: TelegramReply;
  updatedAt: string;
  detail?: string;
};

export type Env = {
  AI: AiBinding;
  KANAREK_COMPANION: FetcherBinding;
  TELEGRAM_UPDATES: QueueBinding<TelegramUpdate>;
  TELEGRAM_DLQ: QueueBinding<TelegramDeadLetter>;
  TELEGRAM_DEDUP: DurableObjectNamespaceLike;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  INGEST_SECRET?: string;
  OWNER_TELEGRAM_USER_ID?: string;
  TELEGRAM_OWNER_CHAT_ID?: string;
  KANAREK_REVIEW_ROUTER_TOKEN?: string;
  WORKERS_AI_MODEL: string;
  RSS_MIN_SCORE: string;
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
