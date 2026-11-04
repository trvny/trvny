import { miniAppOwnerAuthError } from "./mini-app.ts";
import { docStudioFilename, deliverDocToOwner } from "./doc-studio.ts";
import { PayloadTooLargeError, readBytesWithLimit } from "./http.ts";
import type { Env } from "./types.ts";

export const DOC_PDF_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

export function validPdfSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 64) return false;
  const start = new TextDecoder().decode(bytes.subarray(0, 5));
  const tail = new TextDecoder().decode(bytes.subarray(Math.max(0, bytes.byteLength - 2048)));
  return start === "%PDF-" && tail.includes("%%EOF");
}

export async function handleDocStudioPdfSendRequest(
  request: Request,
  env: Env,
  nowMs = Date.now(),
): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "forbidden_origin" }, 403);
  }

  const authError = await miniAppOwnerAuthError(request, env, nowMs);
  if (authError) return authError;
  if (request.headers.get("content-type")?.toLowerCase() !== "application/pdf") {
    return json({ error: "invalid_content_type" }, 415);
  }

  const requestId = request.headers.get("x-doc-request-id");
  const encodedName = request.headers.get("x-doc-filename");
  if (!requestId || !REQUEST_ID.test(requestId) || !encodedName || encodedName.length > 400) {
    return json({ error: "invalid_document" }, 400);
  }

  let title: string;
  try {
    const decoded = decodeURIComponent(encodedName);
    if (!/\.pdf$/iu.test(decoded) || decoded.length > 120 ||
      decoded.includes("/") || decoded.includes("\\") || decoded.includes("\u0000")) {
      return json({ error: "invalid_filename" }, 400);
    }
    title = decoded.replace(/\.pdf$/iu, "");
    if (!title.trim()) return json({ error: "invalid_filename" }, 400);
  } catch {
    return json({ error: "invalid_filename" }, 400);
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBytesWithLimit(request, DOC_PDF_MAX_UPLOAD_BYTES);
  } catch (error) {
    return error instanceof PayloadTooLargeError
      ? json({ error: "document_too_large" }, 413)
      : json({ error: "invalid_document" }, 400);
  }
  if (!validPdfSignature(bytes)) return json({ error: "invalid_pdf" }, 400);

  return deliverDocToOwner(env, {
    filename: docStudioFilename(title, "pdf"),
    format: "pdf",
    content: bytes,
    requestId,
  });
}
