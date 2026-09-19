import type * as TelegramTypes from "@grammyjs/types";

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

export type BotekSpecialistBinding = {
  engramStatus(): Promise<unknown>;
  engramSearch(query: string, limit?: number): Promise<unknown>;
  engramStore(input: {
    text: string;
    category?: "preference" | "fact" | "decision" | "entity" | "other";
    importance?: number;
    metadata?: Record<string, unknown>;
  }): Promise<unknown>;
  feedseekRecent(input: {
    query?: string;
    since?: string;
    limit?: number;
    sources?: string[];
  }): Promise<unknown>;
  githubPullStatus(repository: string, number: number): Promise<unknown>;
};

export type QueueBinding<T> = {
  send(body: T): Promise<void>;
};

export type PetDispatcherRpcResult = { status: number; body: unknown };

export type PetDispatcherRecentTask = {
  taskId: string;
  deviceId?: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  heartbeatAt?: string;
  result?: {
    status?: string;
    summary?: string;
    commit?: string;
    exportedRef?: string;
    error?: string;
  };
};

export type PetDispatcherBinding = {
  meta(): Promise<{
    deviceId: string;
    transport: string;
    protocol: number;
    repositories?: string[];
    stale?: boolean;
  }>;
  delegate(task: unknown, idempotencyKey?: string): Promise<PetDispatcherRpcResult>;
  getTask(taskId: string): Promise<PetDispatcherRpcResult>;
  cancelTask(taskId: string): Promise<PetDispatcherRpcResult>;
  recentTasks(limit?: number): Promise<PetDispatcherRecentTask[]>;
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

export type TelegramButtonStyle = NonNullable<TelegramTypes.InlineKeyboardButton["style"]>;
export type TelegramInlineKeyboardButton = TelegramTypes.InlineKeyboardButton;
export type TelegramInlineKeyboardMarkup = TelegramTypes.InlineKeyboardMarkup;
export type TelegramLocation = TelegramTypes.Location;
export type TelegramContact = TelegramTypes.Contact;
export type TelegramVenue = TelegramTypes.Venue;
export type TelegramPhotoSize = TelegramTypes.PhotoSize;
export type TelegramVisualMedia = TelegramTypes.Animation | TelegramTypes.Video;
export type TelegramVideoNote = TelegramTypes.VideoNote;
export type TelegramSticker = TelegramTypes.Sticker;
export type TelegramDice = TelegramTypes.Dice;
export type TelegramPoll = TelegramTypes.Poll;
export type TelegramChecklistTask = TelegramTypes.ChecklistTask;
export type TelegramChecklist = TelegramTypes.Checklist;
export type TelegramChecklistTasksDone = TelegramTypes.ChecklistTasksDone;
export type TelegramChecklistTasksAdded = TelegramTypes.ChecklistTasksAdded;
export type TelegramDocument = TelegramTypes.Document;
export type TelegramAudio = TelegramTypes.Audio;
export type TelegramMessageOrigin = TelegramTypes.MessageOrigin;
export type TelegramTextQuote = TelegramTypes.TextQuote;
export type TelegramMessage = TelegramTypes.Message & { media_group_items?: TelegramMessage[] };
export type TelegramUpdateMessage = TelegramMessage & TelegramTypes.Update.NonChannel;
export type TelegramInlineQuery = TelegramTypes.InlineQuery;
export type TelegramInputMessageContent = TelegramTypes.InputMessageContent;
export type TelegramInlineQueryResultArticle = TelegramTypes.InlineQueryResultArticle;
export type TelegramCallbackQuery = TelegramTypes.CallbackQuery;
export type TelegramMessageGenerationStopped = TelegramTypes.MessageGenerationStopped;
export type TelegramUpdate = Omit<TelegramTypes.Update, "message" | "guest_message"> & {
  message?: TelegramUpdateMessage;
  guest_message?: TelegramUpdateMessage;
};

export type TelegramConversationTurn = {
  user: string;
  assistant: string;
  createdAt: string;
};

export type TelegramConversationHistory = {
  turns: TelegramConversationTurn[];
  generation: number;
};

export type TelegramMemoryTurn = Omit<TelegramConversationTurn, "createdAt"> & {
  generation: number;
};

export type TelegramLocationReply = { latitude: number; longitude: number };
export type TelegramVenueReply = TelegramLocationReply & { title: string; address: string };
export type TelegramContactReply = { phoneNumber: string; firstName: string; lastName?: string };

export type TelegramPollReply = {
  question: string;
  options: string[];
  type?: "regular" | "quiz";
  correctOptionIds?: number[];
};

export type TelegramDiceReply = { emoji: string };
export type TelegramStickerReply = { fileId: string; emoji?: string };

export type TelegramReply = {
  chatId: string | number;
  messageThreadId?: number;
  text: string;
  replyToMessageId?: number;
  editMessageId?: number;
  replyMarkup?: TelegramInlineKeyboardMarkup;
  memoryTurn?: TelegramMemoryTurn;
  finalReaction?: "👍" | "👎" | "🤨";
  richMarkdown?: boolean;
  richHtml?: string;
  sticker?: TelegramStickerReply;
  dice?: TelegramDiceReply;
  poll?: TelegramPollReply;
  location?: TelegramLocationReply;
  venue?: TelegramVenueReply;
  contact?: TelegramContactReply;
  createTopic?: { name: string };
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
  CF_VERSION_METADATA?: { id?: string; tag?: string; timestamp?: string };
  KANAREK_COMPANION: FetcherBinding;
  BOTEK_SPECIALISTS?: BotekSpecialistBinding;
  PET_DISPATCHER?: PetDispatcherBinding;
  TELEGRAM_UPDATES: QueueBinding<TelegramUpdate>;
  TELEGRAM_DLQ: QueueBinding<TelegramDeadLetter>;
  TELEGRAM_DEDUP: DurableObjectNamespaceLike;
  TELEGRAM_MEMORY: DurableObjectNamespaceLike;
  TELEGRAM_INLINE: DurableObjectNamespaceLike;
  TELEGRAM_MEDIA_GROUPS: DurableObjectNamespaceLike;
  TELEGRAM_TASK_WATCH: DurableObjectNamespaceLike;
  TELEGRAM_REMINDERS: DurableObjectNamespaceLike;
  TELEGRAM_WATCHES: DurableObjectNamespaceLike;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  INGEST_SECRET?: string;
  OWNER_TELEGRAM_USER_ID?: string;
  TELEGRAM_OWNER_CHAT_ID?: string;
  SECRETARY_AUTO_REPLY_SCOPE?: string;
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
