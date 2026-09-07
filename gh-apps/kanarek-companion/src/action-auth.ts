import { isObject } from './tools/common.ts';

export type ActionInvoke = (request: Request) => Promise<Response>;

const AUTH_PATH = '/gpt-actions/github/read';
const EXPECTED_OPERATOR = 'trvny';

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function internalAuthRequest(source: Request): Request {
  const url = new URL(source.url);
  url.pathname = AUTH_PATH;
  url.search = '';
  const headers = new Headers(source.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path: '/user' }),
  });
}

export async function authorizeOperator(
  request: Request,
  invoke: ActionInvoke,
): Promise<Response | null> {
  const response = await invoke(internalAuthRequest(request));
  if (!response.ok) return response;

  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    return json({ ok: false, error: 'invalid_operator_identity' }, 502);
  }

  const data = isObject(payload) && isObject(payload.data) ? payload.data : null;
  if (!isObject(payload) || payload.ok !== true || data?.login !== EXPECTED_OPERATOR) {
    return json({ ok: false, error: 'operator_not_allowed' }, 403);
  }
  return null;
}
