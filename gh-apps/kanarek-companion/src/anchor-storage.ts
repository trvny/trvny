import {
  AnchorReplayError,
  anchorMutationInputHash,
  claimAnchorMutation,
  completeAnchorMutation,
  markAnchorMutationUncertain,
  releaseAnchorMutation,
  type AnchorMutationReplayEnv,
} from './anchor-replay.ts';
import {
  SpecialistToolError,
  boundedJson,
  boundedText,
  integerValue,
  isObject,
  optionalStringValue,
  stringValue,
  type JsonObject,
} from './tools/common.ts';

export const ANCHOR_STORAGE_PATH = '/gpt-actions/anchor/storage';
export const ANCHOR_OPENAPI_PATH = '/gpt-actions/anchor/openapi.json';

const ANCHOR_MCP_URL = 'https://mcp.anchor.cc/mcp';
const REQUEST_TIMEOUT_MS = 10_000;
const CONTAINMENT_TIMEOUT_MS = 30_000;
const MAX_REQUEST_BYTES = 220_000;
const MAX_CONTENT_BYTES = 200_000;
const MAX_MCP_RESPONSE_BYTES = 1_000_000;
const MAX_PARENT_DEPTH = 64;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MCP_PROTOCOLS = ['2026-07-28', '2025-11-25', '2025-06-18'] as const;

type StorageOperation = 'status' | 'list' | 'read' | 'write' | 'move' | 'mkdir';
type MutationOperation = 'write' | 'move' | 'mkdir';

export interface AnchorStorageEnv extends AnchorMutationReplayEnv {
  GREMLIN_ANCHOR_FOLDER_ID?: string;
}

interface McpSession {
  protocolVersion: string;
  sessionId?: string;
}

interface GuardedMutationResult {
  replayed: boolean;
  result?: JsonObject;
}

class AnchorStorageError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'AnchorStorageError';
    this.code = code;
    this.status = status;
  }
}

class AnchorMutationAttemptError extends Error {
  readonly original: unknown;

  constructor(original: unknown) {
    super('anchor_mutation_attempt_failed');
    this.name = 'AnchorMutationAttemptError';
    this.original = original;
  }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function configuredRoot(env: AnchorStorageEnv): string {
  const value = env.GREMLIN_ANCHOR_FOLDER_ID?.trim();
  if (!value || !UUID_RE.test(value)) {
    throw new AnchorStorageError('anchor_storage_not_configured', 503);
  }
  return value;
}

function bearerToken(request: Request): string {
  const value = request.headers.get('authorization')?.trim() ?? '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new AnchorStorageError('anchor_oauth_required', 401);
  return match[1];
}

async function requestObject(request: Request): Promise<JsonObject> {
  const text = await request.clone().text();
  if (byteLength(text) > MAX_REQUEST_BYTES) {
    throw new AnchorStorageError('payload_too_large', 413);
  }
  try {
    const value: unknown = text.trim() ? JSON.parse(text) : {};
    if (isObject(value)) return value;
  } catch {
    // handled below
  }
  throw new AnchorStorageError('invalid_json_object');
}

function uuid(value: unknown, name: string): string {
  const parsed = stringValue(value, name, 64);
  if (!UUID_RE.test(parsed)) throw new AnchorStorageError(`invalid_${name}`);
  return parsed;
}

function optionalUuid(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return uuid(value, name);
}

function safeName(value: unknown, name = 'name'): string {
  const parsed = stringValue(value, name, 180);
  if (parsed.includes('/') || parsed.includes('\\') || parsed === '.' || parsed === '..') {
    throw new AnchorStorageError(`invalid_${name}`);
  }
  return parsed;
}

function mutationOperationId(value: unknown): string {
  return stringValue(value, 'operation_id', 96);
}

function storageOperation(value: unknown): StorageOperation {
  if (
    value === 'status' ||
    value === 'list' ||
    value === 'read' ||
    value === 'write' ||
    value === 'move' ||
    value === 'mkdir'
  ) {
    return value;
  }
  throw new AnchorStorageError('invalid_storage_operation');
}

function ssePayload(text: string, expectedId: string | number): JsonObject | null {
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    try {
      const value: unknown = JSON.parse(line.slice(5).trim());
      if (isObject(value) && value.id === expectedId) return value;
    } catch {
      // ignore unrelated or malformed events
    }
  }
  return null;
}

async function mcpPost(
  accessToken: string,
  body: JsonObject,
  protocolVersion?: string,
  sessionId?: string,
  fetcher: typeof fetch = fetch,
): Promise<{ payload: JsonObject | null; sessionId?: string; status: number }> {
  try {
    const headers = new Headers({
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    });
    if (protocolVersion) headers.set('mcp-protocol-version', protocolVersion);
    if (sessionId) headers.set('mcp-session-id', sessionId);

    const response = await fetcher(ANCHOR_MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const nextSession = response.headers.get('mcp-session-id') ?? sessionId ?? undefined;

    if (response.status === 202 || response.status === 204) {
      if (response.body) await response.body.cancel().catch(() => undefined);
      return { payload: null, sessionId: nextSession, status: response.status };
    }
    if (!response.ok) {
      if (response.body) await response.body.cancel().catch(() => undefined);
      throw new AnchorStorageError(
        response.status === 401 ? 'anchor_oauth_required' : 'anchor_mcp_unavailable',
        response.status === 401 ? 401 : 502,
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
      const text = await boundedText(
        response,
        MAX_MCP_RESPONSE_BYTES,
        'anchor_mcp_response_too_large',
      );
      const payload = body.id === undefined
        ? null
        : ssePayload(text, body.id as string | number);
      if (body.id !== undefined && !payload) {
        throw new AnchorStorageError('anchor_mcp_response_invalid', 502);
      }
      return { payload, sessionId: nextSession, status: response.status };
    }

    const value = await boundedJson(
      response,
      MAX_MCP_RESPONSE_BYTES,
      'anchor_mcp_response_invalid',
      'anchor_mcp_response_too_large',
    );
    return {
      payload: isObject(value) ? value : null,
      sessionId: nextSession,
      status: response.status,
    };
  } catch (error) {
    if (error instanceof AnchorStorageError || error instanceof SpecialistToolError) throw error;
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new AnchorStorageError('anchor_mcp_timeout', 504);
    }
    throw new AnchorStorageError('anchor_mcp_unreachable', 503);
  }
}

function mcpToolResult(payload: JsonObject | null): JsonObject {
  if (!payload || isObject(payload.error)) {
    throw new AnchorStorageError('anchor_mcp_tool_failed', 502);
  }
  const result = isObject(payload.result) ? payload.result : null;
  if (!result || result.isError === true) {
    throw new AnchorStorageError('anchor_mcp_tool_failed', 502);
  }
  if (isObject(result.structuredContent)) return result.structuredContent;

  const content = Array.isArray(result.content) ? result.content : [];
  for (const entry of content) {
    if (!isObject(entry) || entry.type !== 'text' || typeof entry.text !== 'string') continue;
    try {
      const parsed: unknown = JSON.parse(entry.text);
      if (isObject(parsed)) return parsed;
    } catch {
      return { text: entry.text };
    }
  }
  return {};
}

async function negotiateMcp(
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<McpSession> {
  let lastError: unknown;
  for (const requestedVersion of MCP_PROTOCOLS) {
    try {
      const initialized = await mcpPost(
        accessToken,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: requestedVersion,
            capabilities: {},
            clientInfo: { name: 'gremlin-storage', version: '1.0.0' },
          },
        },
        undefined,
        undefined,
        fetcher,
      );
      const result = initialized.payload && isObject(initialized.payload.result)
        ? initialized.payload.result
        : null;
      if (!result || typeof result.protocolVersion !== 'string') {
        throw new AnchorStorageError('anchor_mcp_initialize_failed', 502);
      }
      return {
        protocolVersion: result.protocolVersion,
        ...(initialized.sessionId ? { sessionId: initialized.sessionId } : {}),
      };
    } catch (error) {
      if (error instanceof AnchorStorageError && error.code === 'anchor_oauth_required') {
        throw error;
      }
      lastError = error;
    }
  }
  if (lastError instanceof AnchorStorageError) throw lastError;
  throw new AnchorStorageError('anchor_mcp_initialize_failed', 502);
}

async function prepareMcpSession(
  accessToken: string,
  fetcher: typeof fetch,
): Promise<McpSession> {
  const session = await negotiateMcp(accessToken, fetcher);
  await mcpPost(
    accessToken,
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    session.protocolVersion,
    session.sessionId,
    fetcher,
  );
  return session;
}

async function callAnchorTool(
  accessToken: string,
  name: 'ls' | 'read_file' | 'write_file' | 'mkdir' | 'mv',
  args: JsonObject,
  fetcher: typeof fetch = fetch,
): Promise<JsonObject> {
  const session = await prepareMcpSession(accessToken, fetcher);
  const called = await mcpPost(
    accessToken,
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name, arguments: args },
    },
    session.protocolVersion,
    session.sessionId,
    fetcher,
  );
  return mcpToolResult(called.payload);
}

async function callAnchorMutationTool(
  accessToken: string,
  name: 'write_file' | 'mkdir' | 'mv',
  args: JsonObject,
  fetcher: typeof fetch,
): Promise<JsonObject> {
  const session = await prepareMcpSession(accessToken, fetcher);
  try {
    const called = await mcpPost(
      accessToken,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name, arguments: args },
      },
      session.protocolVersion,
      session.sessionId,
      fetcher,
    );
    return mcpToolResult(called.payload);
  } catch (error) {
    if (error instanceof AnchorStorageError && error.code === 'anchor_oauth_required') {
      throw error;
    }
    throw new AnchorMutationAttemptError(error);
  }
}

async function guardedMutation(
  env: AnchorStorageEnv,
  operationId: string,
  input: JsonObject,
  execute: () => Promise<JsonObject>,
): Promise<GuardedMutationResult> {
  const inputHash = await anchorMutationInputHash(input);
  const claim = await claimAnchorMutation(env, operationId, inputHash);
  if (claim.state === 'complete') return { replayed: true };

  let result: JsonObject;
  try {
    result = await execute();
  } catch (error) {
    if (error instanceof AnchorMutationAttemptError) {
      await markAnchorMutationUncertain(env, operationId, inputHash).catch(() => undefined);
      throw error.original;
    }
    await releaseAnchorMutation(env, operationId, inputHash).catch(() => undefined);
    throw error;
  }

  try {
    await completeAnchorMutation(env, operationId, inputHash);
  } catch (error) {
    await markAnchorMutationUncertain(env, operationId, inputHash).catch(() => undefined);
    throw error;
  }
  return { replayed: false, result };
}

function listing(result: JsonObject): string {
  if (typeof result.listing === 'string') return result.listing;
  if (typeof result.text === 'string') {
    try {
      const parsed: unknown = JSON.parse(result.text);
      if (isObject(parsed) && typeof parsed.listing === 'string') return parsed.listing;
    } catch {
      return result.text;
    }
    return result.text;
  }
  throw new AnchorStorageError('anchor_listing_invalid', 502);
}

function parentFolderId(value: string): string | null {
  const match = value.match(/^\s*parent_folder_id:\s*([0-9a-f-]+|null)\s*$/im);
  if (!match || match[1] === 'null') return null;
  return UUID_RE.test(match[1]) ? match[1] : null;
}

async function folderInsideRoot(
  accessToken: string,
  folderId: string,
  rootId: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (folderId === rootId) return true;
  const deadline = Date.now() + CONTAINMENT_TIMEOUT_MS;
  let current = folderId;
  for (let depth = 0; depth < MAX_PARENT_DEPTH; depth += 1) {
    if (Date.now() >= deadline) {
      throw new AnchorStorageError('anchor_containment_timeout', 504);
    }
    const result = await callAnchorTool(
      accessToken,
      'ls',
      {
        target: { by: 'folder', folder_id: current },
        number_of_items: 1,
        show_folder_details: true,
        hide_files: true,
      },
      fetcher,
    );
    if (Date.now() >= deadline) {
      throw new AnchorStorageError('anchor_containment_timeout', 504);
    }
    const parent = parentFolderId(listing(result));
    if (!parent || parent === current) return false;
    if (parent === rootId) return true;
    current = parent;
  }
  return false;
}

async function assertFolderInsideRoot(
  accessToken: string,
  folderId: string,
  rootId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!(await folderInsideRoot(accessToken, folderId, rootId, fetcher))) {
    throw new AnchorStorageError('anchor_item_outside_gremlin_storage', 403);
  }
}

async function assertFileInsideRoot(
  accessToken: string,
  fileId: string,
  rootId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const result = await callAnchorTool(
    accessToken,
    'ls',
    { target: { by: 'file', file_id: fileId }, show_file_details: true },
    fetcher,
  );
  const parent = parentFolderId(listing(result));
  if (!parent || !(await folderInsideRoot(accessToken, parent, rootId, fetcher))) {
    throw new AnchorStorageError('anchor_item_outside_gremlin_storage', 403);
  }
}

function operationSchema(): JsonObject {
  return {
    type: 'object',
    required: ['operation'],
    properties: {
      operation: {
        type: 'string',
        enum: ['status', 'list', 'read', 'write', 'move', 'mkdir'],
      },
      operationId: {
        type: 'string',
        description:
          'Required for write, move and mkdir. Reuse the same stable op-* ID when retrying the same mutation.',
      },
      folderId: { type: 'string', description: 'Target folder inside Gremlin Storage.' },
      fileId: { type: 'string', description: 'Target file inside Gremlin Storage.' },
      name: { type: 'string', description: 'New file or folder name.' },
      content: { type: 'string', description: 'Full text content for create/rewrite.' },
      newName: { type: 'string', description: 'Optional new file name for move/rename.' },
      destinationFolderId: {
        type: 'string',
        description: 'Destination inside Gremlin Storage.',
      },
      startLine: { type: 'integer', minimum: 1 },
      maxLines: { type: 'integer', minimum: 1, maximum: 2000 },
      limit: { type: 'integer', minimum: 1, maximum: 200 },
    },
  };
}

export function anchorStorageOpenApi(origin: string): JsonObject {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Gremlin Storage',
      version: '1.0.0',
      description:
        'Anchor-backed workspace for Gremlin. Configure this Action with Anchor OAuth; the gateway never stores OAuth credentials.',
    },
    servers: [{ url: origin }],
    paths: {
      [ANCHOR_STORAGE_PATH]: {
        post: {
          operationId: 'useGremlinStorage',
          summary: 'Use Gremlin private Anchor workspace',
          description:
            'Lists, reads, writes, moves and creates folders only inside the configured Gremlin Storage root. Mutations require replay-safe operationId values. No delete operation is exposed.',
          security: [{ anchorOAuthBearer: [] }],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: operationSchema() } },
          },
          responses: {
            '200': {
              description: 'Gremlin Storage result',
              content: {
                'application/json': {
                  schema: { type: 'object', properties: {} },
                },
              },
            },
            '401': { description: 'Anchor OAuth token missing or rejected' },
            '403': { description: 'Requested item is outside Gremlin Storage' },
            '409': { description: 'Mutation replay guard blocked a duplicate or uncertain operation' },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        anchorOAuthBearer: { type: 'http', scheme: 'bearer' },
      },
    },
  };
}

function mutationResponse(
  operation: MutationOperation,
  operationId: string,
  guarded: GuardedMutationResult,
): Response {
  if (guarded.replayed) {
    return json({ ok: true, operation, operationId, replayed: true });
  }
  return json({
    ok: true,
    operation,
    operationId,
    replayed: false,
    result: guarded.result ?? {},
  });
}

async function operate(
  operation: StorageOperation,
  body: JsonObject,
  rootId: string,
  accessToken: string,
  env: AnchorStorageEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  if (operation === 'status') {
    const result = await callAnchorTool(
      accessToken,
      'ls',
      {
        target: { by: 'folder', folder_id: rootId },
        number_of_items: 1,
        show_folder_details: true,
      },
      fetcher,
    );
    return json({ ok: true, connected: true, rootFolderId: rootId, result });
  }

  if (operation === 'list') {
    const folderId = optionalUuid(body.folderId, 'folder_id') ?? rootId;
    await assertFolderInsideRoot(accessToken, folderId, rootId, fetcher);
    const limit = integerValue(body.limit, 'limit', 50, 1, 200);
    return json({
      ok: true,
      result: await callAnchorTool(
        accessToken,
        'ls',
        {
          target: { by: 'folder', folder_id: folderId },
          number_of_items: limit,
          show_folder_details: true,
          show_file_details: true,
        },
        fetcher,
      ),
    });
  }

  if (operation === 'read') {
    const fileId = uuid(body.fileId, 'file_id');
    await assertFileInsideRoot(accessToken, fileId, rootId, fetcher);
    const startLine = body.startLine === undefined
      ? null
      : integerValue(body.startLine, 'start_line', 1, 1, 1_000_000);
    const maxLines = body.maxLines === undefined
      ? null
      : integerValue(body.maxLines, 'max_lines', 2000, 1, 2000);
    return json({
      ok: true,
      result: await callAnchorTool(
        accessToken,
        'read_file',
        { file_id: fileId, start_line: startLine, max_lines: maxLines },
        fetcher,
      ),
    });
  }

  if (operation === 'write') {
    const operationId = mutationOperationId(body.operationId);
    if (typeof body.content !== 'string' || byteLength(body.content) > MAX_CONTENT_BYTES) {
      throw new AnchorStorageError('invalid_content');
    }
    const fileId = optionalUuid(body.fileId, 'file_id');
    const folderId = fileId ? undefined : optionalUuid(body.folderId, 'folder_id') ?? rootId;
    const name = fileId ? undefined : safeName(body.name);
    const input: JsonObject = {
      operation,
      ...(fileId ? { fileId } : { folderId, name }),
      content: body.content,
    };
    const guarded = await guardedMutation(env, operationId, input, async () => {
      let write: JsonObject;
      if (fileId) {
        await assertFileInsideRoot(accessToken, fileId, rootId, fetcher);
        write = {
          file_id: fileId,
          text_content: { newString: body.content as string, rewrite: true },
        };
      } else {
        await assertFolderInsideRoot(accessToken, folderId as string, rootId, fetcher);
        write = {
          folder_id: folderId,
          name,
          text_content: { newString: body.content as string },
        };
      }
      return callAnchorMutationTool(
        accessToken,
        'write_file',
        { writes: [write] },
        fetcher,
      );
    });
    return mutationResponse(operation, operationId, guarded);
  }

  if (operation === 'mkdir') {
    const operationId = mutationOperationId(body.operationId);
    const folderId = optionalUuid(body.folderId, 'folder_id') ?? rootId;
    const name = safeName(body.name);
    const guarded = await guardedMutation(
      env,
      operationId,
      { operation, folderId, name },
      async () => {
        await assertFolderInsideRoot(accessToken, folderId, rootId, fetcher);
        return callAnchorMutationTool(
          accessToken,
          'mkdir',
          { folder_id: folderId, name, temporary: false },
          fetcher,
        );
      },
    );
    return mutationResponse(operation, operationId, guarded);
  }

  const operationId = mutationOperationId(body.operationId);
  const fileId = uuid(body.fileId, 'file_id');
  const destinationFolderId = optionalUuid(
    body.destinationFolderId,
    'destination_folder_id',
  );
  const newNameRaw = optionalStringValue(body.newName, 'new_name', 180);
  const newName = newNameRaw ? safeName(newNameRaw, 'new_name') : undefined;
  if (!destinationFolderId && !newName) {
    throw new AnchorStorageError('invalid_move_request');
  }
  const input: JsonObject = {
    operation,
    fileId,
    ...(destinationFolderId ? { destinationFolderId } : {}),
    ...(newName ? { newName } : {}),
  };
  const guarded = await guardedMutation(env, operationId, input, async () => {
    await assertFileInsideRoot(accessToken, fileId, rootId, fetcher);
    if (destinationFolderId) {
      await assertFolderInsideRoot(accessToken, destinationFolderId, rootId, fetcher);
    }
    return callAnchorMutationTool(
      accessToken,
      'mv',
      {
        file_id: fileId,
        ...(destinationFolderId ? { destination_folder_id: destinationFolderId } : {}),
        ...(newName ? { new_name: newName } : {}),
      },
      fetcher,
    );
  });
  return mutationResponse(operation, operationId, guarded);
}

export async function handleAnchorStorageAction(
  request: Request,
  env: AnchorStorageEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== ANCHOR_STORAGE_PATH) return null;
  try {
    if (request.method !== 'POST') {
      return json({ ok: false, error: 'method_not_allowed' }, 405);
    }
    const rootId = configuredRoot(env);
    const accessToken = bearerToken(request);
    const body = await requestObject(request);
    return await operate(
      storageOperation(body.operation),
      body,
      rootId,
      accessToken,
      env,
      fetcher,
    );
  } catch (error) {
    if (error instanceof AnchorStorageError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    if (error instanceof AnchorReplayError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    if (error instanceof SpecialistToolError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    return json({ ok: false, error: 'anchor_storage_gateway_error' }, 500);
  }
}
