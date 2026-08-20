import baseWorker, { CommentProbeLock } from './index.ts';
import { actionFetch } from './action-context.ts';
import { addBatchOpenApi, handleBatchAction } from './batch-actions.ts';
import { addChangeOpenApi, handleChangeAction } from './change-actions.ts';
import { handleGptActions, openApiDocument } from './gpt-actions.ts';
import { isProtectedBranch } from './gptomek.ts';
import { addInvestigationOpenApi, handleInvestigationAction } from './investigation-actions.ts';
import { addIssueOpenApi, handleIssueAction } from './issue-actions.ts';
import { addLifecycleOpenApi, handleLifecycleAction } from './lifecycle-actions.ts';
import {
  addAccountMaintenanceOpenApi,
  handleAccountMaintenanceAction,
} from './maintenance-account.ts';
import {
  addMaintenanceAutofixOpenApi,
  handleMaintenanceAutofixAction,
} from './maintenance-autofix.ts';
import { addMaintenanceOpenApi, handleMaintenanceAction } from './maintenance-actions.ts';
import { addOperatorOpenApi, handleOperatorAction } from './operator-actions.ts';
import { handlePolicyEnforcementAction } from './policy-enforcement.ts';
import { addPolicyOpenApi, handlePolicyAction } from './policy-actions.ts';
import { addReleaseOpenApi, handleReleaseAction } from './release-actions.ts';
import { addWorkflowOpenApi, handleWorkflowAction } from './workflow-actions.ts';

export { CommentProbeLock, actionFetch };

type BaseEnv = Parameters<typeof baseWorker.fetch>[1];

type JsonObject = Record<string, unknown>;

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const OAUTH_AUTHORIZE_PATH = '/gpt-actions/oauth/authorize';
const BOT_ACTION_PATH = '/gpt-actions/github/bot';
const BRANCH_DELETE_PATH = '/gpt-actions/github/branches/delete';
const SHA_RE = /^[0-9a-f]{40}$/i;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeObjectSchemas(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeObjectSchemas);
  if (!isObject(value)) return value;

  const output: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = normalizeObjectSchemas(entry);
  }
  if (output.type === 'object' && !isObject(output.properties)) {
    output.properties = {};
  }
  return output;
}

function oauthSecurityScheme(components: JsonObject): JsonObject {
  if (!isObject(components.securitySchemes)) components.securitySchemes = {};
  const securitySchemes = components.securitySchemes as JsonObject;
  if (!isObject(securitySchemes.githubOAuth)) securitySchemes.githubOAuth = {};
  const githubOAuth = securitySchemes.githubOAuth as JsonObject;
  if (!isObject(githubOAuth.flows)) githubOAuth.flows = {};
  const flows = githubOAuth.flows as JsonObject;
  if (!isObject(flows.authorizationCode)) flows.authorizationCode = {};
  return flows.authorizationCode as JsonObject;
}

function addBranchDeleteOperation(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[BRANCH_DELETE_PATH] = {
    post: {
      operationId: 'deleteBranchAsGptomek',
      summary: 'Delete a non-protected branch as gptomek[bot]',
      description:
        'Requires the expected current head SHA. main, the repository default branch and gptomek/control are protected.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['repository', 'branch', 'expectedHeadSha'],
              properties: {
                repository: { type: 'string', example: 'trvny/feedseek' },
                branch: { type: 'string' },
                expectedHeadSha: { type: 'string' },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Branch deleted or already absent',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  ok: { type: 'boolean' },
                  deleted: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
  };

  const botPath = paths[BOT_ACTION_PATH];
  const botPost = isObject(botPath) && isObject(botPath.post) ? botPath.post : null;
  if (botPost) {
    botPost.description =
      'Use for allowlisted comments, reactions, labels and issue/PR updates. PR creation stays user-authored. File edits, raw branch refs, workflow mutations and release writes use guarded actions.';
  }
}

export function customGptOpenApi(origin: string): JsonObject {
  const source = openApiDocument(origin);
  addBranchDeleteOperation(source);
  addBatchOpenApi(source);
  addChangeOpenApi(source);
  addInvestigationOpenApi(source);
  addIssueOpenApi(source);
  addLifecycleOpenApi(source);
  addMaintenanceOpenApi(source);
  addAccountMaintenanceOpenApi(source);
  addMaintenanceAutofixOpenApi(source);
  addOperatorOpenApi(source);
  addPolicyOpenApi(source);
  addReleaseOpenApi(source);
  addWorkflowOpenApi(source);
  const document = normalizeObjectSchemas(source);
  if (!isObject(document)) throw new Error('invalid_openapi_document');

  if (!isObject(document.components)) document.components = {};
  const components = document.components as JsonObject;
  if (!isObject(components.schemas)) components.schemas = {};

  const authorizationCode = oauthSecurityScheme(components);
  authorizationCode.authorizationUrl = `${origin}${OAUTH_AUTHORIZE_PATH}`;
  authorizationCode.scopes = {
    github: 'Authenticate with the installed GitHub App',
  };
  return document;
}

export function githubOAuthAuthorizationUrl(requestUrl: string): string {
  const request = new URL(requestUrl);
  const clientId = request.searchParams.get('client_id');
  if (!clientId) throw new Error('missing_client_id');

  const target = new URL(GITHUB_AUTHORIZE_URL);
  target.searchParams.set('client_id', clientId);
  for (const key of ['redirect_uri', 'state', 'login', 'allow_signup', 'prompt']) {
    const value = request.searchParams.get(key);
    if (value) target.searchParams.set(key, value);
  }
  return target.toString();
}

export function restrictedBotWrite(methodValue: string, path: string): string | null {
  const method = methodValue.toUpperCase();
  let pathname: string;
  try {
    if (!path.startsWith('/') || path.startsWith('//')) return null;
    const target = new URL(path, 'https://api.github.com');
    if (target.origin !== 'https://api.github.com') return null;
    pathname = target.pathname;
  } catch {
    return null;
  }

  const repoPrefix = '^/repos/trvny/[A-Za-z0-9_.-]+/';
  if (
    (method === 'PUT' || method === 'DELETE') &&
    new RegExp(`${repoPrefix}contents(?:/|$)`).test(pathname)
  ) {
    return 'use_commit_files';
  }
  if (method === 'POST' && new RegExp(`${repoPrefix}git/refs/?$`).test(pathname)) {
    return 'use_create_branch';
  }
  if (
    (method === 'PATCH' || method === 'DELETE') &&
    new RegExp(`${repoPrefix}git/refs/heads/`).test(pathname)
  ) {
    return method === 'DELETE' ? 'use_delete_branch' : 'use_commit_files';
  }
  if (
    method === 'POST' &&
    new RegExp(`${repoPrefix}actions/runs(?:/|$)`).test(pathname)
  ) {
    return 'use_workflow_control';
  }
  if (
    method === 'POST' &&
    new RegExp(`${repoPrefix}actions/workflows/[^/]+/dispatches/?$`).test(pathname)
  ) {
    return 'use_workflow_dispatch';
  }
  if (
    (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') &&
    new RegExp(`${repoPrefix}releases(?:/|$)`).test(pathname)
  ) {
    return 'use_release_action';
  }
  return null;
}

async function restrictedBotWriteResponse(request: Request): Promise<Response | null> {
  if (new URL(request.url).pathname !== BOT_ACTION_PATH || request.method !== 'POST') return null;
  try {
    const value = await request.clone().json();
    if (!isObject(value) || typeof value.method !== 'string' || typeof value.path !== 'string') {
      return null;
    }
    const restriction = restrictedBotWrite(value.method, value.path);
    if (!restriction) return null;
    return Response.json(
      { ok: false, error: restriction },
      { status: 403, headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return null;
  }
}

export async function normalizeGptActionsRequest(request: Request): Promise<Request> {
  const url = new URL(request.url);
  if (url.pathname !== BOT_ACTION_PATH || request.method !== 'POST') return request;

  let input: JsonObject;
  try {
    const value = await request.clone().json();
    if (!isObject(value)) return request;
    input = value;
  } catch {
    return request;
  }

  const path = typeof input.path === 'string' ? input.path : '';
  if (input.method !== 'POST' || !path.endsWith('/reactions') || input.expect === 'empty') {
    return request;
  }

  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify({ ...input, expect: 'empty' }),
  });
}

function internalActionRequest(source: Request, pathname: string, body: JsonObject): Request {
  const url = new URL(source.url);
  url.pathname = pathname;
  url.search = '';
  const headers = new Headers(source.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function responseData(response: Response): Promise<JsonObject | null> {
  try {
    const payload = await response.clone().json();
    if (!isObject(payload) || !isObject(payload.data)) return null;
    return payload.data;
  } catch {
    return null;
  }
}

function branchDeleteInput(value: unknown): {
  repository: string;
  branch: string;
  expectedHeadSha: string;
} | null {
  if (!isObject(value)) return null;
  if (
    typeof value.repository !== 'string' ||
    !/^trvny\/[A-Za-z0-9_.-]+$/.test(value.repository) ||
    typeof value.branch !== 'string' ||
    !value.branch ||
    value.branch.startsWith('/') ||
    value.branch.endsWith('/') ||
    value.branch.includes('..') ||
    value.branch.includes('//') ||
    !/^[A-Za-z0-9._/-]+$/.test(value.branch) ||
    typeof value.expectedHeadSha !== 'string' ||
    !SHA_RE.test(value.expectedHeadSha)
  ) {
    return null;
  }
  return {
    repository: value.repository,
    branch: value.branch,
    expectedHeadSha: value.expectedHeadSha.toLowerCase(),
  };
}

async function deleteBranchAction(request: Request, env: BaseEnv): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  }

  let input: ReturnType<typeof branchDeleteInput>;
  try {
    input = branchDeleteInput(await request.clone().json());
  } catch {
    input = null;
  }
  if (!input) {
    return Response.json({ ok: false, error: 'invalid_branch_delete_request' }, { status: 400 });
  }

  const repositoryRead = await handleGptActions(
    internalActionRequest(request, '/gpt-actions/github/read', {
      path: `/repos/${input.repository}`,
    }),
    env,
    actionFetch,
  );
  if (!repositoryRead.ok) return repositoryRead;
  const repository = await responseData(repositoryRead);
  const defaultBranch = repository?.default_branch;
  if (typeof defaultBranch !== 'string') {
    return Response.json({ ok: false, error: 'invalid_repository_response' }, { status: 502 });
  }
  if (isProtectedBranch(input.branch, defaultBranch)) {
    return Response.json({ ok: false, error: 'protected_branch' }, { status: 403 });
  }

  const encodedBranch = encodeURIComponent(input.branch);
  const refRead = await handleGptActions(
    internalActionRequest(request, '/gpt-actions/github/read', {
      path: `/repos/${input.repository}/git/ref/heads/${encodedBranch}`,
    }),
    env,
    actionFetch,
  );
  if (refRead.status === 404) {
    return Response.json({ ok: true, deleted: false }, { headers: { 'cache-control': 'no-store' } });
  }
  if (!refRead.ok) return refRead;
  const ref = await responseData(refRead);
  const currentHead = isObject(ref?.object) ? ref.object.sha : null;
  if (typeof currentHead !== 'string' || !SHA_RE.test(currentHead)) {
    return Response.json({ ok: false, error: 'invalid_branch_ref_response' }, { status: 502 });
  }
  if (currentHead.toLowerCase() !== input.expectedHeadSha) {
    return Response.json({ ok: false, error: 'branch_head_changed' }, { status: 409 });
  }

  const deleted = await handleGptActions(
    internalActionRequest(request, BOT_ACTION_PATH, {
      method: 'DELETE',
      path: `/repos/${input.repository}/git/refs/heads/${encodedBranch}`,
      expect: 'empty',
    }),
    env,
    actionFetch,
  );
  if (!deleted.ok) return deleted;
  return Response.json({ ok: true, deleted: true }, { headers: { 'cache-control': 'no-store' } });
}

function actionException(error: unknown): Response {
  const requestId = crypto.randomUUID();
  const detail =
    error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 500) : 'unknown_error';
  console.error(JSON.stringify({ gptActions: 'uncaught', requestId, detail }));
  return Response.json(
    { ok: false, error: 'worker_exception', requestId, detail },
    {
      status: 500,
      headers: { 'cache-control': 'no-store' },
    },
  );
}

const worker = {
  async fetch(
    request: Request,
    env: BaseEnv,
    ctx?: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/gpt-actions/openapi.json') {
      if (request.method !== 'GET') {
        return Response.json({ error: 'method_not_allowed' }, { status: 405 });
      }
      return Response.json(customGptOpenApi(url.origin), {
        headers: { 'cache-control': 'no-store' },
      });
    }
    if (url.pathname === OAUTH_AUTHORIZE_PATH) {
      if (request.method !== 'GET') {
        return Response.json({ error: 'method_not_allowed' }, { status: 405 });
      }
      try {
        return Response.redirect(githubOAuthAuthorizationUrl(request.url), 302);
      } catch {
        return Response.json({ error: 'invalid_oauth_authorize_request' }, { status: 400 });
      }
    }

    const batchResponse = await handleBatchAction(request, env, actionFetch);
    if (batchResponse) return batchResponse;

    const policyResponse = await handlePolicyAction(request, env, actionFetch);
    if (policyResponse) return policyResponse;

    const policyEnforcementResponse = await handlePolicyEnforcementAction(
      request,
      env,
      actionFetch,
    );
    if (policyEnforcementResponse) return policyEnforcementResponse;

    const operatorResponse = await handleOperatorAction(request, env, actionFetch);
    if (operatorResponse) return operatorResponse;

    const lifecycleResponse = await handleLifecycleAction(request, env, actionFetch);
    if (lifecycleResponse) return lifecycleResponse;

    const releaseResponse = await handleReleaseAction(request, env, actionFetch);
    if (releaseResponse) return releaseResponse;

    const issueResponse = await handleIssueAction(request, env, actionFetch);
    if (issueResponse) return issueResponse;

    const changeResponse = await handleChangeAction(request, env, actionFetch);
    if (changeResponse) return changeResponse;

    const workflowResponse = await handleWorkflowAction(request, env, actionFetch);
    if (workflowResponse) return workflowResponse;

    const investigationResponse = await handleInvestigationAction(request, env, actionFetch);
    if (investigationResponse) return investigationResponse;

    const maintenanceAutofixResponse = await handleMaintenanceAutofixAction(
      request,
      env,
      actionFetch,
    );
    if (maintenanceAutofixResponse) return maintenanceAutofixResponse;

    const accountMaintenanceResponse = await handleAccountMaintenanceAction(
      request,
      env,
      actionFetch,
    );
    if (accountMaintenanceResponse) return accountMaintenanceResponse;

    const maintenanceResponse = await handleMaintenanceAction(request, env, actionFetch);
    if (maintenanceResponse) return maintenanceResponse;

    if (url.pathname === BRANCH_DELETE_PATH) {
      try {
        return await deleteBranchAction(request, env);
      } catch (error) {
        return actionException(error);
      }
    }
    if (url.pathname === '/gpt-actions' || url.pathname.startsWith('/gpt-actions/')) {
      try {
        const restricted = await restrictedBotWriteResponse(request);
        if (restricted) return restricted;
        return await handleGptActions(
          await normalizeGptActionsRequest(request),
          env,
          actionFetch,
        );
      } catch (error) {
        return actionException(error);
      }
    }
    return baseWorker.fetch(request, env, ctx);
  },
};

export default worker;