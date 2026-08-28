import {
  autopilotInputHash,
  checkpointCall,
  type AutopilotCheckpointEnv,
} from './autopilot-checkpoint.ts';
import type { GptActionsEnv } from './gpt-actions.ts';
import { loadGremlinPolicy, type GremlinPolicy } from './policy-actions.ts';

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';
const OVERVIEW_PATH = '/gpt-actions/cloudflare/overview';
const WORKER_INSPECT_PATH = '/gpt-actions/cloudflare/workers/inspect';
const PAGES_INSPECT_PATH = '/gpt-actions/cloudflare/pages/inspect';
const ZONE_INSPECT_PATH = '/gpt-actions/cloudflare/zones/inspect';
const WORKER_ROLLBACK_PATH = '/gpt-actions/cloudflare/workers/rollback';
const PAGES_ROLLBACK_PATH = '/gpt-actions/cloudflare/pages/rollback';
const WORKER_SUBDOMAIN_PATH = '/gpt-actions/cloudflare/workers/subdomain';
const ROUTE_UPDATE_PATH = '/gpt-actions/cloudflare/routes/update';
const DNS_UPDATE_PATH = '/gpt-actions/cloudflare/dns/update';
const ACCOUNT_ID_RE = /^[a-f0-9]{32}$/i;
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const RESOURCE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_CF_RESPONSE_BYTES = 2_000_000;

type JsonObject = Record<string, unknown>;
type MutationKey = keyof GremlinPolicy['runtime']['cloudflare']['mutations'];

interface CloudflareActionEnv extends GptActionsEnv {
  OPERATOR_CHECKPOINTS?: DurableObjectNamespace;
}

interface RollbackClaim {
  operationId: string;
  inputHash: string;
  recovered: boolean;
  replay?: Response;
}

class CloudflareActionError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: JsonObject;

  constructor(code: string, status = 400, details?: JsonObject) {
    super(code);
    this.name = 'CloudflareActionError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
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

async function inputObject(request: Request): Promise<JsonObject> {
  const text = await request.clone().text();
  if (text.length > 64_000) throw new CloudflareActionError('payload_too_large', 413);
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CloudflareActionError('invalid_json');
  }
  if (!isObject(parsed)) throw new CloudflareActionError('invalid_json_object');
  return parsed;
}

function exactInput(input: JsonObject, allowed: readonly string[]): void {
  const keys = new Set(allowed);
  for (const key of Object.keys(input)) {
    if (!keys.has(key)) throw new CloudflareActionError('invalid_cloudflare_request');
  }
}

function requiredString(value: unknown, name: string, max = 1_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new CloudflareActionError(`invalid_${name}`);
  }
  return value.trim();
}

function optionalString(value: unknown, name: string, max = 1_000): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > max) {
    throw new CloudflareActionError(`invalid_${name}`);
  }
  return value;
}

function requiredBoolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new CloudflareActionError(`invalid_${name}`);
  return value;
}

function optionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new CloudflareActionError(`invalid_${name}`);
  return value;
}

function optionalInteger(value: unknown, name: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new CloudflareActionError(`invalid_${name}`);
  }
  return value;
}

function resourceName(value: unknown, name: string): string {
  const result = requiredString(value, name, 128);
  if (!RESOURCE_RE.test(result)) throw new CloudflareActionError(`invalid_${name}`);
  return result;
}

function idValue(value: unknown, name: string, max = 64): string {
  const result = requiredString(value, name, max);
  if (!/^[A-Za-z0-9_-]+$/.test(result)) throw new CloudflareActionError(`invalid_${name}`);
  return result;
}

function uuid(value: unknown, name: string): string {
  const result = requiredString(value, name, 36);
  if (!UUID_RE.test(result)) throw new CloudflareActionError(`invalid_${name}`);
  return result.toLowerCase();
}

function credentials(env: GptActionsEnv): { accountId: string; token: string } {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? '';
  const token = env.CLOUDFLARE_API_TOKEN?.trim() ?? '';
  if (!accountId || !token) throw new CloudflareActionError('cloudflare_not_configured', 503);
  if (!ACCOUNT_ID_RE.test(accountId)) throw new CloudflareActionError('invalid_cloudflare_account_id', 503);
  return { accountId, token };
}

function encoded(value: string): string {
  return encodeURIComponent(value);
}

function cloudflareErrorCodes(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (isObject(entry) && typeof entry.code === 'number' ? entry.code : null))
    .filter((entry): entry is number => entry !== null)
    .slice(0, 8);
}

async function cloudflareRequest(
  env: GptActionsEnv,
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' = 'GET',
  body?: JsonObject,
  fetcher: typeof fetch = fetch,
): Promise<{ result: unknown; resultInfo: unknown }> {
  const { token } = credentials(env);
  const response = await fetcher(`${CLOUDFLARE_API}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (text.length > MAX_CF_RESPONSE_BYTES) throw new CloudflareActionError('cloudflare_response_too_large', 502);
  let payload: unknown = {};
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new CloudflareActionError('invalid_cloudflare_response', 502);
    }
  }
  if (!isObject(payload)) throw new CloudflareActionError('invalid_cloudflare_response', 502);
  if (!response.ok || payload.success !== true) {
    throw new CloudflareActionError('cloudflare_api_error', response.ok ? 502 : response.status, {
      codes: cloudflareErrorCodes(payload.errors),
    });
  }
  return { result: payload.result, resultInfo: payload.result_info };
}

async function cloudflarePolicy(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<GremlinPolicy['runtime']['cloudflare']> {
  const loaded = await loadGremlinPolicy(request, env, fetcher);
  if (!loaded.policy.runtime.cloudflare.enabled) {
    throw new CloudflareActionError('cloudflare_operator_disabled', 403);
  }
  return loaded.policy.runtime.cloudflare;
}

function requireMutation(policy: GremlinPolicy['runtime']['cloudflare'], key: MutationKey): void {
  if (!policy.mutations[key]) throw new CloudflareActionError(`cloudflare_${key}_disabled`, 403);
}

function stringField(value: unknown, key: string): string | null {
  return isObject(value) && typeof value[key] === 'string' ? value[key] as string : null;
}

function booleanField(value: unknown, key: string): boolean | null {
  return isObject(value) && typeof value[key] === 'boolean' ? value[key] as boolean : null;
}

function numberField(value: unknown, key: string): number | null {
  return isObject(value) && typeof value[key] === 'number' ? value[key] as number : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function safePrimitiveTree(value: unknown, depth = 0): unknown {
  if (depth > 4) return null;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length <= 1_000 ? value : value.slice(0, 1_000);
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => safePrimitiveTree(entry, depth + 1));
  if (!isObject(value)) return null;
  const output: JsonObject = {};
  for (const [key, entry] of Object.entries(value).slice(0, 100)) {
    if (/(secret|token|password|api[_-]?key|private[_-]?key|credential)/i.test(key)) continue;
    output[key] = safePrimitiveTree(entry, depth + 1);
  }
  return output;
}

function safeWorker(value: unknown): JsonObject {
  return {
    id: stringField(value, 'id'),
    createdOn: stringField(value, 'created_on'),
    modifiedOn: stringField(value, 'modified_on'),
    compatibilityDate: stringField(value, 'compatibility_date'),
    compatibilityFlags: isObject(value) ? stringArray(value.compatibility_flags) : [],
    usageModel: stringField(value, 'usage_model'),
    placementMode: isObject(value) && isObject(value.placement) ? stringField(value.placement, 'mode') : null,
  };
}

function safeWorkerDeployment(value: unknown): JsonObject {
  const annotations = isObject(value) && isObject(value.annotations) ? value.annotations : null;
  const versions = isObject(value) && Array.isArray(value.versions)
    ? value.versions.slice(0, 2).map((entry) => ({
        versionId: stringField(entry, 'version_id'),
        percentage: numberField(entry, 'percentage'),
      }))
    : [];
  return {
    id: stringField(value, 'id'),
    createdOn: stringField(value, 'created_on'),
    source: stringField(value, 'source'),
    strategy: stringField(value, 'strategy'),
    versions,
    message: annotations ? stringField(annotations, 'workers/message') : null,
    triggeredBy: annotations ? stringField(annotations, 'workers/triggered_by') : null,
  };
}

function safeWorkerVersion(value: unknown): JsonObject {
  const metadata = isObject(value) && isObject(value.metadata) ? value.metadata : null;
  return {
    id: stringField(value, 'id'),
    number: numberField(value, 'number'),
    createdOn: metadata ? stringField(metadata, 'created_on') : null,
    modifiedOn: metadata ? stringField(metadata, 'modified_on') : null,
    source: metadata ? stringField(metadata, 'source') : null,
    hasPreview: metadata ? booleanField(metadata, 'hasPreview') : null,
  };
}

function safeSubdomain(value: unknown): JsonObject {
  return {
    enabled: booleanField(value, 'enabled'),
    previewsEnabled: booleanField(value, 'previews_enabled'),
  };
}

function safeScriptSettings(value: unknown): JsonObject {
  return {
    logpush: booleanField(value, 'logpush'),
    observability: isObject(value) ? safePrimitiveTree(value.observability) : null,
    tags: isObject(value) ? stringArray(value.tags) : [],
    tailConsumers: isObject(value) && Array.isArray(value.tail_consumers)
      ? value.tail_consumers.slice(0, 50).map((entry) => safePrimitiveTree(entry))
      : [],
  };
}

function safePagesStage(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  return {
    name: stringField(value, 'name'),
    status: stringField(value, 'status'),
    startedOn: stringField(value, 'started_on'),
    endedOn: stringField(value, 'ended_on'),
  };
}

function safePagesDeployment(value: unknown): JsonObject {
  const trigger = isObject(value) && isObject(value.deployment_trigger) ? value.deployment_trigger : null;
  const metadata = trigger && isObject(trigger.metadata) ? trigger.metadata : null;
  return {
    id: stringField(value, 'id'),
    shortId: stringField(value, 'short_id'),
    environment: stringField(value, 'environment'),
    url: stringField(value, 'url'),
    aliases: isObject(value) ? stringArray(value.aliases) : [],
    createdOn: stringField(value, 'created_on'),
    modifiedOn: stringField(value, 'modified_on'),
    stage: isObject(value) ? safePagesStage(value.latest_stage) : null,
    branch: metadata ? stringField(metadata, 'branch') : null,
    commitHash: metadata ? stringField(metadata, 'commit_hash') : null,
    commitMessage: metadata ? stringField(metadata, 'commit_message') : null,
  };
}

function safePagesProject(value: unknown): JsonObject {
  const source = isObject(value) && isObject(value.source) ? value.source : null;
  const config = source && isObject(source.config) ? source.config : null;
  return {
    id: stringField(value, 'id'),
    name: stringField(value, 'name'),
    subdomain: stringField(value, 'subdomain'),
    productionBranch: stringField(value, 'production_branch'),
    createdOn: stringField(value, 'created_on'),
    source: source ? {
      type: stringField(source, 'type'),
      owner: config ? stringField(config, 'owner') : null,
      repoName: config ? stringField(config, 'repo_name') : null,
    } : null,
    canonicalDeployment: isObject(value) ? safePagesDeployment(value.canonical_deployment) : null,
    latestDeployment: isObject(value) ? safePagesDeployment(value.latest_deployment) : null,
  };
}

function safePagesDomain(value: unknown): JsonObject {
  return {
    id: stringField(value, 'id'),
    name: stringField(value, 'name'),
    status: stringField(value, 'status'),
  };
}

function safeZone(value: unknown): JsonObject {
  return {
    id: stringField(value, 'id'),
    name: stringField(value, 'name'),
    status: stringField(value, 'status'),
    paused: booleanField(value, 'paused'),
    type: stringField(value, 'type'),
    developmentMode: numberField(value, 'development_mode'),
    activatedOn: stringField(value, 'activated_on'),
    modifiedOn: stringField(value, 'modified_on'),
  };
}

function safeDnsRecord(value: unknown): JsonObject {
  return {
    id: stringField(value, 'id'),
    type: stringField(value, 'type'),
    name: stringField(value, 'name'),
    content: stringField(value, 'content'),
    ttl: numberField(value, 'ttl'),
    proxied: booleanField(value, 'proxied'),
    priority: numberField(value, 'priority'),
    comment: stringField(value, 'comment'),
    tags: isObject(value) ? stringArray(value.tags) : [],
  };
}

function safeRoute(value: unknown): JsonObject {
  return {
    id: stringField(value, 'id'),
    pattern: stringField(value, 'pattern'),
    script: stringField(value, 'script'),
  };
}

function sortByDateDescending(values: unknown[], field: string): unknown[] {
  return [...values].sort((a, b) => {
    const left = isObject(a) && typeof a[field] === 'string' ? Date.parse(a[field] as string) : 0;
    const right = isObject(b) && typeof b[field] === 'string' ? Date.parse(b[field] as string) : 0;
    return right - left;
  });
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  const output: JsonObject = {};
  for (const key of Object.keys(value).sort()) output[key] = stableValue(value[key]);
  return output;
}

async function rollbackOperationId(
  kind: 'worker' | 'pages',
  accountId: string,
  resource: string,
  expectedStateId: string,
): Promise<string> {
  const digest = await autopilotInputHash({ kind, accountId, resource, expectedStateId });
  return `op-cf-${kind}-${digest.slice(0, 48)}`;
}

function checkpointEnv(env: CloudflareActionEnv): AutopilotCheckpointEnv {
  if (!env.OPERATOR_CHECKPOINTS) {
    throw new CloudflareActionError('operator_checkpoint_storage_unavailable', 503);
  }
  return env as AutopilotCheckpointEnv;
}

function checkpointResult(payload: JsonObject): { status: number; body: JsonObject } | null {
  if (!isObject(payload.result)) return null;
  const status = payload.result.status;
  const body = payload.result.body;
  return typeof status === 'number' && Number.isInteger(status) && isObject(body)
    ? { status, body }
    : null;
}

async function claimRollback(
  env: CloudflareActionEnv,
  kind: 'worker' | 'pages',
  accountId: string,
  resource: string,
  expectedStateId: string,
  input: JsonObject,
): Promise<RollbackClaim> {
  const durableEnv = checkpointEnv(env);
  const operationId = await rollbackOperationId(kind, accountId, resource, expectedStateId);
  const inputHash = await autopilotInputHash({ accountId, ...input });
  const claim = await checkpointCall(durableEnv, operationId, '/claim', { operationId, inputHash });
  if (claim.payload.state === 'input_mismatch') {
    throw new CloudflareActionError('cloudflare_rollback_conflict', 409, { operationId });
  }
  if (claim.payload.state === 'in_progress') {
    throw new CloudflareActionError('cloudflare_rollback_in_progress', 409, {
      operationId,
      retryAfterSeconds:
        typeof claim.payload.retryAfterSeconds === 'number'
          ? claim.payload.retryAfterSeconds
          : 30,
    });
  }
  if (claim.payload.state === 'complete') {
    const stored = checkpointResult(claim.payload);
    if (stored) {
      const operation = isObject(stored.body.operation) ? stored.body.operation : {};
      return {
        operationId,
        inputHash,
        recovered: false,
        replay: json({
          ...stored.body,
          operation: { ...operation, id: operationId, replayed: true },
        }, stored.status),
      };
    }
  }
  if (!claim.response.ok && claim.payload.state !== 'recover') {
    throw new CloudflareActionError('cloudflare_rollback_checkpoint_failed', 502);
  }
  return {
    operationId,
    inputHash,
    recovered: claim.payload.state === 'recover',
  };
}

async function completeRollback(
  env: CloudflareActionEnv,
  claim: RollbackClaim,
  status: number,
  body: JsonObject,
): Promise<Response> {
  const finalBody: JsonObject = {
    ...body,
    operation: {
      id: claim.operationId,
      serialized: true,
      recovered: claim.recovered,
      replayed: false,
    },
  };
  const completion = await checkpointCall(checkpointEnv(env), claim.operationId, '/complete', {
    inputHash: claim.inputHash,
    status,
    body: finalBody,
  });
  if (!completion.response.ok) {
    return json({ ...finalBody, checkpointWarning: 'checkpoint_completion_failed' }, status);
  }
  return json(finalBody, status);
}

function workerDeploymentTargets(value: unknown, versionId: string): boolean {
  if (!isObject(value) || !Array.isArray(value.versions) || value.versions.length !== 1) {
    return false;
  }
  const only = value.versions[0];
  return (
    isObject(only) &&
    stringField(only, 'version_id') === versionId &&
    numberField(only, 'percentage') === 100
  );
}

async function snapshot(kind: string, value: JsonObject): Promise<string> {
  const serialized = JSON.stringify(stableValue(value));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${kind}:sha256:${hex}`;
}

async function withSnapshot(kind: string, value: JsonObject): Promise<JsonObject> {
  return { ...value, snapshot: await snapshot(kind, value) };
}

function resultArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function tokenStatus(env: GptActionsEnv, fetcher: typeof fetch): Promise<JsonObject> {
  const { result } = await cloudflareRequest(env, '/user/tokens/verify', 'GET', undefined, fetcher);
  if (!isObject(result) || result.status !== 'active') {
    throw new CloudflareActionError('cloudflare_token_inactive', 503);
  }
  return {
    status: result.status,
    expiresOn: stringField(result, 'expires_on'),
    notBefore: stringField(result, 'not_before'),
  };
}

async function section<T>(work: () => Promise<T>): Promise<JsonObject> {
  try {
    return { ok: true, data: await work() };
  } catch (error) {
    if (error instanceof CloudflareActionError && [401, 403, 404].includes(error.status)) {
      return { ok: false, status: error.status, error: error.code, ...(error.details ?? {}) };
    }
    throw error;
  }
}

async function resolveZone(env: GptActionsEnv, zone: string, fetcher: typeof fetch): Promise<JsonObject> {
  const { accountId } = credentials(env);
  if (ACCOUNT_ID_RE.test(zone)) {
    const { result } = await cloudflareRequest(env, `/zones/${encoded(zone)}`, 'GET', undefined, fetcher);
    if (!isObject(result)) throw new CloudflareActionError('cloudflare_zone_not_found', 404);
    const account = isObject(result.account) ? result.account : null;
    if (!account || stringField(account, 'id') !== accountId) {
      throw new CloudflareActionError('cloudflare_zone_not_allowed', 403);
    }
    return result;
  }
  const query = new URLSearchParams({ name: zone, 'account.id': accountId, per_page: '50' });
  const { result } = await cloudflareRequest(env, `/zones?${query}`, 'GET', undefined, fetcher);
  const zones = resultArray(result).filter((entry) => stringField(entry, 'name')?.toLowerCase() === zone.toLowerCase());
  if (zones.length !== 1 || !isObject(zones[0])) {
    throw new CloudflareActionError(zones.length ? 'cloudflare_zone_ambiguous' : 'cloudflare_zone_not_found', 404);
  }
  return zones[0];
}

async function overview(request: Request, env: GptActionsEnv, fetcher: typeof fetch): Promise<Response> {
  await cloudflarePolicy(request, env, fetcher);
  const { accountId } = credentials(env);
  const token = await tokenStatus(env, fetcher);
  const [workers, pages, zones] = await Promise.all([
    section(async () => {
      const { result } = await cloudflareRequest(env, `/accounts/${accountId}/workers/scripts`, 'GET', undefined, fetcher);
      return resultArray(result).map(safeWorker);
    }),
    section(async () => {
      const { result } = await cloudflareRequest(env, `/accounts/${accountId}/pages/projects?per_page=100`, 'GET', undefined, fetcher);
      return resultArray(result).map(safePagesProject);
    }),
    section(async () => {
      const { result } = await cloudflareRequest(env, `/zones?account.id=${accountId}&per_page=100`, 'GET', undefined, fetcher);
      return resultArray(result).map(safeZone);
    }),
  ]);
  return json({ ok: true, token, workers, pages, zones });
}

async function inspectWorker(request: Request, env: GptActionsEnv, fetcher: typeof fetch): Promise<Response> {
  await cloudflarePolicy(request, env, fetcher);
  const input = await inputObject(request);
  exactInput(input, ['script']);
  const script = resourceName(input.script, 'script');
  const { accountId } = credentials(env);
  const { result: scriptsResult } = await cloudflareRequest(env, `/accounts/${accountId}/workers/scripts`, 'GET', undefined, fetcher);
  const worker = resultArray(scriptsResult).find((entry) => stringField(entry, 'id') === script);
  if (!worker) throw new CloudflareActionError('cloudflare_worker_not_found', 404);

  const [deployments, versions, subdomain, settings, zones] = await Promise.all([
    section(async () => {
      const { result } = await cloudflareRequest(env, `/accounts/${accountId}/workers/scripts/${encoded(script)}/deployments`, 'GET', undefined, fetcher);
      const values = isObject(result) && Array.isArray(result.deployments) ? result.deployments : [];
      return sortByDateDescending(values, 'created_on').slice(0, 10).map(safeWorkerDeployment);
    }),
    section(async () => {
      const { result } = await cloudflareRequest(env, `/accounts/${accountId}/workers/scripts/${encoded(script)}/versions?page=1&per_page=20`, 'GET', undefined, fetcher);
      return resultArray(result).slice(0, 20).map(safeWorkerVersion);
    }),
    section(async () => {
      const { result } = await cloudflareRequest(env, `/accounts/${accountId}/workers/scripts/${encoded(script)}/subdomain`, 'GET', undefined, fetcher);
      return safeSubdomain(result);
    }),
    section(async () => {
      const { result } = await cloudflareRequest(env, `/accounts/${accountId}/workers/scripts/${encoded(script)}/script-settings`, 'GET', undefined, fetcher);
      return safeScriptSettings(result);
    }),
    section(async () => {
      const { result } = await cloudflareRequest(env, `/zones?account.id=${accountId}&per_page=100`, 'GET', undefined, fetcher);
      return resultArray(result);
    }),
  ]);

  const routes: JsonObject[] = [];
  const routeErrors: JsonObject[] = [];
  if (zones.ok === true && Array.isArray(zones.data)) {
    const routeResults = await Promise.all(zones.data.slice(0, 100).map(async (zone) => {
      if (!isObject(zone) || typeof zone.id !== 'string') return null;
      try {
        const { result } = await cloudflareRequest(env, `/zones/${encoded(zone.id)}/workers/routes`, 'GET', undefined, fetcher);
        const matched = resultArray(result).filter((route) => stringField(route, 'script') === script);
        return {
          zone: safeZone(zone),
          routes: await Promise.all(matched.map(async (route) => withSnapshot('cloudflare-route', safeRoute(route)))),
        };
      } catch (error) {
        if (error instanceof CloudflareActionError && [401, 403].includes(error.status)) {
          return { zone: safeZone(zone), error: error.code, status: error.status };
        }
        throw error;
      }
    }));
    for (const item of routeResults) {
      if (!item) continue;
      if ('routes' in item) routes.push(item as JsonObject);
      else routeErrors.push(item as JsonObject);
    }
  }

  return json({
    ok: true,
    worker: safeWorker(worker),
    deployments,
    versions,
    subdomain,
    settings,
    routes: { ok: routeErrors.length === 0, data: routes, errors: routeErrors },
  });
}

async function inspectPages(request: Request, env: GptActionsEnv, fetcher: typeof fetch): Promise<Response> {
  await cloudflarePolicy(request, env, fetcher);
  const input = await inputObject(request);
  exactInput(input, ['project']);
  const project = resourceName(input.project, 'project');
  const { accountId } = credentials(env);
  const { result } = await cloudflareRequest(env, `/accounts/${accountId}/pages/projects/${encoded(project)}`, 'GET', undefined, fetcher);
  if (!isObject(result)) throw new CloudflareActionError('invalid_cloudflare_pages_project', 502);
  const [deployments, domains] = await Promise.all([
    section(async () => {
      const { result: items } = await cloudflareRequest(env, `/accounts/${accountId}/pages/projects/${encoded(project)}/deployments?per_page=10`, 'GET', undefined, fetcher);
      return resultArray(items).slice(0, 10).map(safePagesDeployment);
    }),
    section(async () => {
      const { result: items } = await cloudflareRequest(env, `/accounts/${accountId}/pages/projects/${encoded(project)}/domains`, 'GET', undefined, fetcher);
      return resultArray(items).map(safePagesDomain);
    }),
  ]);
  return json({ ok: true, project: safePagesProject(result), deployments, domains });
}

async function inspectZone(request: Request, env: GptActionsEnv, fetcher: typeof fetch): Promise<Response> {
  await cloudflarePolicy(request, env, fetcher);
  const input = await inputObject(request);
  exactInput(input, ['zone']);
  const zoneName = requiredString(input.zone, 'zone', 253);
  const zone = await resolveZone(env, zoneName, fetcher);
  const zoneId = requiredString(zone.id, 'zone_id', 32);
  const [dns, routes] = await Promise.all([
    section(async () => {
      const { result } = await cloudflareRequest(env, `/zones/${encoded(zoneId)}/dns_records?per_page=500`, 'GET', undefined, fetcher);
      return Promise.all(resultArray(result).slice(0, 500).map(async (record) => withSnapshot('cloudflare-dns', safeDnsRecord(record))));
    }),
    section(async () => {
      const { result } = await cloudflareRequest(env, `/zones/${encoded(zoneId)}/workers/routes`, 'GET', undefined, fetcher);
      return Promise.all(resultArray(result).map(async (route) => withSnapshot('cloudflare-route', safeRoute(route))));
    }),
  ]);
  return json({ ok: true, zone: safeZone(zone), dns, routes });
}

async function rollbackWorker(
  request: Request,
  env: CloudflareActionEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const policy = await cloudflarePolicy(request, env, fetcher);
  requireMutation(policy, 'workerRollback');
  const input = await inputObject(request);
  exactInput(input, ['script', 'expectedDeploymentId', 'targetVersionId', 'message']);
  const script = resourceName(input.script, 'script');
  const expectedDeploymentId = uuid(input.expectedDeploymentId, 'expected_deployment_id');
  const targetVersionId = uuid(input.targetVersionId, 'target_version_id');
  const message = optionalString(input.message, 'message', 1_000) ?? 'Gremlin guarded rollback';
  const { accountId } = credentials(env);
  const claim = await claimRollback(
    env,
    'worker',
    accountId,
    script,
    expectedDeploymentId,
    { script, expectedDeploymentId, targetVersionId, message },
  );
  if (claim.replay) return claim.replay;

  const deploymentsPath = `/accounts/${accountId}/workers/scripts/${encoded(script)}/deployments`;
  try {
    const { result } = await cloudflareRequest(env, deploymentsPath, 'GET', undefined, fetcher);
    const deployments = isObject(result) && Array.isArray(result.deployments) ? result.deployments : [];
    const current = sortByDateDescending(deployments, 'created_on')[0];
    if (claim.recovered && workerDeploymentTargets(current, targetVersionId)) {
      return completeRollback(env, claim, 200, {
        ok: true,
        deployment: safeWorkerDeployment(current),
        recovery: 'verified_existing_target',
      });
    }
    if (!isObject(current) || stringField(current, 'id') !== expectedDeploymentId) {
      return completeRollback(env, claim, 409, {
        ok: false,
        error: 'cloudflare_deployment_changed',
        currentDeploymentId: isObject(current) ? stringField(current, 'id') : null,
      });
    }

    await cloudflareRequest(
      env,
      `/accounts/${accountId}/workers/scripts/${encoded(script)}/versions/${encoded(targetVersionId)}`,
      'GET',
      undefined,
      fetcher,
    );
    const { result: created } = await cloudflareRequest(
      env,
      deploymentsPath,
      'POST',
      {
        strategy: 'percentage',
        versions: [{ version_id: targetVersionId, percentage: 100 }],
        annotations: { 'workers/message': message },
      },
      fetcher,
    );
    return completeRollback(env, claim, 200, {
      ok: true,
      deployment: safeWorkerDeployment(created),
    });
  } catch (error) {
    if (error instanceof CloudflareActionError && error.status < 500) {
      return completeRollback(env, claim, error.status, {
        ok: false,
        error: error.code,
        ...(error.details ?? {}),
      });
    }
    throw error;
  }
}

async function rollbackPages(
  request: Request,
  env: CloudflareActionEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const policy = await cloudflarePolicy(request, env, fetcher);
  requireMutation(policy, 'pagesRollback');
  const input = await inputObject(request);
  exactInput(input, ['project', 'expectedProductionDeploymentId', 'targetDeploymentId']);
  const project = resourceName(input.project, 'project');
  const expectedId = uuid(input.expectedProductionDeploymentId, 'expected_production_deployment_id');
  const targetId = uuid(input.targetDeploymentId, 'target_deployment_id');
  const { accountId } = credentials(env);
  const claim = await claimRollback(
    env,
    'pages',
    accountId,
    project,
    expectedId,
    { project, expectedProductionDeploymentId: expectedId, targetDeploymentId: targetId },
  );
  if (claim.replay) return claim.replay;

  try {
    const projectPath = `/accounts/${accountId}/pages/projects/${encoded(project)}`;
    const { result } = await cloudflareRequest(env, projectPath, 'GET', undefined, fetcher);
    if (!isObject(result)) throw new CloudflareActionError('invalid_cloudflare_pages_project', 502);
    const canonical = isObject(result.canonical_deployment) ? result.canonical_deployment : null;
    const currentId = canonical ? stringField(canonical, 'id') : null;
    if (claim.recovered && currentId === targetId && canonical) {
      return completeRollback(env, claim, 200, {
        ok: true,
        deployment: safePagesDeployment(canonical),
        recovery: 'verified_existing_target',
      });
    }
    if (currentId !== expectedId) {
      return completeRollback(env, claim, 409, {
        ok: false,
        error: 'cloudflare_pages_deployment_changed',
        currentDeploymentId: currentId,
      });
    }

    const { result: target } = await cloudflareRequest(
      env,
      `${projectPath}/deployments/${encoded(targetId)}`,
      'GET',
      undefined,
      fetcher,
    );
    if (!isObject(target) || stringField(target, 'environment') !== 'production') {
      return completeRollback(env, claim, 409, {
        ok: false,
        error: 'cloudflare_pages_target_not_production',
      });
    }
    const { result: rolledBack } = await cloudflareRequest(
      env,
      `${projectPath}/deployments/${encoded(targetId)}/rollback`,
      'POST',
      undefined,
      fetcher,
    );
    return completeRollback(env, claim, 200, {
      ok: true,
      deployment: safePagesDeployment(rolledBack),
    });
  } catch (error) {
    if (error instanceof CloudflareActionError && error.status < 500) {
      return completeRollback(env, claim, error.status, {
        ok: false,
        error: error.code,
        ...(error.details ?? {}),
      });
    }
    throw error;
  }
}

async function updateWorkerSubdomain(request: Request, env: GptActionsEnv, fetcher: typeof fetch): Promise<Response> {
  const policy = await cloudflarePolicy(request, env, fetcher);
  requireMutation(policy, 'workerSubdomain');
  const input = await inputObject(request);
  exactInput(input, ['script', 'expectedEnabled', 'expectedPreviewsEnabled', 'enabled', 'previewsEnabled']);
  const script = resourceName(input.script, 'script');
  const expectedEnabled = requiredBoolean(input.expectedEnabled, 'expected_enabled');
  const expectedPreviewsEnabled = requiredBoolean(input.expectedPreviewsEnabled, 'expected_previews_enabled');
  const enabled = requiredBoolean(input.enabled, 'enabled');
  const previewsEnabled = requiredBoolean(input.previewsEnabled, 'previews_enabled');
  const { accountId } = credentials(env);
  const path = `/accounts/${accountId}/workers/scripts/${encoded(script)}/subdomain`;
  const { result: current } = await cloudflareRequest(env, path, 'GET', undefined, fetcher);
  if (
    booleanField(current, 'enabled') !== expectedEnabled ||
    booleanField(current, 'previews_enabled') !== expectedPreviewsEnabled
  ) {
    throw new CloudflareActionError('cloudflare_subdomain_changed', 409, { current: safeSubdomain(current) });
  }
  const { result } = await cloudflareRequest(env, path, 'POST', { enabled, previews_enabled: previewsEnabled }, fetcher);
  return json({ ok: true, subdomain: safeSubdomain(result) });
}

async function updateRoute(request: Request, env: GptActionsEnv, fetcher: typeof fetch): Promise<Response> {
  const policy = await cloudflarePolicy(request, env, fetcher);
  requireMutation(policy, 'routeUpdate');
  const input = await inputObject(request);
  exactInput(input, ['zone', 'routeId', 'expectedSnapshot', 'pattern', 'script']);
  const zoneName = requiredString(input.zone, 'zone', 253);
  const routeId = idValue(input.routeId, 'route_id');
  const expectedSnapshot = requiredString(input.expectedSnapshot, 'expected_snapshot', 100);
  const pattern = requiredString(input.pattern, 'pattern', 1_000);
  const script = resourceName(input.script, 'script');
  const zone = await resolveZone(env, zoneName, fetcher);
  const zoneId = requiredString(zone.id, 'zone_id', 32);
  const path = `/zones/${encoded(zoneId)}/workers/routes/${encoded(routeId)}`;
  const { result: current } = await cloudflareRequest(env, path, 'GET', undefined, fetcher);
  const currentSafe = safeRoute(current);
  const currentSnapshot = await snapshot('cloudflare-route', currentSafe);
  if (currentSnapshot !== expectedSnapshot) {
    throw new CloudflareActionError('cloudflare_route_changed', 409, { current: { ...currentSafe, snapshot: currentSnapshot } });
  }
  const { result } = await cloudflareRequest(env, path, 'PUT', { pattern, script }, fetcher);
  return json({ ok: true, route: await withSnapshot('cloudflare-route', safeRoute(result)) });
}

function dnsPatch(value: unknown): JsonObject {
  if (!isObject(value)) throw new CloudflareActionError('invalid_desired');
  exactInput(value, ['name', 'content', 'ttl', 'proxied', 'comment', 'priority']);
  if (Object.keys(value).length === 0) throw new CloudflareActionError('empty_desired');
  const patch: JsonObject = {};
  const name = optionalString(value.name, 'name', 253);
  const content = optionalString(value.content, 'content', 65_535);
  const ttl = optionalInteger(value.ttl, 'ttl', 1, 2_147_483_647);
  const proxied = optionalBoolean(value.proxied, 'proxied');
  const comment = optionalString(value.comment, 'comment', 500);
  const priority = optionalInteger(value.priority, 'priority', 0, 65_535);
  if (name !== undefined) patch.name = name;
  if (content !== undefined) patch.content = content;
  if (ttl !== undefined) patch.ttl = ttl;
  if (proxied !== undefined) patch.proxied = proxied;
  if (comment !== undefined) patch.comment = comment;
  if (priority !== undefined) patch.priority = priority;
  return patch;
}

async function updateDns(request: Request, env: GptActionsEnv, fetcher: typeof fetch): Promise<Response> {
  const policy = await cloudflarePolicy(request, env, fetcher);
  requireMutation(policy, 'dnsUpdate');
  const input = await inputObject(request);
  exactInput(input, ['zone', 'recordId', 'expectedSnapshot', 'desired']);
  const zoneName = requiredString(input.zone, 'zone', 253);
  const recordId = idValue(input.recordId, 'record_id');
  const expectedSnapshot = requiredString(input.expectedSnapshot, 'expected_snapshot', 100);
  const desired = dnsPatch(input.desired);
  const zone = await resolveZone(env, zoneName, fetcher);
  const zoneId = requiredString(zone.id, 'zone_id', 32);
  const path = `/zones/${encoded(zoneId)}/dns_records/${encoded(recordId)}`;
  const { result: current } = await cloudflareRequest(env, path, 'GET', undefined, fetcher);
  const currentSafe = safeDnsRecord(current);
  const currentSnapshot = await snapshot('cloudflare-dns', currentSafe);
  if (currentSnapshot !== expectedSnapshot) {
    throw new CloudflareActionError('cloudflare_dns_record_changed', 409, { current: { ...currentSafe, snapshot: currentSnapshot } });
  }
  const { result } = await cloudflareRequest(env, path, 'PATCH', desired, fetcher);
  return json({ ok: true, record: await withSnapshot('cloudflare-dns', safeDnsRecord(result)) });
}

function responseSchema(): JsonObject {
  return {
    '200': {
      description: 'Successful response',
      content: { 'application/json': { schema: { type: 'object', properties: {} } } },
    },
  };
}

function postOperation(
  operationId: string,
  summary: string,
  description: string,
  properties: JsonObject,
  required: string[],
): JsonObject {
  return {
    post: {
      operationId,
      summary,
      description,
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              additionalProperties: false,
              required,
              properties,
            },
          },
        },
      },
      responses: responseSchema(),
    },
  };
}

export function addCloudflareOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[OVERVIEW_PATH] = {
    get: {
      operationId: 'getCloudflareOverview',
      summary: 'Inspect the Cloudflare account inventory',
      description: 'Use first for Cloudflare work. Returns safe Workers, Pages and zone inventory plus token health without exposing credentials or environment-variable values.',
      responses: responseSchema(),
    },
  };
  paths[WORKER_INSPECT_PATH] = postOperation(
    'inspectCloudflareWorker',
    'Inspect one Cloudflare Worker',
    'Returns safe Worker metadata, recent deployments and versions, workers.dev state, observability settings and matching routes. Secret binding values are never returned.',
    { script: { type: 'string' } },
    ['script'],
  );
  paths[PAGES_INSPECT_PATH] = postOperation(
    'inspectCloudflarePagesProject',
    'Inspect one Cloudflare Pages project',
    'Returns safe project metadata, recent deployment status and domains without returning build environment-variable values.',
    { project: { type: 'string' } },
    ['project'],
  );
  paths[ZONE_INSPECT_PATH] = postOperation(
    'inspectCloudflareZone',
    'Inspect one Cloudflare zone',
    'Returns DNS records and Worker routes with snapshot hashes. Use those fresh snapshots before guarded mutations.',
    { zone: { type: 'string', description: 'Zone name or Cloudflare zone id.' } },
    ['zone'],
  );
  paths[WORKER_ROLLBACK_PATH] = postOperation(
    'rollbackCloudflareWorker',
    'Roll a Worker back to an existing version',
    'Serializes one rollback per expected deployment, replays identical retries, and creates a 100% deployment only if the latest deployment id still matches. Never uses force, uploads code or edits secrets.',
    {
      script: { type: 'string' },
      expectedDeploymentId: { type: 'string' },
      targetVersionId: { type: 'string' },
      message: { type: 'string' },
    },
    ['script', 'expectedDeploymentId', 'targetVersionId'],
  );
  paths[PAGES_ROLLBACK_PATH] = postOperation(
    'rollbackCloudflarePagesProject',
    'Roll a Pages project back to an existing production deployment',
    'Serializes one rollback per expected production deployment, replays identical retries, and rolls back only when the canonical deployment still matches and the target is production.',
    {
      project: { type: 'string' },
      expectedProductionDeploymentId: { type: 'string' },
      targetDeploymentId: { type: 'string' },
    },
    ['project', 'expectedProductionDeploymentId', 'targetDeploymentId'],
  );
  paths[WORKER_SUBDOMAIN_PATH] = postOperation(
    'setCloudflareWorkerSubdomain',
    'Update workers.dev and preview URL state',
    'Updates a Worker subdomain only when both current booleans match the expected state.',
    {
      script: { type: 'string' },
      expectedEnabled: { type: 'boolean' },
      expectedPreviewsEnabled: { type: 'boolean' },
      enabled: { type: 'boolean' },
      previewsEnabled: { type: 'boolean' },
    },
    ['script', 'expectedEnabled', 'expectedPreviewsEnabled', 'enabled', 'previewsEnabled'],
  );
  paths[ROUTE_UPDATE_PATH] = postOperation(
    'updateCloudflareWorkerRoute',
    'Update an existing Worker route',
    'Updates only an existing route and requires the exact snapshot returned by inspectCloudflareZone. Does not create or delete routes.',
    {
      zone: { type: 'string' },
      routeId: { type: 'string' },
      expectedSnapshot: { type: 'string' },
      pattern: { type: 'string' },
      script: { type: 'string' },
    },
    ['zone', 'routeId', 'expectedSnapshot', 'pattern', 'script'],
  );
  paths[DNS_UPDATE_PATH] = postOperation(
    'updateCloudflareDnsRecord',
    'Update an existing DNS record',
    'Patches an existing DNS record only when the current record matches the exact snapshot from inspectCloudflareZone. Does not create, delete or change record type.',
    {
      zone: { type: 'string' },
      recordId: { type: 'string' },
      expectedSnapshot: { type: 'string' },
      desired: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          content: { type: 'string' },
          ttl: { type: 'integer' },
          proxied: { type: 'boolean' },
          comment: { type: 'string' },
          priority: { type: 'integer' },
        },
      },
    },
    ['zone', 'recordId', 'expectedSnapshot', 'desired'],
  );
}

function actionFailure(error: unknown): Response {
  if (error instanceof CloudflareActionError) {
    return json({ ok: false, error: error.code, ...(error.details ?? {}) }, error.status);
  }
  if (
    error &&
    typeof error === 'object' &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { status?: unknown }).status === 'number'
  ) {
    const source = error as { code: string; status: number };
    return json({ ok: false, error: source.code }, source.status);
  }
  console.error(JSON.stringify({
    cloudflareOperator: 'failed',
    error: error instanceof Error ? error.message : 'unknown_error',
  }));
  return json({ ok: false, error: 'internal_error' }, 500);
}

export async function handleCloudflareAction(
  request: Request,
  env: CloudflareActionEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const paths = new Set([
    OVERVIEW_PATH,
    WORKER_INSPECT_PATH,
    PAGES_INSPECT_PATH,
    ZONE_INSPECT_PATH,
    WORKER_ROLLBACK_PATH,
    PAGES_ROLLBACK_PATH,
    WORKER_SUBDOMAIN_PATH,
    ROUTE_UPDATE_PATH,
    DNS_UPDATE_PATH,
  ]);
  if (!paths.has(path)) return null;
  if (path === OVERVIEW_PATH) {
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  } else if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  try {
    if (path === OVERVIEW_PATH) return await overview(request, env, fetcher);
    if (path === WORKER_INSPECT_PATH) return await inspectWorker(request, env, fetcher);
    if (path === PAGES_INSPECT_PATH) return await inspectPages(request, env, fetcher);
    if (path === ZONE_INSPECT_PATH) return await inspectZone(request, env, fetcher);
    if (path === WORKER_ROLLBACK_PATH) return await rollbackWorker(request, env, fetcher);
    if (path === PAGES_ROLLBACK_PATH) return await rollbackPages(request, env, fetcher);
    if (path === WORKER_SUBDOMAIN_PATH) return await updateWorkerSubdomain(request, env, fetcher);
    if (path === ROUTE_UPDATE_PATH) return await updateRoute(request, env, fetcher);
    return await updateDns(request, env, fetcher);
  } catch (error) {
    return actionFailure(error);
  }
}
