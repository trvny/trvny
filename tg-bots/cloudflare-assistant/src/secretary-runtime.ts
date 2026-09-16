import { chatWithInlineFallback } from "./providers";
import {
  formatSecretaryNotification,
  isOwnerBusinessConnection,
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
} from "./secretary";

const TELEGRAM_API = "https://api.telegram.org";

type BusinessUpdate = {
  update_id?: number;
  business_connection?: TelegramBusinessConnection;
  business_message?: TelegramBusinessMessage;
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
  await sendTelegramMessage(
    env,
    ownerChatId(env, connection),
    `🧑‍💼 Sekretarz Telegram: ${state}. Uprawnienia Telegrama: ${rights}. Botek pozostaje w trybie draft-only i nie odpowiada za Ciebie automatycznie.`,
  );
}

async function draftIncomingBusinessMessage(
  env: Env,
  message: TelegramBusinessMessage,
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
    return;
  }

  const previousContext = await loadSecretaryContext(env, connection.id, input.chatId);
  const contextBlock = secretaryContextBlock(previousContext);
  try {
    const result = await chatWithInlineFallback(env, [
      { role: "system", content: secretaryDraftSystemPrompt() },
      {
        role: "user",
        content: [
          contextBlock,
          `Current UNTRUSTED Telegram Business message from ${input.sender}:\n${input.text}`,
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
    await draftIncomingBusinessMessage(env, business.business_message);
    return true;
  }
  return false;
}
