import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ANCHOR_OPENAPI_PATH,
  ANCHOR_STORAGE_PATH,
  anchorStorageOpenApi,
  handleAnchorStorageAction,
  type AnchorStorageEnv,
} from '../src/anchor-storage.ts';

type JsonObject = Record<string, unknown>;

type ReplayReceipt = {
  inputHash: string;
  status: 'running' | 'complete' | 'uncertain';
};

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

const ROOT_ID = '01a07f52-1e05-7eeb-b9fe-53f7d75b3164';
const ENV = { GREMLIN_ANCHOR_FOLDER_ID: ROOT_ID } satisfies AnchorStorageEnv;

function request(body: JsonObject, token = 'anchor-token'): Request {
  return new Request(`https://kanarek.example${ANCHOR_STORAGE_PATH}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function mcpJson(body: JsonObject, status = 200): Response {
  return Response.json(body, { status, headers: { 'content-type': 'application/json' } });
}

function replayProtectedEnv(): AnchorStorageEnv {
  const receipts = new Map<string, ReplayReceipt>();
  let active: string | null = null;
  const stub = {
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const pathname = new URL(String(input)).pathname;
      const body = JSON.parse(String(init?.body ?? '{}')) as JsonObject;
      const operationId = String(body.operationId ?? '');
      const inputHash = String(body.inputHash ?? '');
      const receipt = receipts.get(operationId);

      if (pathname === '/claim') {
        if (receipt) {
          if (receipt.inputHash !== inputHash) {
            return Response.json({ state: 'input_mismatch' }, { status: 409 });
          }
          if (receipt.status === 'complete') {
            return Response.json({ ok: true, state: 'complete' });
          }
          return Response.json({ state: receipt.status }, { status: 409 });
        }
        if (active) return Response.json({ state: 'busy' }, { status: 409 });
        active = operationId;
        receipts.set(operationId, { inputHash, status: 'running' });
        return Response.json({ ok: true, state: 'claimed' });
      }

      if (!receipt || receipt.inputHash !== inputHash) {
        return Response.json({ error: 'anchor_mutation_not_claimed' }, { status: 409 });
      }
      if (pathname === '/complete') {
        receipt.status = 'complete';
        active = null;
        return Response.json({ ok: true });
      }
      if (pathname === '/uncertain') {
        receipt.status = 'uncertain';
        active = null;
        return Response.json({ ok: true });
      }
      if (pathname === '/release') {
        receipts.delete(operationId);
        active = null;
        return Response.json({ ok: true });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    },
  };
  return {
    GREMLIN_ANCHOR_FOLDER_ID: ROOT_ID,
    ANCHOR_MUTATION_REPLAYS: {
      idFromName() {
        return {} as DurableObjectId;
      },
      get() {
        return stub as unknown as DurableObjectStub;
      },
    } as unknown as DurableObjectNamespace,
  };
}

test('Gremlin Storage is a separate one-operation Anchor OAuth action', () => {
  const document = anchorStorageOpenApi('https://kanarek.example');
  assert.ok(isObject(document.paths));
  assert.ok(isObject(document.paths[ANCHOR_STORAGE_PATH]));
  const post = document.paths[ANCHOR_STORAGE_PATH].post;
  assert.ok(isObject(post));
  assert.equal(post.operationId, 'useGremlinStorage');
  assert.deepEqual(post.security, [{ anchorOAuthBearer: [] }]);
  assert.equal(ANCHOR_OPENAPI_PATH, '/gpt-actions/anchor/openapi.json');

  const requestBody = isObject(post.requestBody) ? post.requestBody : null;
  const content = requestBody && isObject(requestBody.content) ? requestBody.content : null;
  const jsonContent = content && isObject(content['application/json'])
    ? content['application/json']
    : null;
  const schema = jsonContent && isObject(jsonContent.schema) ? jsonContent.schema : null;
  const properties = schema && isObject(schema.properties) ? schema.properties : null;
  const operation = properties && isObject(properties.operation) ? properties.operation : null;
  const operationId = properties && isObject(properties.operationId) ? properties.operationId : null;
  assert.deepEqual(operation?.enum, ['status', 'list', 'read', 'write', 'move', 'mkdir']);
  assert.match(String(operationId?.description), /Required for write, move and mkdir/);
});

test('storage action requires Anchor bearer auth before contacting MCP', async () => {
  let calls = 0;
  const response = await handleAnchorStorageAction(
    new Request(`https://kanarek.example${ANCHOR_STORAGE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation: 'status' }),
    }),
    ENV,
    async () => {
      calls += 1;
      return mcpJson({});
    },
  );
  assert.ok(response);
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
});

test('status sends initialized even when Anchor does not create a session', async () => {
  const methods: string[] = [];
  const response = await handleAnchorStorageAction(
    request({ operation: 'status' }),
    ENV,
    async (_input, init) => {
      const payload = JSON.parse(String(init?.body ?? '{}')) as JsonObject;
      methods.push(String(payload.method));
      if (payload.method === 'initialize') {
        return mcpJson({
          jsonrpc: '2.0',
          id: 1,
          result: { protocolVersion: '2026-07-28', capabilities: {} },
        });
      }
      if (payload.method === 'notifications/initialized') {
        return new Response(null, { status: 202 });
      }
      return mcpJson({
        jsonrpc: '2.0',
        id: 2,
        result: { structuredContent: { listing: `- Gremlin Storage/ -- ${ROOT_ID}` } },
      });
    },
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.deepEqual(methods, ['initialize', 'notifications/initialized', 'tools/call']);
});

test('completed mutation retries reuse the receipt instead of writing twice', async () => {
  let writeCalls = 0;
  const env = replayProtectedEnv();
  const fetcher: typeof fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as JsonObject;
    if (payload.method === 'initialize') {
      return mcpJson({
        jsonrpc: '2.0',
        id: 1,
        result: { protocolVersion: '2026-07-28', capabilities: {} },
      });
    }
    if (payload.method === 'notifications/initialized') {
      return new Response(null, { status: 202 });
    }
    const params = isObject(payload.params) ? payload.params : {};
    if (params.name === 'write_file') writeCalls += 1;
    return mcpJson({
      jsonrpc: '2.0',
      id: 2,
      result: { structuredContent: { file_id: '01a07f52-1e05-7eeb-b9fe-53f7d75b9999' } },
    });
  };
  const body = {
    operation: 'write',
    operationId: 'op-write-0001',
    name: 'note.md',
    content: 'hello',
  };

  const first = await handleAnchorStorageAction(request(body), env, fetcher);
  const second = await handleAnchorStorageAction(request(body), env, fetcher);
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(writeCalls, 1);
  assert.equal(((await second.json()) as JsonObject).replayed, true);
});

test('operationId cannot be reused for a different mutation input', async () => {
  let writeCalls = 0;
  const env = replayProtectedEnv();
  const fetcher: typeof fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as JsonObject;
    if (payload.method === 'initialize') {
      return mcpJson({
        jsonrpc: '2.0',
        id: 1,
        result: { protocolVersion: '2026-07-28', capabilities: {} },
      });
    }
    if (payload.method === 'notifications/initialized') {
      return new Response(null, { status: 202 });
    }
    const params = isObject(payload.params) ? payload.params : {};
    if (params.name === 'write_file') writeCalls += 1;
    return mcpJson({ jsonrpc: '2.0', id: 2, result: { structuredContent: {} } });
  };

  const first = await handleAnchorStorageAction(
    request({
      operation: 'write',
      operationId: 'op-write-0002',
      name: 'note.md',
      content: 'first',
    }),
    env,
    fetcher,
  );
  const second = await handleAnchorStorageAction(
    request({
      operation: 'write',
      operationId: 'op-write-0002',
      name: 'note.md',
      content: 'different',
    }),
    env,
    fetcher,
  );
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.equal(writeCalls, 1);
});

test('ambiguous mutation failure becomes uncertain and is not redelivered', async () => {
  let writeCalls = 0;
  const env = replayProtectedEnv();
  const fetcher: typeof fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body ?? '{}')) as JsonObject;
    if (payload.method === 'initialize') {
      return mcpJson({
        jsonrpc: '2.0',
        id: 1,
        result: { protocolVersion: '2026-07-28', capabilities: {} },
      });
    }
    if (payload.method === 'notifications/initialized') {
      return new Response(null, { status: 202 });
    }
    const params = isObject(payload.params) ? payload.params : {};
    if (params.name === 'write_file') writeCalls += 1;
    return mcpJson({ error: 'lost_response' }, 502);
  };
  const body = {
    operation: 'write',
    operationId: 'op-write-0003',
    name: 'note.md',
    content: 'hello',
  };

  const first = await handleAnchorStorageAction(request(body), env, fetcher);
  const second = await handleAnchorStorageAction(request(body), env, fetcher);
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.status, 502);
  assert.equal(second.status, 409);
  assert.equal(writeCalls, 1);
  assert.equal(((await second.json()) as JsonObject).error, 'anchor_mutation_uncertain');
});

test('Anchor bridge and replay receipts contain no credential persistence path', async () => {
  const bridge = await readFile(new URL('../src/anchor-storage.ts', import.meta.url), 'utf8');
  const replay = await readFile(new URL('../src/anchor-replay.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(bridge, /state\.storage/);
  assert.doesNotMatch(bridge, /DurableObject/);
  assert.doesNotMatch(`${bridge}\n${replay}`, /oauth_tokens|refresh_token|client_secret/i);
  assert.doesNotMatch(replay, /authorization|bearer|access[_-]?token/i);
});
