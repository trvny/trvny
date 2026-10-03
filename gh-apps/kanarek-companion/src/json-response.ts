// Shared JSON response helper. One place for default response policy.
const DEFAULT_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
} as const;

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  const merged = new Headers(DEFAULT_HEADERS);
  new Headers(headers).forEach((value, name) => merged.set(name, value));
  return Response.json(body, { status, headers: merged });
}
