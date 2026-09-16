import type {
  DurableObjectStateLike,
  Env,
  TelegramMessage,
  TelegramUpdate,
} from "./types";

const STATE_KEY = "media-group";
const DEBOUNCE_MS = 900;
const MAX_ITEMS = 10;

type MediaGroupState = {
  updates: TelegramUpdate[];
};

function isAlbumUpdate(update: TelegramUpdate): boolean {
  const message = update.message;
  return Boolean(
    message?.media_group_id &&
    Number.isSafeInteger(message.message_id) &&
    Number.isSafeInteger(update.update_id),
  );
}

function groupKey(message: TelegramMessage): string | null {
  const groupId = message.media_group_id?.trim();
  return groupId ? `${message.chat.id}:${groupId}` : null;
}
export async function enqueueTelegramMediaGroup(
  env: Env,
  update: TelegramUpdate,
): Promise<boolean> {
  const message = update.message;
  if (!message || !isAlbumUpdate(update)) return false;
  if (!env.OWNER_TELEGRAM_USER_ID || String(message.from?.id) !== env.OWNER_TELEGRAM_USER_ID) {
    return false;
  }
  const key = groupKey(message);
  if (!key) return false;

  const stub = env.TELEGRAM_MEDIA_GROUPS.get(env.TELEGRAM_MEDIA_GROUPS.idFromName(key));
  const response = await stub.fetch("https://media-group/enqueue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ update }),
  });
  if (!response.ok) {
    throw new Error(`Telegram media-group enqueue failed: HTTP ${response.status}`);
  }
  return true;
}
export class TelegramMediaGroupGate {
  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/enqueue") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    const payload = (await request.json()) as { update?: TelegramUpdate };
    const update = payload.update;
    if (!update || !isAlbumUpdate(update)) {
      return Response.json({ error: "invalid_update" }, { status: 400 });
    }

    const current = await this.state.storage.get<MediaGroupState>(STATE_KEY);
    const updates = [...(current?.updates ?? [])];
    if (!updates.some((item) => item.update_id === update.update_id)) {
      updates.push(update);
    }
    updates.sort((a, b) => (a.message?.message_id ?? 0) - (b.message?.message_id ?? 0));
    await this.state.storage.put(STATE_KEY, { updates: updates.slice(0, MAX_ITEMS) });
    await this.state.storage.setAlarm(Date.now() + DEBOUNCE_MS);
    return Response.json({ accepted: true }, { status: 202 });
  }
  async alarm(): Promise<void> {
    const current = await this.state.storage.get<MediaGroupState>(STATE_KEY);
    const updates = current?.updates ?? [];
    if (updates.length === 0) return;

    const ordered = [...updates]
      .filter((update) => update.message)
      .sort((a, b) => (a.message?.message_id ?? 0) - (b.message?.message_id ?? 0));
    const first = ordered[0];
    if (!first?.message) {
      await this.state.storage.deleteAll();
      return;
    }

    const aggregate: TelegramUpdate = {
      ...first,
      update_id: Math.min(...ordered.map((update) => update.update_id)),
      message: {
        ...first.message,
        media_group_items: ordered.flatMap((update) => update.message ? [update.message] : []),
      },
    };
    await this.env.TELEGRAM_UPDATES.send(aggregate);
    await this.state.storage.deleteAll();
  }
}
