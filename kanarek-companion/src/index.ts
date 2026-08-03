interface Env {
  GITHUB_APP_ID: string;
  GITHUB_APP_SLUG: string;
  GITHUB_WEBHOOK_SECRET: string;
}

const MAX_BODY_BYTES = 1_048_576;
const WEBHOOK_PATH = '/webhooks/github';
const HEALTH_PATH = '/health';
const SUPPORTED_EVENTS = new Set([
  'check_run',
  'check_suite',
  'installation',
  'installation_repositories',
  'ping',
  'pull_request',
  'pull_request_review',
  'status',
  'workflow_run',
]);

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function hexToBytes(value: string): ArrayBuffer | null {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes.buffer;
}

async function verifyWebhookSignature(
  secret: string,
  signatureHeader: string | null,
  payload: ArrayBuffer,
): Promise<boolean> {
  if (!secret || !signatureHeader?.startsWith('sha256=')) return false;
  const signature = hexToBytes(signatureHeader.slice('sha256='.length));
  if (!signature) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify('HMAC', key, signature, payload);
}

async function readLimitedBody(
  request: Request,
  limit = MAX_BODY_BYTES,
): Promise<ArrayBuffer | null> {
  if (!request.body) return new ArrayBuffer(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value.byteLength) continue;

      total += value.byteLength;
      if (total > limit) {
        await reader.cancel('payload_too_large');
        return null;
      }

      const chunk = new Uint8Array(value.byteLength);
      chunk.set(value);
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

function webhookMetadata(
  request: Request,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const repository = payload.repository as
    | { full_name?: unknown }
    | undefined;
  const installation = payload.installation as { id?: unknown } | undefined;
  return {
    delivery: request.headers.get('x-github-delivery'),
    event: request.headers.get('x-github-event'),
    action: typeof payload.action === 'string' ? payload.action : null,
    repository:
      typeof repository?.full_name === 'string' ? repository.full_name : null,
    installationId:
      typeof installation?.id === 'number' ? installation.id : null,
  };
}

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ error: 'payload_too_large' }, 413);
  }

  const body = await readLimitedBody(request);
  if (!body) return json({ error: 'payload_too_large' }, 413);

  const valid = await verifyWebhookSignature(
    env.GITHUB_WEBHOOK_SECRET,
    request.headers.get('x-hub-signature-256'),
    body,
  );
  if (!valid) return json({ error: 'invalid_signature' }, 401);

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new TextDecoder().decode(body)) as Record<
      string,
      unknown
    >;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const metadata = webhookMetadata(request, payload);
  const event = metadata.event;
  const supported = typeof event === 'string' && SUPPORTED_EVENTS.has(event);
  console.log(JSON.stringify({ ...metadata, supported }));

  return json(
    {
      accepted: true,
      supported,
      delivery: metadata.delivery,
      event,
    },
    202,
  );
}

function health(env: Env, method: string): Response {
  const ready = Boolean(env.GITHUB_WEBHOOK_SECRET);
  const response = json(
    {
      ok: ready,
      service: 'kanarek-companion',
      appId: env.GITHUB_APP_ID,
      appSlug: env.GITHUB_APP_SLUG,
      webhookConfigured: ready,
    },
    ready ? 200 : 503,
  );
  if (method === 'HEAD') {
    return new Response(null, {
      status: response.status,
      headers: response.headers,
    });
  }
  return response;
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === HEALTH_PATH) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ error: 'method_not_allowed' }, 405);
      }
      return health(env, request.method);
    }

    if (url.pathname === WEBHOOK_PATH) {
      if (request.method !== 'POST') {
        return json({ error: 'method_not_allowed' }, 405);
      }
      return handleWebhook(request, env);
    }

    return json({ error: 'not_found' }, 404);
  },
};

export default worker;
export { readLimitedBody, verifyWebhookSignature };
