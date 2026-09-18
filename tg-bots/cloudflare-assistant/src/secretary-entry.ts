import worker, {
  TelegramConversationMemory,
  TelegramInlineQueryGate,
  TelegramMediaGroupGate,
  TelegramTaskWatch,
  TelegramUpdateDedup,
} from "./index";
import { handleMiniAppStatusRequest } from "./mini-app";
import { miniAppHtmlResponse } from "./mini-app-ui";
import { handleTelegramSecretaryUpdate } from "./secretary-runtime";
import { isTelegramWebhook, parseTelegramUpdate } from "./telegram";
import type { Env, QueueBatch, TelegramUpdate } from "./types";

export {
  TelegramConversationMemory,
  TelegramInlineQueryGate,
  TelegramMediaGroupGate,
  TelegramTaskWatch,
  TelegramUpdateDedup,
};

type SecretaryUpdate = TelegramUpdate & {
  business_connection?: unknown;
  business_message?: unknown;
  edited_business_message?: unknown;
  deleted_business_messages?: unknown;
};

function hasSecretaryPayload(update: TelegramUpdate): boolean {
  const candidate = update as SecretaryUpdate;
  return Boolean(
    candidate.business_connection ||
    candidate.business_message ||
    candidate.edited_business_message ||
    candidate.deleted_business_messages
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/mini-app") {
      return miniAppHtmlResponse();
    }
    if (url.pathname === "/mini-app/api/status") {
      return handleMiniAppStatusRequest(request, env);
    }
    if (
      request.method === "POST" &&
      url.pathname === "/telegram/webhook" &&
      isTelegramWebhook(request, env)
    ) {
      try {
        const update = await parseTelegramUpdate(request.clone());
        if (hasSecretaryPayload(update)) {
          try {
            await handleTelegramSecretaryUpdate(env, update);
          } catch (error) {
            // Secretary notifications are owner-facing one-shots. Do not ask Telegram
            // to replay after an ambiguous delivery and risk duplicate suggestions.
            console.error("Telegram secretary handling failed", error);
          }
          return new Response("OK");
        }
      } catch {
        // Delegate malformed/oversized input to the canonical webhook handler so it
        // preserves the existing validation response and logging behavior.
      }
    }
    return worker.fetch(request, env);
  },

  async queue(batch: QueueBatch<TelegramUpdate>, env: Env): Promise<void> {
    await worker.queue(batch, env);
  },

  async scheduled(controller: unknown, env: Env): Promise<void> {
    await worker.scheduled(controller, env);
  },
};
