const MINI_APP_MAX_AGE_SECONDS = 60 * 60;
const MINI_APP_FUTURE_SKEW_SECONDS = 60;

export type MiniAppValidation =
  | { ok: true; userId: string; authDate: number }
  | { ok: false; reason: "configuration" | "invalid" | "expired" | "forbidden" };

const encoder = new TextEncoder();

async function hmacKey(key: BufferSource): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function hexBytes(value: string): ArrayBuffer | null {
  if (!/^[0-9a-f]{64}$/iu.test(value)) return null;
  const bytes = Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
  return bytes.buffer as ArrayBuffer;
}

function dataCheckString(params: URLSearchParams): string {
  return [...params.entries()]
    .filter(([key]) => key !== "hash")
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join("\n");
}
export async function validateMiniAppInitData(
  initData: string,
  botToken: string | undefined,
  ownerUserId: string | undefined,
  nowMs = Date.now(),
): Promise<MiniAppValidation> {
  if (!initData || initData.length > 16_384) return { ok: false, reason: "invalid" };
  if (!botToken || !ownerUserId || !/^\d+$/u.test(ownerUserId)) {
    return { ok: false, reason: "configuration" };
  }
  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  const signature = receivedHash ? hexBytes(receivedHash) : null;
  if (!signature) return { ok: false, reason: "invalid" };

  const webAppKey = await hmacKey(encoder.encode("WebAppData"));
  const secret = await crypto.subtle.sign("HMAC", webAppKey, encoder.encode(botToken));
  const validationKey = await hmacKey(secret);
  const authentic = await crypto.subtle.verify(
    "HMAC",
    validationKey,
    signature,
    encoder.encode(dataCheckString(params)),
  );
  if (!authentic) return { ok: false, reason: "invalid" };

  const authDate = Number(params.get("auth_date"));
  if (!Number.isSafeInteger(authDate) || authDate <= 0) return { ok: false, reason: "invalid" };
  const ageSeconds = nowMs / 1000 - authDate;
  if (ageSeconds > MINI_APP_MAX_AGE_SECONDS || ageSeconds < -MINI_APP_FUTURE_SKEW_SECONDS) {
    return { ok: false, reason: "expired" };
  }

  const rawUser = params.get("user");
  if (!rawUser) return { ok: false, reason: "invalid" };
  let userId: string;
  try {
    const user = JSON.parse(rawUser) as { id?: unknown };
    if ((typeof user.id !== "number" && typeof user.id !== "string") || !/^\d+$/u.test(String(user.id))) {
      return { ok: false, reason: "invalid" };
    }
    userId = String(user.id);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (userId !== ownerUserId) return { ok: false, reason: "forbidden" };
  return { ok: true, userId, authDate };
}
type MiniAppDispatcher = {
  meta(): Promise<unknown>;
  recentTasks(limit?: number): Promise<unknown[]>;
};

type MiniAppEnv = {
  TELEGRAM_BOT_TOKEN?: string;
  OWNER_TELEGRAM_USER_ID?: string;
  PET_DISPATCHER?: unknown;
};

function miniAppJson(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function handleMiniAppStatusRequest(
  request: Request,
  env: MiniAppEnv,
  nowMs = Date.now(),
): Promise<Response> {
  if (request.method !== "GET") return miniAppJson({ error: "method_not_allowed" }, 405);

  const validation = await validateMiniAppInitData(
    request.headers.get("x-telegram-init-data") ?? "",
    env.TELEGRAM_BOT_TOKEN,
    env.OWNER_TELEGRAM_USER_ID,
    nowMs,
  );
  if (!validation.ok) {
    const status = validation.reason === "configuration" ? 503 : 401;
    return miniAppJson({ error: validation.reason === "configuration" ? "mini_app_not_configured" : "unauthorized" }, status);
  }

  const dispatcher = env.PET_DISPATCHER as MiniAppDispatcher | undefined;
  if (!dispatcher) return miniAppJson({ error: "pet_dispatcher_unavailable" }, 503);

  try {
    const [legion, tasks] = await Promise.all([
      dispatcher.meta(),
      dispatcher.recentTasks(10),
    ]);
    return miniAppJson({ ok: true, legion, tasks });
  } catch (error) {
    console.error("Mini App Pet Dispatcher status failed", error);
    return miniAppJson({ error: "pet_dispatcher_unavailable" }, 503);
  }
}
