type JsonObject = Record<string, unknown>;

const GRAPHQL_PATH = '/graphql';
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const THREAD_FIELD = 'reviewThreads(first: 100)';
const QUERY_HEAD = 'query($id: ID!)';

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function pageConnection(payload: unknown): JsonObject | null {
  if (!isObject(payload) || !isObject(payload.data) || !isObject(payload.data.node)) return null;
  const connection = payload.data.node.reviewThreads;
  return isObject(connection) ? connection : null;
}

function pageInfo(connection: JsonObject): { hasNextPage: boolean; endCursor: string | null } | null {
  if (!isObject(connection.pageInfo) || typeof connection.pageInfo.hasNextPage !== 'boolean') {
    return null;
  }
  const cursor = connection.pageInfo.endCursor;
  return {
    hasNextPage: connection.pageInfo.hasNextPage,
    endCursor: typeof cursor === 'string' ? cursor : null,
  };
}

function paginatedQuery(query: string): string | null {
  if (!query.includes(QUERY_HEAD) || !query.includes(THREAD_FIELD)) return null;
  return query
    .replace(QUERY_HEAD, 'query($id: ID!, $cursor: String)')
    .replace(
      `${THREAD_FIELD} {`,
      `${THREAD_FIELD.replace(')', ', after: $cursor)')} { pageInfo { hasNextPage endCursor }`,
    );
}

function requestForPage(source: Request, query: string, variables: JsonObject, cursor: string | null): Request {
  const headers = new Headers(source.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(source.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables: { ...variables, cursor } }),
  });
}

function responseFromPayload(source: Response, payload: unknown): Response {
  const headers = new Headers(source.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.delete('transfer-encoding');
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(payload), {
    status: source.status,
    statusText: source.statusText,
    headers,
  });
}

function failure(error: string): Response {
  return Response.json(
    { message: error },
    { status: 502, headers: { 'cache-control': 'no-store' } },
  );
}

export async function paginateReviewThreadsGraphql(
  request: Request,
  upstream: typeof fetch,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== 'POST' || url.pathname !== GRAPHQL_PATH) return null;

  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return null;
  }
  if (!isObject(body) || typeof body.query !== 'string') return null;
  const query = paginatedQuery(body.query);
  if (!query) return null;
  const variables = isObject(body.variables) ? body.variables : {};

  let cursor: string | null = null;
  let firstResponse: Response | null = null;
  let mergedPayload: JsonObject | null = null;
  let mergedConnection: JsonObject | null = null;
  let mergedNodes: unknown[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = await upstream(requestForPage(request, query, variables, cursor));
    if (!firstResponse) firstResponse = response.clone();
    if (!response.ok) return response;

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return failure('invalid_review_thread_graphql_response');
    }
    if (!isObject(payload) || Array.isArray(payload.errors)) {
      return failure('review_thread_graphql_failed');
    }
    const connection = pageConnection(payload);
    if (!connection || !Array.isArray(connection.nodes)) {
      return failure('invalid_review_thread_connection');
    }
    const info = pageInfo(connection);
    if (!info) return failure('invalid_review_thread_page_info');

    if (!mergedPayload) {
      mergedPayload = payload;
      mergedConnection = connection;
    }
    mergedNodes = mergedNodes.concat(connection.nodes);
    if (!mergedConnection) return failure('review_thread_pagination_failed');
    mergedConnection.nodes = mergedNodes;
    mergedConnection.pageInfo = {
      hasNextPage: info.hasNextPage,
      endCursor: info.endCursor,
    };

    if (!info.hasNextPage) {
      if (!firstResponse || !mergedPayload) return failure('review_thread_pagination_failed');
      return responseFromPayload(firstResponse, mergedPayload);
    }
    if (!info.endCursor) return failure('missing_review_thread_cursor');
    cursor = info.endCursor;
  }

  return failure(`review_thread_pagination_limit_${PAGE_SIZE * MAX_PAGES}`);
}
