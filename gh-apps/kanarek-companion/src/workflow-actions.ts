import { handleGptActions, type GptActionsEnv } from './gpt-actions.ts';

const READ_PATH = '/gpt-actions/github/read';
const BOT_PATH = '/gpt-actions/github/bot';
const WORKFLOW_CONTROL_PATH = '/gpt-actions/github/workflows/control';
const SHA_RE = /^[0-9a-f]{40}$/i;

type JsonObject = Record<string, unknown>;
type WorkflowControl = 'rerun_failed' | 'rerun_all' | 'cancel';

class WorkflowActionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'WorkflowActionError';
    this.code = code;
    this.status = status;
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function repository(value: unknown): string {
  if (typeof value !== 'string' || !/^trvny\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new WorkflowActionError('repository_not_allowed', 403);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new WorkflowActionError(`invalid_${name}`);
  }
  return value;
}

function expectedSha(value: unknown): string {
  if (typeof value !== 'string' || !SHA_RE.test(value)) {
    throw new WorkflowActionError('invalid_expected_head_sha');
  }
  return value.toLowerCase();
}

function control(value: unknown): WorkflowControl {
  if (value !== 'rerun_failed' && value !== 'rerun_all' && value !== 'cancel') {
    throw new WorkflowActionError('invalid_workflow_action');
  }
  return value;
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new WorkflowActionError(`invalid_${name}`);
  return value;
}

function repoPath(value: string): string {
  return value.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function internalRequest(source: Request, pathname: string, body: JsonObject): Request {
  const url = new URL(source.url);
  url.pathname = pathname;
  url.search = '';
  const headers = new Headers(source.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function inputObject(request: Request): Promise<JsonObject> {
  const text = await request.clone().text();
  if (text.length > 64_000) throw new WorkflowActionError('payload_too_large', 413);
  let value: unknown;
  try {
    value = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new WorkflowActionError('invalid_json');
  }
  if (!isObject(value)) throw new WorkflowActionError('invalid_json_object');
  return value;
}

async function actionPayload(response: Response): Promise<JsonObject> {
  let value: unknown;
  try {
    value = await response.clone().json();
  } catch {
    throw new WorkflowActionError('invalid_action_response', 502);
  }
  if (!isObject(value)) throw new WorkflowActionError('invalid_action_response', 502);
  if (!response.ok) {
    throw new WorkflowActionError(
      typeof value.error === 'string' ? value.error : 'action_failed',
      response.status,
    );
  }
  return value;
}

async function readData(
  source: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  path: string,
): Promise<unknown> {
  const response = await handleGptActions(
    internalRequest(source, READ_PATH, { path }),
    env,
    fetcher,
  );
  return (await actionPayload(response)).data;
}

async function botEmpty(
  source: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  path: string,
  body?: JsonObject,
): Promise<void> {
  const response = await handleGptActions(
    internalRequest(source, BOT_PATH, {
      method: 'POST',
      path,
      ...(body ? { body } : {}),
      expect: 'empty',
    }),
    env,
    fetcher,
  );
  await actionPayload(response);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compactRun(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  return {
    id: numberValue(value.id),
    name: stringValue(value.name),
    status: stringValue(value.status),
    conclusion: stringValue(value.conclusion),
    event: stringValue(value.event),
    headBranch: stringValue(value.head_branch),
    headSha: stringValue(value.head_sha),
    runAttempt: numberValue(value.run_attempt),
    htmlUrl: stringValue(value.html_url),
    createdAt: stringValue(value.created_at),
    updatedAt: stringValue(value.updated_at),
  };
}

export function workflowControlAllowed(
  action: WorkflowControl,
  status: unknown,
  conclusion: unknown,
): boolean {
  if (action === 'cancel') return status === 'queued' || status === 'in_progress' || status === 'waiting' || status === 'pending' || status === 'requested';
  if (status !== 'completed') return false;
  if (action === 'rerun_all') return true;
  return typeof conclusion === 'string' && conclusion !== 'success';
}

function verifyRun(
  value: unknown,
  repositoryName: string,
  runId: number,
  headSha: string,
  runAttempt: number,
): JsonObject {
  if (!isObject(value) || value.id !== runId) {
    throw new WorkflowActionError('invalid_workflow_run_response', 502);
  }
  const runRepository = isObject(value.repository) ? value.repository.full_name : null;
  if (runRepository !== undefined && runRepository !== null && runRepository !== repositoryName) {
    throw new WorkflowActionError('workflow_run_repository_mismatch', 409);
  }
  if (typeof value.head_sha !== 'string' || value.head_sha.toLowerCase() !== headSha) {
    throw new WorkflowActionError('workflow_run_head_changed', 409);
  }
  if (value.run_attempt !== runAttempt) {
    throw new WorkflowActionError('workflow_run_attempt_changed', 409);
  }
  return value;
}

async function controlWorkflowRun(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await inputObject(request);
  const repositoryName = repository(input.repository);
  const runId = positiveInteger(input.runId, 'run_id');
  const headSha = expectedSha(input.expectedHeadSha);
  const runAttempt = positiveInteger(input.expectedRunAttempt, 'expected_run_attempt');
  const action = control(input.action);
  const enableDebugLogging = optionalBoolean(input.enableDebugLogging, 'enable_debug_logging');
  if (action === 'cancel' && enableDebugLogging !== undefined) {
    throw new WorkflowActionError('debug_logging_not_valid_for_cancel');
  }

  const repo = repoPath(repositoryName);
  const runRaw = verifyRun(
    await readData(request, env, fetcher, `/repos/${repo}/actions/runs/${runId}`),
    repositoryName,
    runId,
    headSha,
    runAttempt,
  );
  if (!workflowControlAllowed(action, runRaw.status, runRaw.conclusion)) {
    throw new WorkflowActionError('workflow_action_not_allowed_for_state', 409);
  }

  const suffix =
    action === 'cancel' ? 'cancel' : action === 'rerun_all' ? 'rerun' : 'rerun-failed-jobs';
  const body = action === 'cancel' ? undefined : { enable_debug_logging: enableDebugLogging ?? false };
  await botEmpty(
    request,
    env,
    fetcher,
    `/repos/${repo}/actions/runs/${runId}/${suffix}`,
    body,
  );

  const current = await readData(request, env, fetcher, `/repos/${repo}/actions/runs/${runId}`);
  return json({
    ok: true,
    accepted: true,
    action,
    previous: compactRun(runRaw),
    current: compactRun(current),
  });
}

function objectResponse(description: string): JsonObject {
  return {
    '200': {
      description,
      content: { 'application/json': { schema: { type: 'object', properties: {} } } },
    },
  };
}

export function addWorkflowOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[WORKFLOW_CONTROL_PATH] = {
    post: {
      operationId: 'controlWorkflowRun',
      summary: 'Safely retry or cancel a workflow run',
      description:
        'Retries or cancels one exact workflow run after verifying repository, head SHA, run attempt and current run state.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['repository', 'runId', 'expectedHeadSha', 'expectedRunAttempt', 'action'],
              properties: {
                repository: { type: 'string', example: 'trvny/feedseek' },
                runId: { type: 'integer', minimum: 1 },
                expectedHeadSha: { type: 'string' },
                expectedRunAttempt: { type: 'integer', minimum: 1 },
                action: { type: 'string', enum: ['rerun_failed', 'rerun_all', 'cancel'] },
                enableDebugLogging: { type: 'boolean' },
              },
            },
          },
        },
      },
      responses: objectResponse('Workflow control request accepted'),
    },
  };
}

export async function handleWorkflowAction(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== WORKFLOW_CONTROL_PATH) return null;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    return await controlWorkflowRun(request, env, fetcher);
  } catch (error) {
    if (error instanceof WorkflowActionError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    console.error(
      JSON.stringify({
        gptWorkflow: 'failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
    return json({ ok: false, error: 'workflow_internal_error' }, 500);
  }
}
