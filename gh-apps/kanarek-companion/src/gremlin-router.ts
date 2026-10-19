import type { CompanionEnv } from './companion-types.ts';
import { actionFetch } from './action-context.ts';
import { addAutopilotOpenApi, handleAutopilotAction } from './autopilot-actions.ts';
import {
  addAutopilotCheckpointOpenApi,
  handleResumableAutopilotAction,
  OperatorCheckpointStore,
} from './autopilot-checkpoint.ts';
import { addBatchOpenApi, handleBatchAction } from './batch-actions.ts';
import { addChangeOpenApi, handleChangeAction } from './change-actions.ts';
import { addCloudflareOpenApi, handleCloudflareAction } from './cloudflare-actions.ts';
import { GithubActionError, githubGateway } from './github-gateway.ts';
import { handleGptActions, openApiDocument } from './gpt-actions.ts';
import { json } from './json-response.ts';
import { firstMatch, type Route } from './route.ts';
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
import { handleMergeReleasePolicyAction } from './policy-merge-release.ts';
import { handlePolicyEnforcementAction } from './policy-enforcement.ts';
import { addPolicyOpenApi, handlePolicyAction } from './policy-actions.ts';
import {
  addReleaseOrchestrationOpenApi,
  handleReleaseOrchestrationAction,
  RELEASE_ORCHESTRATION_PATH,
} from './release-orchestration.ts';
import { addReleaseOpenApi, handleReleaseAction } from './release-actions.ts';
import {
  addEnhancedWorkflowDiagnosisOpenApi,
  handleEnhancedWorkflowDiagnosis,
} from './workflow-diagnosis-enhanced.ts';
import { addWorkflowOpenApi, handleWorkflowAction } from './workflow-actions.ts';
import { isObject, type JsonObject, repositoryInScope, isProtectedBranch } from './tools/common.ts';

export { OperatorCheckpointStore, actionFetch };

export type GremlinRouterEnv = CompanionEnv & {
  OPERATOR_CHECKPOINTS: DurableObjectNamespace;
};

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const OAUTH_AUTHORIZE_PATH = '/gpt-actions/oauth/authorize';
const BOT_ACTION_PATH = '/gpt-actions/github/bot';
const BRANCH_DELETE_PATH = '/gpt-actions/github/branches/delete';
const AUTOPILOT_ACTION_PATH = '/gpt-actions/operator/autopilot';
const SHA_RE = /^[0-9a-f]{40}$/i;

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
  addAutopilotOpenApi(source);
  addAutopilotCheckpointOpenApi(source);
  addBatchOpenApi(source);
  addChangeOpenApi(source);
  addCloudflareOpenApi(source);
  addInvestigationOpenApi(source);
  addIssueOpenApi(source);
  addLifecycleOpenApi(source);
  addMaintenanceOpenApi(source);
  addAccountMaintenanceOpenApi(source);
  addMaintenanceAutofixOpenApi(source);
  addOperatorOpenApi(source);
  addEnhancedWorkflowDiagnosisOpenApi(source);
  addPolicyOpenApi(source);
  addReleaseOpenApi(source);
  addReleaseOrchestrationOpenApi(source);
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

  const repoPrefix = '^/repos/[^/]+/[A-Za-z0-9_.-]+/'; // owner scope enforced by the bot gate
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

// Gateway failure -> the error envelope the /gpt-actions route would return.
function githubFailure(error: unknown): Response {
  if (error instanceof GithubActionError) return json(error.envelope(), error.status);
  throw error;
}

function branchDeleteInput(value: unknown): {
  repository: string;
  branch: string;
  expectedHeadSha: string;
} | null {
  if (!isObject(value)) return null;
  if (
    typeof value.repository !== 'string' ||
    !repositoryInScope(value.repository) ||
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

async function deleteBranchAction(request: Request, env: GremlinRouterEnv): Promise<Response> {
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

  const github = githubGateway(request, env, actionFetch);
  let repository: unknown;
  try {
    repository = await github.read(`/repos/${input.repository}`);
  } catch (error) {
    return githubFailure(error);
  }
  const defaultBranch = isObject(repository) ? repository.default_branch : undefined;
  if (typeof defaultBranch !== 'string') {
    return Response.json({ ok: false, error: 'invalid_repository_response' }, { status: 502 });
  }
  if (isProtectedBranch(input.branch, defaultBranch)) {
    return Response.json({ ok: false, error: 'protected_branch' }, { status: 403 });
  }

  const encodedBranch = encodeURIComponent(input.branch);
  let refRead: { data: unknown } | null;
  try {
    refRead = await github.readOptional(`/repos/${input.repository}/git/ref/heads/${encodedBranch}`);
  } catch (error) {
    return githubFailure(error);
  }
  if (refRead === null) {
    return Response.json({ ok: true, deleted: false }, { headers: { 'cache-control': 'no-store' } });
  }
  const ref = isObject(refRead.data) ? refRead.data : null;
  const currentHead = isObject(ref?.object) ? ref.object.sha : null;
  if (typeof currentHead !== 'string' || !SHA_RE.test(currentHead)) {
    return Response.json({ ok: false, error: 'invalid_branch_ref_response' }, { status: 502 });
  }
  if (currentHead.toLowerCase() !== input.expectedHeadSha) {
    return Response.json({ ok: false, error: 'branch_head_changed' }, { status: 409 });
  }

  try {
    await github.botEmpty('DELETE', `/repos/${input.repository}/git/refs/heads/${encodedBranch}`);
  } catch (error) {
    return githubFailure(error);
  }
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

type OperatorContext = { request: Request; env: GremlinRouterEnv };
type OperatorAction = (
  request: Request,
  env: GremlinRouterEnv,
  fetcher: typeof fetch,
) => Promise<Response | null>;

const action =
  (handle: OperatorAction): Route<OperatorContext> =>
  ({ request, env }) =>
    handle(request, env, actionFetch);

function pathIs(request: Request, ...paths: string[]): boolean {
  return paths.includes(new URL(request.url).pathname);
}

// Order matters: first match wins; the /gpt-actions catch-all goes last.
export const operatorRoutes: readonly Route<OperatorContext>[] = [
  ({ request }) => {
    if (!pathIs(request, '/gpt-actions/openapi.json')) return null;
    if (request.method !== 'GET') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }
    return Response.json(customGptOpenApi(new URL(request.url).origin), {
      headers: { 'cache-control': 'no-store' },
    });
  },
  ({ request }) => {
    if (!pathIs(request, OAUTH_AUTHORIZE_PATH)) return null;
    if (request.method !== 'GET') {
      return Response.json({ error: 'method_not_allowed' }, { status: 405 });
    }
    try {
      return Response.redirect(githubOAuthAuthorizationUrl(request.url), 302);
    } catch {
      return Response.json({ error: 'invalid_oauth_authorize_request' }, { status: 400 });
    }
  },
  // Autopilot and release orchestration require an authorized operator up front.
  async ({ request, env }) => {
    if (!pathIs(request, AUTOPILOT_ACTION_PATH, RELEASE_ORCHESTRATION_PATH)) return null;
    try {
      await githubGateway(request, env, actionFetch).read('/user');
      return null;
    } catch (error) {
      return githubFailure(error);
    }
  },
  action(handleBatchAction),
  action(handlePolicyAction),
  action(handleCloudflareAction),
  action(handleResumableAutopilotAction),
  action(handleAutopilotAction),
  action(handleReleaseOrchestrationAction),
  action(handleMergeReleasePolicyAction),
  action(handlePolicyEnforcementAction),
  action(handleEnhancedWorkflowDiagnosis),
  action(handleOperatorAction),
  action(handleLifecycleAction),
  action(handleReleaseAction),
  action(handleIssueAction),
  action(handleChangeAction),
  action(handleWorkflowAction),
  action(handleInvestigationAction),
  action(handleMaintenanceAutofixAction),
  action(handleAccountMaintenanceAction),
  action(handleMaintenanceAction),
  async ({ request, env }) => {
    if (!pathIs(request, BRANCH_DELETE_PATH)) return null;
    try {
      return await deleteBranchAction(request, env);
    } catch (error) {
      return actionException(error);
    }
  },
  async ({ request, env }) => {
    const { pathname } = new URL(request.url);
    if (pathname !== '/gpt-actions' && !pathname.startsWith('/gpt-actions/')) return null;
    try {
      const restricted = await restrictedBotWriteResponse(request);
      if (restricted) return restricted;
      return await handleGptActions(await normalizeGptActionsRequest(request), env, actionFetch);
    } catch (error) {
      return actionException(error);
    }
  },
];

const worker = {
  fetch(request: Request, env: GremlinRouterEnv): Promise<Response | null> {
    return firstMatch(operatorRoutes, { request, env });
  },
};

export default worker;
