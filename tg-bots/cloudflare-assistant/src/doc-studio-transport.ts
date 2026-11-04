import type { Env } from "./types.ts";

const TELEGRAM_API = "https://api.telegram.org";
export class DocumentSendError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
    readonly ambiguous = false,
  ) {
    super("Telegram document delivery not confirmed");
    this.name = "DocumentSendError";
  }
}

export async function sendTelegramDocument(
  env: Env,
  chatId: string,
  filename: string,
  content: string | Uint8Array,
  format: "md" | "txt" | "pdf",
): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new DocumentSendError(503, false);
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("document", new Blob([
    typeof content === "string" ? content : new Uint8Array(content),
  ], {
    type: format === "pdf" ? "application/pdf"
      : format === "md" ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8",
  }), filename);

  let response: Response;
  try {
    response = await fetch(`${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new DocumentSendError(0, true, true);
  }
  if (!response.ok) {
    throw new DocumentSendError(response.status, response.status === 429 || response.status >= 500);
  }
  let result: { ok?: boolean };
  try {
    result = await response.json() as { ok?: boolean };
  } catch {
    throw new DocumentSendError(0, true, true);
  }
  if (result?.ok !== true) throw new DocumentSendError(400, false);
}
