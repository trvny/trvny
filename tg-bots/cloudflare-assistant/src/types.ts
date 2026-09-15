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

export type PetDispatcherRpcResult = { status: number; body: unknown };

export type PetDispatcherBinding = {
  meta(): Promise<{ deviceId: string; transport: string; protocol: number }>;
  delegate(task: unknown, idempotencyKey?: string): Promise<PetDispatcherRpcResult>;
  getTask(taskId: string): Promise<PetDispatcherRpcResult>;
  cancelTask(taskId: string): Promise<PetDispatcherRpcResult>;
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

export type TelegramButtonStyle = "danger" | "success" | "primary";

export type TelegramInlineKeyboardButton =
  | { text: string; style?: TelegramButtonStyle; callback_data: string; copy_text?: never; switch_inline_query?: never }
  | { text: string; style?: TelegramButtonStyle; copy_text: { text: string }; callback_data?: never; switch_inline_query?: never }
  | { text: string; style?: TelegramButtonStyle; switch_inline_query: string; callback_data?: never; copy_text?: never };

export type TelegramInlineKeyboardMarkup = {
  inline_keyboard: TelegramInlineKeyboardButton[][];
};

export type TelegramLocation = {
  latitude: number;
  longitude: number;
  horizontal_accuracy?: number;
  live_period?: number;
  heading?: number;
  proximity_alert_radius?: number;
};

export type TelegramContact = {
  phone_number: string;
  first_name: string;
  last_name?: string;
  user_id?: number;
  vcard?: string;
};

export type TelegramVenue = {
  location: TelegramLocation;
  title: string;
  address: string;
  foursquare_id?: string;
  foursquare_type?: string;
  google_place_id?: string;
  google_place_type?: string;
};

export type TelegramPhotoSize = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
};

export type TelegramVisualMedia = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
  thumbnail?: TelegramPhotoSize;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

export type TelegramVideoNote = {
  file_id: string;
  file_unique_id: string;
  length: number;
  duration: number;
  thumbnail?: TelegramPhotoSize;
  file_size?: number;
};

export type TelegramSticker = {
  file_id: string;
  file_unique_id: string;
  type: "regular" | "mask" | "custom_emoji" | string;
  width: number;
  height: number;
  is_animated: boolean;
  is_video: boolean;
  thumbnail?: TelegramPhotoSize;
  emoji?: string;
  set_name?: string;
  custom_emoji_id?: string;
  needs_repainting?: true;
  file_size?: number;
};

export type TelegramDice = {
  emoji: string;
  value: number;
};

export type TelegramPoll = {
  id: string;
  question: string;
  options: Array<{ text: string; voter_count: number }>;
  total_voter_count: number;
  is_closed: boolean;
  is_anonymous: boolean;
  type: "regular" | "quiz" | string;
  allows_multiple_answers: boolean;
  correct_option_ids?: number[];
  explanation?: string;
};

export type TelegramDocument = {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

export type TelegramAudio = {
  file_id: string;
  file_unique_id: string;
  duration: number;
  performer?: string;
  title?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

export type TelegramMessageOrigin = {
  type: string;
  date?: number;
  sender_user?: { id: number; first_name?: string; last_name?: string; username?: string };
  sender_user_name?: string;
  sender_chat?: { id: number; type: string; title?: string; username?: string };
  chat?: { id: number; type: string; title?: string; username?: string };
  message_id?: number;
  author_signature?: string;
};

export type TelegramTextQuote = {
  text: string;
  position?: number;
  is_manual?: true;
};

export type TelegramMessage = {
  message_id: number;
  message_thread_id?: number;
  is_topic_message?: boolean;
  text?: string;
  caption?: string;
  forward_origin?: TelegramMessageOrigin;
  reply_to_message?: TelegramMessage;
  quote?: TelegramTextQuote;
  photo?: TelegramPhotoSize[];
  sticker?: TelegramSticker;
  dice?: TelegramDice;
  animation?: TelegramVisualMedia;
  video?: TelegramVisualMedia;
  video_note?: TelegramVideoNote;
  document?: TelegramDocument;
  audio?: TelegramAudio;
  poll?: TelegramPoll;
  location?: TelegramLocation;
  venue?: TelegramVenue;
  contact?: TelegramContact;
  voice?: {
    file_id: string;
    duration: number;
    mime_type?: string;
    file_size?: number;
  };
  chat: { id: number; type: string };
  from?: { id: number; username?: string; first_name?: string };
  receiver_user?: { id: number; username?: string; first_name?: string };
  ephemeral_message_id?: number;
  guest_query_id?: string;
};

export type TelegramInlineQuery = {
  id: string;
  from: { id: number; username?: string; first_name?: string };
  query: string;
  offset: string;
  chat_type?: string;
};

export type TelegramInputMessageContent =
  | {
      message_text: string;
      link_preview_options?: { is_disabled: boolean };
    }
  | {
      rich_message: { markdown?: string; html?: string };
    };

export type TelegramInlineQueryResultArticle = {
  type: "article";
  id: string;
  title: string;
  description?: string;
  input_message_content: TelegramInputMessageContent;
};

export type TelegramCallbackQuery = {
  id: string;
  data?: string;
  from: { id: number; username?: string; first_name?: string };
  message?: {
    message_id: number;
    message_thread_id?: number;
    chat: { id: number; type: string };
  };
};

export type TelegramMessageGenerationStopped = {
  chat: { id: number; type: string };
  message_thread_id?: number;
  draft_id: number;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  guest_message?: TelegramMessage;
  inline_query?: TelegramInlineQuery;
  callback_query?: TelegramCallbackQuery;
  stopped_message_generation?: TelegramMessageGenerationStopped;
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
  KANAREK_COMPANION: FetcherBinding;
  PET_DISPATCHER?: PetDispatcherBinding;
  TELEGRAM_UPDATES: QueueBinding<TelegramUpdate>;
  TELEGRAM_DLQ: QueueBinding<TelegramDeadLetter>;
  TELEGRAM_DEDUP: DurableObjectNamespaceLike;
  TELEGRAM_MEMORY: DurableObjectNamespaceLike;
  TELEGRAM_INLINE: DurableObjectNamespaceLike;
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
