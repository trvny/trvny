import { chatWithInlineFallback } from "./providers";
import {
  formatSecretaryNotification,
  isOwnerBusinessConnection,
  secretaryAutoReplyDueAt,
  secretaryAutoReplyEnabled,
  secretaryContextBlock,
  secretaryContextEntry,
  secretaryDraftInput,
  secretaryDraftKeyboard,
  secretaryDraftSystemPrompt,
} from "./secretary";
import {
  sendTelegramMessage,
  TelegramConfigurationError,
} from "./telegram";
import type { Env } from "./types";
import type {
  SecretaryContextEntry,
  TelegramBusinessConnection,
  TelegramBusinessMessage,
  TelegramBusinessMessagesDeleted,
} from "./secretary";
import {
  cancelConditionWatch,
  createConditionWatch,
  listConditionWatches,
  updateConditionWatch,
  watchIdForUpdate,
  type SecretaryIdleWatch,
} from "./watches";

const TELEGRAM_API = "https://api.telegram.org";

type BusinessUpdate = {
  update_id?: number;
  business_connection?: TelegramBusinessConnection;
  business_message?: TelegramBusinessMessage;
  edited_business_message?: TelegramBusinessMessage;
  deleted_business_messages?: TelegramBusinessMessagesDeleted;
};

type BusinessConnectionResponse = {
  ok?: boolean;
  description?: string;
  result?: TelegramBusinessConnection;
};

type SecretaryContextResponse = {
  entries?: SecretaryContextEntry[];
};

function ownerChatId(env: Env, connection: TelegramBusinessConnection): string | number {
  const configured = env.TELEGRAM_OWNER_CHAT_ID?.trim();
  if (configured) return configured;
  return connection.user_chat_id;
}

function secretaryContextStub(env: Env, connectionId: string, chatId: number) {
  const id = env.TELEGRAM_MEMORY.idFromName(`secretary:${connectionId}:${chatId}`);
  return env.TELEGRAM_MEMORY.get(id);
}

function secretaryWatchMatches(
  watch: SecretaryIdleWatch,
  connectionId: string,
  chatId?: number,
): boolean {
  return watch.connectionId === connectionId &&
    (chatId === undefined || watch.chatId === chatId);
}

async function matchingSecretaryWatches(
  env: Env,
  connectionId: string,
  chatId?: number,
): Promise<SecretaryIdleWatch[]> {
  const watches = await listConditionWatches(env);
  return watches.filter((watch): watch is SecretaryIdleWatch =>
    watch.kind === "secretary" && secretaryWatchMatches(watch, connectionId, chatId)
  );
}

async function cancelSecretaryAutoReplies(
  env: Env,
  connectionId: string,
  chatId?: number,
): Promise<void> {
  try {
    const watches = await matchingSecretaryWatches(env, connectionId, chatId);
    await Promise.all(watches.map((watch) => cancelConditionWatch(env, watch.id)));
  } catch (error) {
    console.warn("Telegram secretary idle watch cancel failed", error);
  }
}

async function refreshSecretaryAutoReplyContext(
  env: Env,
  connectionId: string,
  chatId: number,
  contextBlock: string,
): Promise<void> {
  if (!contextBlock) return;
  try {
    const watches = await matchingSecretaryWatches(env, connectionId, chatId);
    await Promise.all(watches.map((watch) =>
      updateConditionWatch(env, { ...watch, contextBlock })
    ));
  } catch (error) {
    console.warn("Telegram secretary idle watch refresh failed", error);
  }
}

async function scheduleSecretaryAutoReply(
  env: Env,
  updateId: number | undefined,
  connection: TelegramBusinessConnection,
  input: { chatId: number; messageId: number; sender: string },
  contextBlock: string,
  messageDate?: number,
): Promise<void> {
  if (!secretaryAutoReplyEnabled(env.SECRETARY_AUTO_REPLY_SCOPE)) return;
  if (!connection.rights?.can_reply || !Number.isSafeInteger(updateId) || !contextBlock) return;

  try {
    const existing = await matchingSecretaryWatches(env, connection.id, input.chatId);
    await Promise.all(existing.map((watch) => cancelConditionWatch(env, watch.id)));

    const now = Date.now();
    await createConditionWatch(env, {
      id: watchIdForUpdate(updateId as number),
      chatId: input.chatId,
      replyToMessageId: input.messageId,
      createdAt: new Date(now).toISOString(),
      nextCheckAt: secretaryAutoReplyDueAt(messageDate, now),
      status: "active",
      failures: 0,
      kind: "secretary",
      connectionId: connection.id,
      sender: input.sender,
      contextBlock,
    });
  } catch (error) {
    console.warn("Telegram secretary idle watch schedule failed", error);
  }
}

async function loadSecretaryContext(
  env: Env,
  connectionId: string,
  chatId: number,
): Promise<SecretaryContextEntry[]> {
  try {
    const response = await secretaryContextStub(env, connectionId, chatId).fetch("https://conversation/secretary-context");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as SecretaryContextResponse;
    return Array.isArray(payload.entries) ? payload.entries : [];
  } catch (error) {
    console.warn("Telegram secretary context read failed; continuing stateless", error);
    return [];
  }
}

async function appendSecretaryContext(
  env: Env,
  connectionId: string,
  chatId: number,
  entry: SecretaryContextEntry,
): Promise<void> {
  try {
    const response = await secretaryContextStub(env, connectionId, chatId).fetch("https://conversation/secretary-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(entry),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    console.warn("Telegram secretary context write failed; continuing without memory", error);
  }
}

async function removeSecretaryContext(
  env: Env,
  connectionId: string,
  chatId: number,
  messageIds: number[],
): Promise<void> {
  if (messageIds.length === 0) return;
  try {
    const response = await secretaryContextStub(env, connectionId, chatId).fetch("https://conversation/secretary-context/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageIds: messageIds.slice(0, 100) }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    console.warn("Telegram secretary context delete failed; continuing with stale bounded memory", error);
  }
}

async function getBusinessConnection(
  env: Env,
  connectionId: string,
): Promise<TelegramBusinessConnection> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new TelegramConfigurationError("TELEGRAM_BOT_TOKEN is not configured");
  }
  const response = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/getBusinessConnection`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ business_connection_id: connectionId }),
  });
  const payload = (await response.json()) as BusinessConnectionResponse;
  if (!response.ok || !payload.ok || !payload.result) {
    throw new Error(`Telegram getBusinessConnection failed: ${payload.description ?? `HTTP ${response.status}`}`);
  }
  return payload.result;
}

function connectionBelongsToOwner(connection: TelegramBusinessConnection, ownerUserId?: string): boolean {
  return Boolean(ownerUserId && String(connection.user.id) === ownerUserId);
}

async function notifyConnection(env: Env, connection: TelegramBusinessConnection): Promise<void> {
  if (!connectionBelongsToOwner(connection, env.OWNER_TELEGRAM_USER_ID)) return;
  const state = connection.is_enabled ? "połączony" : "wyłączony";
  const rights = [
    connection.rights?.can_reply ? "reply" : null,
    connection.rights?.can_read_messages ? "read-receipts" : null,
  ].filter(Boolean).join(", ") || "brak dodatkowych praw";
  if (!connection.is_enabled || !connection.rights?.can_reply) {
    await cancelSecretaryAutoReplies(env, connection.id);
  }
  const idle = secretaryAutoReplyEnabled(env.SECRETARY_AUTO_REPLY_SCOPE)
    ? "Auto-reply po 12 h: contacts-only."
    : "Auto-reply po 12 h: wyłączony.";
  await sendTelegramMessage(
    env,
    ownerChatId(env, connection),
    `🧑‍💼 Sekretarz Telegram: ${state}. Uprawnienia Telegrama: ${rights}. ${idle}`,
  );
}

async function syncEditedBusinessMessage(
  env: Env,
  message: TelegramBusinessMessage,
): Promise<void> {
  const connectionId = message.business_connection_id?.trim();
  if (!connectionId || !Number.isSafeInteger(message.chat?.id) || !Number.isSafeInteger(message.message_id) || message.message_id <= 0) return;
  const connection = await getBusinessConnection(env, connectionId);
  if (!isOwnerBusinessConnection(connection, env.OWNER_TELEGRAM_USER_ID)) return;
  const entry = secretaryContextEntry(message, connection);
  if (entry) {
    await appendSecretaryContext(env, connection.id, message.chat.id, entry);
    if (entry.direction === "owner") {
      await cancelSecretaryAutoReplies(env, connection.id, message.chat.id);
    } else {
      const context = await loadSecretaryContext(env, connection.id, message.chat.id);
      await refreshSecretaryAutoReplyContext(
        env,
        connection.id,
        message.chat.id,
        secretaryContextBlock(context),
      );
    }
  } else {
    await removeSecretaryContext(env, connection.id, message.chat.id, [message.message_id]);
  }
}

async function syncDeletedBusinessMessages(
  env: Env,
  deleted: TelegramBusinessMessagesDeleted,
): Promise<void> {
  const connectionId = deleted.business_connection_id?.trim();
  if (!connectionId || !Number.isSafeInteger(deleted.chat?.id)) return;
  const messageIds = Array.from(new Set(
    (deleted.message_ids ?? []).filter((id) => Number.isSafeInteger(id) && id > 0),
  )).slice(0, 100);
  if (messageIds.length === 0) return;
  const connection = await getBusinessConnection(env, connectionId);
  if (!isOwnerBusinessConnection(connection, env.OWNER_TELEGRAM_USER_ID)) return;
  await removeSecretaryContext(env, connection.id, deleted.chat.id, messageIds);
  await cancelSecretaryAutoReplies(env, connection.id, deleted.chat.id);
}

async function draftIncomingBusinessMessage(
  env: Env,
  message: TelegramBusinessMessage,
  updateId?: number,
): Promise<void> {
  const connectionId = message.business_connection_id?.trim();
  if (!connectionId) return;
  const connection = await getBusinessConnection(env, connectionId);
  if (!isOwnerBusinessConnection(connection, env.OWNER_TELEGRAM_USER_ID)) return;

  const contextEntry = secretaryContextEntry(message, connection);
  if (!contextEntry) return;
  const input = secretaryDraftInput(message, connection);
  if (!input) {
    await appendSecretaryContext(env, connection.id, message.chat.id, contextEntry);
    if (contextEntry.direction === "owner") {
      await cancelSecretaryAutoReplies(env, connection.id, message.chat.id);
    }
    return;
  }

  const previousContext = await loadSecretaryContext(env, connection.id, input.chatId);
  const contextBlock = secretaryContextBlock([...previousContext, contextEntry]);
  try {
    const result = await chatWithInlineFallback(env, [
      { role: "system", content: secretaryDraftSystemPrompt() },
      {
        role: "user",
        content: [
          contextBlock,
          `The final context entry is the current UNTRUSTED Telegram Business message from ${input.sender}. Draft a reply to that entry only.`,
        ].filter(Boolean).join("\n\n"),
      },
    ]);
    const draft = result.text.trim() || "Brak propozycji odpowiedzi.";
    const notification = formatSecretaryNotification({
      sender: input.sender,
      source: input.text,
      draft,
    });
    const keyboard = secretaryDraftKeyboard(draft);
    await sendTelegramMessage(
      env,
      ownerChatId(env, connection),
      notification,
      keyboard ? { replyMarkup: keyboard } : {},
    );
  } finally {
    await appendSecretaryContext(env, connection.id, input.chatId, contextEntry);
    await scheduleSecretaryAutoReply(
      env,
      updateId,
      connection,
      input,
      contextBlock,
      message.date,
    );
  }
}

export async function handleTelegramSecretaryUpdate(env: Env, update: unknown): Promise<boolean> {
  if (!update || typeof update !== "object") return false;
  const business = update as BusinessUpdate;
  if (business.business_connection) {
    await notifyConnection(env, business.business_connection);
    return true;
  }
  if (business.business_message) {
    const updateId = Number.isSafeInteger(business.update_id) ? business.update_id : undefined;
    await draftIncomingBusinessMessage(env, business.business_message, updateId);
    return true;
  }
  if (business.edited_business_message) {
    await syncEditedBusinessMessage(env, business.edited_business_message);
    return true;
  }
  if (business.deleted_business_messages) {
    await syncDeletedBusinessMessages(env, business.deleted_business_messages);
    return true;
  }
  return false;
}
