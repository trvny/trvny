import { miniAppOwnerAuthError } from "./mini-app.ts";
import { PayloadTooLargeError, readJsonWithLimit } from "./http.ts";
import { sendTelegramDocument, DocumentSendError } from "./doc-studio-transport.ts";
import type { Env, TelegramReply } from "./types.ts";

export const DOC_STUDIO_MAX_TEXT_BYTES = 64 * 1024;
const REQUEST_MAX_BYTES = 6 * DOC_STUDIO_MAX_TEXT_BYTES + 4096;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
type Submission = { requestId?: unknown; title?: unknown; text?: unknown; format?: unknown };
type GateState = { outcome?: string; state?: { status?: string } };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export function docStudioUrl(env: Env): string | null {
  try {
    const base = new URL(env.TELEGRAM_WEBHOOK_URL ?? "");
    return base.protocol === "https:" ? new URL("/mini-app?tab=doc", base).toString() : null;
  } catch {
    return null;
  }
}

export function docStudioReply(
  env: Env,
  chatId: string | number,
  replyToMessageId: number,
  chatType: string,
): TelegramReply {
  const url = chatType === "private" ? docStudioUrl(env) : null;
  return {
    chatId, replyToMessageId,
    text: url
      ? "📄 Docbench Draft Studio\nCreate, preview and export Markdown or text. Send to your private chat only when you choose."
      : "📄 Open a private chat with Botek and send /doc to use Draft Studio.",
    ...(url ? { replyMarkup: { inline_keyboard: [[{
      text: "📄 Create document", web_app: { url },
    }]] } } : {}),
  };
}

export function docStudioFilename(title: string, format: "md" | "txt" | "pdf"): string {
  const base = title.normalize("NFKC")
    .replace(/[^\p{L}\p{N}._ -]/gu, "")
    .replace(/[.\s]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64) || "draft";
  return base + "." + format;
}

async function gatePost(
  stub: { fetch(request: Request): Promise<Response> },
  path: string,
  token: string,
  body?: unknown,
): Promise<void> {
  const response = await stub.fetch(new Request("https://dedup.internal" + path, {
    method: "POST",
    headers: {
      "x-claim-token": token,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
  if (!response.ok) throw new Error("document_delivery_gate_unavailable");
}

export async function handleDocStudioSendRequest(
  request: Request, env: Env, nowMs = Date.now(),
): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "forbidden_origin" }, 403);
  const authError = await miniAppOwnerAuthError(request, env, nowMs);
  if (authError) return authError;
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "invalid_content_type" }, 415);
  }

  let input: Submission;
  try {
    input = await readJsonWithLimit<Submission>(request, REQUEST_MAX_BYTES);
  } catch (error) {
    return error instanceof PayloadTooLargeError
      ? json({ error: "document_too_large" }, 413)
      : json({ error: "invalid_json" }, 400);
  }
  if (!input || typeof input !== "object" ||
      typeof input.title !== "string" || !input.title.trim() || input.title.length > 100 ||
      typeof input.text !== "string" || !input.text.trim() ||
      typeof input.requestId !== "string" || !REQUEST_ID.test(input.requestId) ||
      (input.format !== "md" && input.format !== "txt")) {
    return json({ error: "invalid_document" }, 400);
  }
  if (new TextEncoder().encode(input.text).byteLength > DOC_STUDIO_MAX_TEXT_BYTES) {
    return json({ error: "document_too_large" }, 413);
  }

  return deliverDocToOwner(env, {
    filename: docStudioFilename(input.title, input.format),
    format: input.format,
    content: input.text,
    requestId: input.requestId,
  });
}

export async function deliverDocToOwner(
  env: Env,
  delivery: {
    filename: string;
    format: "md" | "txt" | "pdf";
    content: string | Uint8Array;
    requestId: string;
  },
): Promise<Response> {
  // The authenticated owner's private chat is the only possible destination.
  const chatId = env.OWNER_TELEGRAM_USER_ID!;
  const { filename, format, content, requestId } = delivery;
  const stub = env.TELEGRAM_DEDUP.get(env.TELEGRAM_DEDUP.idFromName(
    "doc-send:" + chatId + ":" + requestId,
  ));
  const token = crypto.randomUUID();
  try {
    const response = await stub.fetch(new Request("https://dedup.internal/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }));
    if (!response.ok) return json({ error: "delivery_unavailable" }, 503);
    const state = await response.json() as GateState;
    if (state.outcome === "terminal" || state.outcome === "uncertain") {
      return state.state?.status === "sent"
        ? json({ ok: true, alreadySent: true })
        : json({ error: "previous_delivery_uncertain_or_failed" }, 409);
    }
    if (state.outcome !== "claimed") return json({ error: "delivery_in_progress" }, 409);
    // Store only a minimal delivery marker, never the document itself.
    await gatePost(stub, "/prepare", token, { reply: { chatId, text: "[doc] " + filename } });
    // /sending is idempotent for the same claim. Retry the DO acknowledgement
    // before any Telegram upload. Never replay an actual Telegram send.
    let authorized = false;
    for (let attempt = 0; attempt < 3 && !authorized; attempt += 1) {
      try {
        await gatePost(stub, "/sending", token);
        authorized = true;
      } catch {
        if (attempt === 2) throw new Error("send_gate_unavailable");
      }
    }
  } catch {
    return json({ error: "delivery_unavailable" }, 503);
  }

  try {
    await sendTelegramDocument(env, chatId, filename, content, format);
  } catch (error) {
    const definitive = error instanceof DocumentSendError && !error.ambiguous && !error.retryable;
    try {
      await gatePost(stub, definitive ? "/failed" : "/ambiguous", token);
    } catch {
      // A send might have completed. Never automatically replay it.
    }
    return definitive ? json({ error: "telegram_rejected" }, 502)
      : json({ error: "delivery_uncertain" }, 202);
  }
  try {
    await gatePost(stub, "/sent", token);
  } catch {
    return json({ error: "delivery_uncertain" }, 202);
  }
  return json({ ok: true, filename });
}
