import assert from 'node:assert/strict';
import test from 'node:test';

import { createActionFetch } from '../src/action-context.ts';
import {
  addCloudflareOpenApi,
  handleCloudflareAction,
} from '../src/cloudflare-actions.ts';
import type { GremlinPolicy } from '../src/policy-actions.ts';
import { customGptOpenApi } from '../src/router.ts';

type Env = Parameters<typeof handleCloudflareAction>[1];
type FetchStub = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;

const ACCOUNT_ID = 'a'.repeat(32);
const POLICY: GremlinPolicy = {
  version: 1,
  model: {
    autonomy: 'high',
    operatingMode: 'act_then_report',
    stopConditions: ['missing_credentials_or_permissions'],
    preferredActions: ['getCloudflareOverview'],
  },
  runtime: {
    repositories: { include: ['trvny/*'], exclude: [], skipArchived: true },
    maintenance: {
      autofix: true,
      maxRepositoriesPerRun: 8,
      maxFixesPerRun: 12,      workflowRetries: 1,
      cacheMaxBytes: 5 * 1024 * 1024 * 1024,
      cacheStaleDays: 5,
      repositoryOverrides: [],
    },
    cloudflare: {
      enabled: true,
      mutations: {
        workerRollback: true,
        pagesRollback: true,
        workerSubdomain: true,
        routeUpdate: true,
        dnsUpdate: true,
      },
    },
    merge: {
      enabled: true,
      method: 'squash',
      requireGreenCi: true,
      requireNoActionableReviews: true,
      requireExpectedHeadSha: true,
    },
    release: { allowedBranches: ['main'], requireExpectedTargetSha: true },
  },
};

function filePayload(content: string): Record<string, unknown> {
  return {    encoding: 'base64',
    content: Buffer.from(content).toString('base64'),
    sha: '1'.repeat(40),
  };
}

function cf(result: unknown): Response {
  return Response.json({ success: true, errors: [], messages: [], result });
}

function checkpointNamespace(): DurableObjectNamespace {
  const states = new Map<string, {
    inputHash: string;
    status: 'running' | 'complete';
    result?: { status: number; body: Record<string, unknown> };
  }>();
  return {
    idFromName(name: string) {
      return name as unknown as DurableObjectId;
    },
    get(id: DurableObjectId) {
      const key = id as unknown as string;
      return {
        async fetch(input: RequestInfo | URL, init?: RequestInit) {
          const request = new Request(input, init);
          const body = await request.json() as Record<string, unknown>;
          const inputHash = String(body.inputHash ?? '');
          const current = states.get(key);
          if (new URL(request.url).pathname === '/claim') {
            if (current && current.inputHash !== inputHash) {
              return Response.json({ ok: false, state: 'input_mismatch' }, { status: 409 });
            }
            if (current?.status === 'complete') {
              return Response.json({ ok: true, state: 'complete', result: current.result });
            }
            if (current?.status === 'running') {
              return Response.json(
                { ok: false, state: 'in_progress', retryAfterSeconds: 30 },
                { status: 409 },
              );
            }
            states.set(key, { inputHash, status: 'running' });
            return Response.json({ ok: true, state: 'claimed' });
          }
          if (new URL(request.url).pathname === '/complete') {
            states.set(key, {
              inputHash,
              status: 'complete',
              result: {
                status: Number(body.status),
                body: body.body as Record<string, unknown>,
              },
            });
            return Response.json({ ok: true });
          }
          if (new URL(request.url).pathname === '/release') {
            if (current && current.inputHash !== inputHash) {
              return Response.json({ error: 'checkpoint_input_mismatch' }, { status: 409 });
            }
            states.delete(key);
            return Response.json({ ok: true, state: 'released' });
          }
          return Response.json({ error: 'not_found' }, { status: 404 });
        },
      } as DurableObjectStub;
    },
  } as unknown as DurableObjectNamespace;
}

function env(): Env {
  return {
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: 'test',
    OPERATOR_CHECKPOINTS: checkpointNamespace(),
  } as Env;
}

function githubPolicyFetch(extra: FetchStub): typeof fetch {
  return ((input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === 'https://api.github.com' && url.pathname === '/user') {
      return Promise.resolve(Response.json({ login: 'trvny', id: 120686325 }));
    }
    if (
      url.origin === 'https://api.github.com' &&
      url.pathname === '/repos/trvny/trvny/contents/.ai/private/openai/gremlin-policy.json'
    ) {
      return Promise.resolve(Response.json(filePayload(JSON.stringify(POLICY))));
    }
    return Promise.resolve(extra(request));
  }) as typeof fetch;
}

test('Cloudflare operator actions are exposed in Custom GPT OpenAPI', () => {
  const document = customGptOpenApi('https://example.workers.dev') as {
    paths: Record<string, Record<string, { operationId?: string }>>;
  };
  addCloudflareOpenApi(document);
  const ids = Object.values(document.paths)
    .flatMap((path) => Object.values(path))
    .map((operation) => operation.operationId)
    .filter(Boolean);
  for (const id of [
    'getCloudflareOverview',
    'inspectCloudflareWorker',
    'inspectCloudflarePagesProject',
    'inspectCloudflareZone',
    'rollbackCloudflareWorker',
    'rollbackCloudflarePagesProject',
    'setCloudflareWorkerSubdomain',
    'updateCloudflareWorkerRoute',
    'updateCloudflareDnsRecord',
  ]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
});

test('Cloudflare overview strips Pages secret values', async () => {
  const upstream: typeof fetch = githubPolicyFetch((input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === '/client/v4/user/tokens/verify') {
      return cf({ status: 'active', expires_on: null });
    }    if (url.pathname.endsWith('/workers/scripts')) {
      return cf([{ id: 'kanarek-companion', modified_on: '2026-08-28T12:00:00Z' }]);
    }
    if (url.pathname.endsWith('/pages/projects')) {
      return cf([{
        id: 'pages-1',
        name: 'trfny',
        subdomain: 'trfny.pages.dev',
        production_branch: 'main',
        source: { type: 'github', config: { owner: 'trvny', repo_name: 'trvny' } },
        deployment_configs: {
          production: {
            env_vars: {
              TOP_SECRET: { type: 'secret_text', value: 'do-not-leak-this' },
            },
          },
        },
      }]);
    }
    if (url.pathname === '/client/v4/zones') {
      return cf([{ id: 'b'.repeat(32), name: 'trfny.com', status: 'active' }]);
    }
    return Response.json({ success: false, errors: [{ code: 9999 }] }, { status: 500 });
  });
  const request = new Request('https://example.workers.dev/gpt-actions/cloudflare/overview', {
    method: 'GET',
    headers: { Authorization: 'Bearer test' },
  });
  const response = await handleCloudflareAction(request, env(), createActionFetch(upstream));
  assert.ok(response);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.doesNotMatch(text, /do-not-leak-this|TOP_SECRET|deployment_configs/);
  assert.match(text, /kanarek-companion/);
  assert.match(text, /trfny\.pages\.dev/);
});

test('stale DNS snapshot blocks a write', async () => {
  let patchCalls = 0;
  const zoneId = 'b'.repeat(32);
  const recordId = 'record-1';
  const upstream: typeof fetch = githubPolicyFetch((input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === '/client/v4/zones') {
      return cf([{ id: zoneId, name: 'trfny.com', status: 'active' }]);
    }
    if (url.pathname === `/client/v4/zones/${zoneId}/dns_records/${recordId}`) {
      if (request.method === 'PATCH') patchCalls += 1;
      return cf({
        id: recordId,
        type: 'CNAME',
        name: 'api.trfny.com',
        content: 'old.example.com',
        ttl: 1,
        proxied: true,
      });
    }
    return Response.json({ success: false, errors: [{ code: 9999 }] }, { status: 500 });
  });
  const request = new Request('https://example.workers.dev/gpt-actions/cloudflare/dns/update', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test',
      'Content-Type': 'application/json',
    },    body: JSON.stringify({
      zone: 'trfny.com',
      recordId,
      expectedSnapshot: `cloudflare-dns:sha256:${'0'.repeat(64)}`,
      desired: { content: 'new.example.com' },
    }),
  });
  const response = await handleCloudflareAction(request, env(), createActionFetch(upstream));
  assert.ok(response);
  assert.equal(response.status, 409);
  assert.equal(patchCalls, 0);
  const payload = await response.json() as { error?: string };
  assert.equal(payload.error, 'cloudflare_dns_record_changed');
});

test('stale Worker deployment blocks rollback', async () => {
  let deploymentWrites = 0;
  const currentId = '11111111-1111-4111-8111-111111111111';
  const expectedId = '22222222-2222-4222-8222-222222222222';
  const targetId = '33333333-3333-4333-8333-333333333333';
  const upstream: typeof fetch = githubPolicyFetch((input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname.endsWith('/workers/scripts/kanarek-companion/deployments')) {
      if (request.method === 'POST') deploymentWrites += 1;
      return cf({
        deployments: [{ id: currentId, created_on: '2026-08-28T12:00:00Z' }],
      });
    }
    return Response.json({ success: false, errors: [{ code: 9999 }] }, { status: 500 });
  });  const request = new Request('https://example.workers.dev/gpt-actions/cloudflare/workers/rollback', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      script: 'kanarek-companion',
      expectedDeploymentId: expectedId,
      targetVersionId: targetId,
    }),
  });
  const response = await handleCloudflareAction(request, env(), createActionFetch(upstream));
  assert.ok(response);
  assert.equal(response.status, 409);
  assert.equal(deploymentWrites, 0);
  const payload = await response.json() as {
    error?: string;
    currentDeploymentId?: string | null;
  };
  assert.equal(payload.error, 'cloudflare_deployment_changed');
  assert.equal(payload.currentDeploymentId, currentId);
});

test('zone ids are scoped to the configured Cloudflare account', async () => {
  const zoneId = 'b'.repeat(32);
  const upstream: typeof fetch = githubPolicyFetch((input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === `/client/v4/zones/${zoneId}`) {
      return cf({
        id: zoneId,
        name: 'other.example',
        account: { id: 'c'.repeat(32) },
      });
    }
    return Response.json({ success: false, errors: [{ code: 9999 }] }, { status: 500 });
  });
  const request = new Request('https://example.workers.dev/gpt-actions/cloudflare/zones/inspect', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ zone: zoneId }),
  });
  const response = await handleCloudflareAction(request, env(), createActionFetch(upstream));
  assert.ok(response);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: 'cloudflare_zone_not_allowed',
  });
});

test('Worker rollback serializes competing targets and replays identical retries', async () => {
  const runtime = env();
  const expectedId = '11111111-1111-4111-8111-111111111111';
  const targetA = '22222222-2222-4222-8222-222222222222';
  const targetB = '33333333-3333-4333-8333-333333333333';
  const createdId = '44444444-4444-4444-8444-444444444444';
  let deploymentWrites = 0;
  let currentDeploymentId = expectedId;
  let currentVersionId = '55555555-5555-4555-8555-555555555555';
  let releasePost!: () => void;
  let markPostStarted!: () => void;
  const postGate = new Promise<void>((resolve) => { releasePost = resolve; });
  const postStarted = new Promise<void>((resolve) => { markPostStarted = resolve; });

  const upstream: typeof fetch = githubPolicyFetch(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname.endsWith('/workers/scripts/kanarek-companion/deployments')) {
      if (request.method === 'POST') {
        deploymentWrites += 1;
        currentDeploymentId = createdId;
        currentVersionId = targetA;
        markPostStarted();
        await postGate;
        return cf({
          id: createdId,
          created_on: '2026-08-28T16:00:00Z',
          versions: [{ version_id: targetA, percentage: 100 }],
        });
      }
      return cf({
        deployments: [{
          id: currentDeploymentId,
          created_on: '2026-08-28T15:00:00Z',
          versions: [{ version_id: currentVersionId, percentage: 100 }],
        }],
      });
    }
    if (url.pathname.includes('/workers/scripts/kanarek-companion/versions/')) {
      return cf({ id: url.pathname.split('/').at(-1) });
    }
    return Response.json({ success: false, errors: [{ code: 9999 }] }, { status: 500 });
  });

  const requestFor = (targetVersionId: string) => new Request(
    'https://example.workers.dev/gpt-actions/cloudflare/workers/rollback',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        script: 'kanarek-companion',
        expectedDeploymentId: expectedId,
        targetVersionId,
      }),
    },
  );

  const firstPromise = handleCloudflareAction(requestFor(targetA), runtime, createActionFetch(upstream));
  await postStarted;
  const competing = await handleCloudflareAction(requestFor(targetB), runtime, createActionFetch(upstream));
  assert.ok(competing);
  assert.equal(competing.status, 409);
  assert.equal((await competing.json() as { error?: string }).error, 'cloudflare_mutation_conflict');
  assert.equal(deploymentWrites, 1);

  releasePost();
  const first = await firstPromise;
  assert.ok(first);
  assert.equal(first.status, 200);

  const replay = await handleCloudflareAction(requestFor(targetA), runtime, createActionFetch(upstream));
  assert.ok(replay);
  assert.equal(replay.status, 200);
  const replayPayload = await replay.json() as { idempotent?: boolean; operation?: { replayed?: boolean } };
  assert.equal(replayPayload.idempotent, true);
  assert.equal(replayPayload.operation?.replayed, false);
  assert.equal(deploymentWrites, 1);
});

test('Pages rollback replays an identical retry without a second mutation', async () => {
  const runtime = env();
  const expectedId = '11111111-1111-4111-8111-111111111111';
  const targetId = '22222222-2222-4222-8222-222222222222';
  const targetC = '33333333-3333-4333-8333-333333333333';
  let currentId = expectedId;
  let rollbackWrites = 0;
  const upstream: typeof fetch = githubPolicyFetch((input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname.endsWith('/pages/projects/trfny')) {
      return cf({
        id: 'project-1',
        name: 'trfny',
        canonical_deployment: {
          id: currentId,
          environment: 'production',
        },
      });
    }
    if (url.pathname.includes('/pages/projects/trfny/deployments/') && url.pathname.endsWith('/rollback')) {
      rollbackWrites += 1;
      const rolledId = url.pathname.split('/').at(-2) ?? '';
      currentId = rolledId;
      return cf({ id: rolledId, environment: 'production' });
    }
    if (url.pathname.includes('/pages/projects/trfny/deployments/')) {
      const deploymentId = url.pathname.split('/').at(-1) ?? '';
      return cf({ id: deploymentId, environment: 'production' });
    }
    return Response.json({ success: false, errors: [{ code: 9999 }] }, { status: 500 });
  });
  const request = (targetDeploymentId = targetId) => new Request(
    'https://example.workers.dev/gpt-actions/cloudflare/pages/rollback',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        project: 'trfny',
        expectedProductionDeploymentId: expectedId,
        targetDeploymentId,
      }),
    },
  );

  const first = await handleCloudflareAction(request(), runtime, createActionFetch(upstream));
  assert.ok(first);
  assert.equal(first.status, 200);
  assert.equal(rollbackWrites, 1);

  const replay = await handleCloudflareAction(request(), runtime, createActionFetch(upstream));
  assert.ok(replay);
  assert.equal(replay.status, 200);
  const payload = await replay.json() as { idempotent?: boolean; operation?: { replayed?: boolean } };
  assert.equal(payload.idempotent, true);
  assert.equal(payload.operation?.replayed, false);
  assert.equal(rollbackWrites, 1);

  currentId = expectedId;
  const freshCycle = await handleCloudflareAction(request(targetC), runtime, createActionFetch(upstream));
  assert.ok(freshCycle);
  assert.equal(freshCycle.status, 200);
  assert.equal(currentId, targetC);
  assert.equal(rollbackWrites, 2);
});

test('transient Worker rollback failure releases the resource lock for retry', async () => {
  const runtime = env();
  const expectedId = '11111111-1111-4111-8111-111111111111';
  const targetId = '22222222-2222-4222-8222-222222222222';
  const createdId = '33333333-3333-4333-8333-333333333333';
  let currentId = expectedId;
  let currentVersionId = '44444444-4444-4444-8444-444444444444';
  let deploymentWrites = 0;
  const upstream: typeof fetch = githubPolicyFetch((input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname.endsWith('/workers/scripts/kanarek-companion/deployments')) {
      if (request.method === 'POST') {
        deploymentWrites += 1;
        if (deploymentWrites === 1) {
          return Response.json({ success: false, errors: [{ code: 1015 }] }, { status: 429 });
        }
        currentId = createdId;
        currentVersionId = targetId;
        return cf({ id: createdId, versions: [{ version_id: targetId, percentage: 100 }] });
      }
      return cf({ deployments: [{ id: currentId, created_on: '2026-08-28T15:00:00Z', versions: [{ version_id: currentVersionId, percentage: 100 }] }] });
    }
    if (url.pathname.includes('/workers/scripts/kanarek-companion/versions/')) {
      return cf({ id: targetId });
    }
    return Response.json({ success: false, errors: [{ code: 9999 }] }, { status: 500 });
  });
  const request = () => new Request('https://example.workers.dev/gpt-actions/cloudflare/workers/rollback', {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ script: 'kanarek-companion', expectedDeploymentId: expectedId, targetVersionId: targetId }),
  });
  const first = await handleCloudflareAction(request(), runtime, createActionFetch(upstream));
  assert.ok(first);
  assert.equal(first.status, 429);
  const second = await handleCloudflareAction(request(), runtime, createActionFetch(upstream));
  assert.ok(second);
  assert.equal(second.status, 200);
  assert.equal(deploymentWrites, 2);
});

test('ambiguous Worker rollback failure keeps the resource lease', async () => {
  const runtime = env();
  const expectedId = '11111111-1111-4111-8111-111111111111';
  const targetId = '22222222-2222-4222-8222-222222222222';
  const createdId = '33333333-3333-4333-8333-333333333333';
  let currentId = expectedId;
  let currentVersionId = '44444444-4444-4444-8444-444444444444';
  let deploymentWrites = 0;
  const upstream: typeof fetch = githubPolicyFetch((input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname.endsWith('/workers/scripts/kanarek-companion/deployments')) {
      if (request.method === 'POST') {
        deploymentWrites += 1;
        currentId = createdId;
        currentVersionId = targetId;
        throw new TypeError('response lost after write');
      }
      return cf({ deployments: [{ id: currentId, created_on: '2026-08-28T15:00:00Z', versions: [{ version_id: currentVersionId, percentage: 100 }] }] });
    }
    if (url.pathname.includes('/workers/scripts/kanarek-companion/versions/')) return cf({ id: targetId });
    return Response.json({ success: false, errors: [{ code: 9999 }] }, { status: 500 });
  });
  const request = () => new Request('https://example.workers.dev/gpt-actions/cloudflare/workers/rollback', {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ script: 'kanarek-companion', expectedDeploymentId: expectedId, targetVersionId: targetId }),
  });
  const first = await handleCloudflareAction(request(), runtime, createActionFetch(upstream));
  assert.ok(first);
  assert.equal(first.status, 500);
  const second = await handleCloudflareAction(request(), runtime, createActionFetch(upstream));
  assert.ok(second);
  assert.equal(second.status, 409);
  assert.equal((await second.json() as { error?: string }).error, 'cloudflare_mutation_in_progress');
  assert.equal(deploymentWrites, 1);
});

test('route updates serialize the snapshot check with the write', async () => {
  const runtime = env();
  const zoneId = 'b'.repeat(32);
  const routeId = 'route-1';
  let route = { id: routeId, pattern: 'old.example/*', script: 'old-worker' };
  let routeWrites = 0;
  let releasePut!: () => void;
  let markPutStarted!: () => void;
  const putGate = new Promise<void>((resolve) => { releasePut = resolve; });
  const putStarted = new Promise<void>((resolve) => { markPutStarted = resolve; });
  const upstream: typeof fetch = githubPolicyFetch(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === '/client/v4/zones') {
      return cf([{ id: zoneId, name: 'trfny.com', status: 'active' }]);
    }
    if (url.pathname === `/client/v4/zones/${zoneId}/dns_records`) return cf([]);
    if (url.pathname === `/client/v4/zones/${zoneId}/workers/routes`) return cf([route]);
    if (url.pathname === `/client/v4/zones/${zoneId}/workers/routes/${routeId}`) {
      if (request.method === 'PUT') {
        routeWrites += 1;
        markPutStarted();
        await putGate;
        route = { id: routeId, pattern: 'a.example/*', script: 'worker-a' };
      }
      return cf(route);
    }
    return Response.json({ success: false, errors: [{ code: 9999 }] }, { status: 500 });
  });
  const actionFetch = createActionFetch(upstream);
  const inspect = await handleCloudflareAction(new Request('https://example.workers.dev/gpt-actions/cloudflare/zones/inspect', {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone: 'trfny.com' }),
  }), runtime, actionFetch);
  assert.ok(inspect);
  const inspected = await inspect.json() as { routes?: { data?: Array<{ snapshot?: string }> } };
  const expectedSnapshot = inspected.routes?.data?.[0]?.snapshot;
  assert.ok(expectedSnapshot);
  const requestFor = (pattern: string, script: string) => new Request('https://example.workers.dev/gpt-actions/cloudflare/routes/update', {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone: 'trfny.com', routeId, expectedSnapshot, pattern, script }),
  });
  const firstPromise = handleCloudflareAction(requestFor('a.example/*', 'worker-a'), runtime, createActionFetch(upstream));
  await putStarted;
  const competing = await handleCloudflareAction(requestFor('b.example/*', 'worker-b'), runtime, createActionFetch(upstream));
  assert.ok(competing);
  assert.equal(competing.status, 409);
  assert.equal((await competing.json() as { error?: string }).error, 'cloudflare_mutation_conflict');
  releasePut();
  const first = await firstPromise;
  assert.ok(first);
  assert.equal(first.status, 200);
  assert.equal(routeWrites, 1);
});

test('zone inspection paginates DNS records before returning snapshots', async () => {
  const zoneId = 'b'.repeat(32);
  const dnsPages: number[] = [];
  const upstream: typeof fetch = githubPolicyFetch((input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === `/client/v4/zones/${zoneId}`) {
      return cf({ id: zoneId, name: 'trfny.com', account: { id: ACCOUNT_ID } });
    }
    if (url.pathname === `/client/v4/zones/${zoneId}/dns_records`) {
      const page = Number(url.searchParams.get('page'));
      dnsPages.push(page);
      const record = { id: `dns-${page}`, type: 'A', name: `p${page}.trfny.com`, content: `192.0.2.${page}` };
      return Response.json({
        success: true,
        errors: [],
        messages: [],
        result: [record],
        result_info: { page, per_page: 500, total_pages: 2, total_count: 2 },
      });
    }
    if (url.pathname === `/client/v4/zones/${zoneId}/workers/routes`) return cf([]);
    return Response.json({ success: false, errors: [{ code: 9999 }] }, { status: 500 });
  });
  const request = new Request('https://example.workers.dev/gpt-actions/cloudflare/zones/inspect', {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone: zoneId }),
  });
  const response = await handleCloudflareAction(request, env(), createActionFetch(upstream));
  assert.ok(response);
  assert.equal(response.status, 200);
  const body = await response.json() as { dns?: { data?: Array<{ id?: string; snapshot?: string }> } };
  assert.deepEqual(dnsPages, [1, 2]);
  assert.deepEqual(body.dns?.data?.map((record) => record.id), ['dns-1', 'dns-2']);
  assert.ok(body.dns?.data?.every((record) => typeof record.snapshot === 'string'));
});

test('Worker inspection reads versions from the paginated items array', async () => {
  const script = 'kanarek-companion';
  const upstream: typeof fetch = githubPolicyFetch((input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === `/client/v4/accounts/${ACCOUNT_ID}/workers/scripts`) return cf([{ id: script }]);
    if (url.pathname.endsWith(`/${script}/deployments`)) return cf({ deployments: [] });
    if (url.pathname.endsWith(`/${script}/versions`)) {
      return cf({ items: [{ id: 'version-1', number: 1, metadata: { source: 'wrangler' } }] });
    }
    if (url.pathname.endsWith(`/${script}/subdomain`)) return cf({ enabled: true, previews_enabled: false });
    if (url.pathname.endsWith(`/${script}/script-settings`)) return cf({ logpush: false });
    if (url.pathname === '/client/v4/zones') return cf([]);
    return Response.json({ success: false, errors: [{ code: 9999 }] }, { status: 500 });
  });
  const request = new Request('https://example.workers.dev/gpt-actions/cloudflare/workers/inspect', {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ script }),
  });
  const response = await handleCloudflareAction(request, env(), createActionFetch(upstream));
  assert.ok(response);
  assert.equal(response.status, 200);
  const body = await response.json() as { versions?: { data?: Array<{ id?: string; number?: number }> } };
  assert.deepEqual(body.versions?.data, [{
    id: 'version-1',
    number: 1,
    createdOn: null,
    modifiedOn: null,
    source: 'wrangler',
    hasPreview: null,
  }]);
});

test('Worker inspection scans routes across every paginated account zone', async () => {
  const script = 'kanarek-companion';
  const lastZoneId = 'zone-101';
  const routeLookups: string[] = [];
  const upstream: typeof fetch = githubPolicyFetch((input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === `/client/v4/accounts/${ACCOUNT_ID}/workers/scripts`) return cf([{ id: script }]);
    if (url.pathname.endsWith(`/${script}/deployments`)) return cf({ deployments: [] });
    if (url.pathname.endsWith(`/${script}/versions`)) return cf({ items: [] });
    if (url.pathname.endsWith(`/${script}/subdomain`)) return cf({ enabled: true, previews_enabled: false });
    if (url.pathname.endsWith(`/${script}/script-settings`)) return cf({ logpush: false });
    if (url.pathname === '/client/v4/zones') {
      const page = Number(url.searchParams.get('page'));
      const start = (page - 1) * 50 + 1;
      const count = page < 3 ? 50 : 1;
      const zones = Array.from({ length: count }, (_, index) => {
        const number = start + index;
        return { id: `zone-${number}`, name: `zone-${number}.example`, status: 'active' };
      });
      return Response.json({
        success: true,
        errors: [],
        messages: [],
        result: zones,
        result_info: { page, per_page: 50, total_pages: 3, total_count: 101 },
      });
    }
    const routeMatch = url.pathname.match(/^\/client\/v4\/zones\/(zone-\d+)\/workers\/routes$/);
    if (routeMatch) {
      const zoneId = routeMatch[1];
      routeLookups.push(zoneId);
      return cf(zoneId === lastZoneId ? [{ id: 'route-last', pattern: 'last.example/*', script }] : []);
    }
    return Response.json({ success: false, errors: [{ code: 9999 }] }, { status: 500 });
  });
  const request = new Request('https://example.workers.dev/gpt-actions/cloudflare/workers/inspect', {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ script }),
  });
  const response = await handleCloudflareAction(request, env(), createActionFetch(upstream));
  assert.ok(response);
  assert.equal(response.status, 200);
  const body = await response.json() as { routes?: { data?: Array<{ zone?: { id?: string }; routes?: Array<{ id?: string }> }> } };
  assert.equal(routeLookups.length, 101);
  assert.equal(routeLookups.at(-1), lastZoneId);
  const lastZone = body.routes?.data?.find((entry) => entry.zone?.id === lastZoneId);
  assert.equal(lastZone?.routes?.[0]?.id, 'route-last');
});

test('Cloudflare overview paginates account zones with the supported page size', async () => {
  const zonePages: number[] = [];
  const upstream: typeof fetch = githubPolicyFetch((input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === '/client/v4/user/tokens/verify') return cf({ status: 'active' });
    if (url.pathname === `/client/v4/accounts/${ACCOUNT_ID}/workers/scripts`) return cf([]);
    if (url.pathname === `/client/v4/accounts/${ACCOUNT_ID}/pages/projects`) return cf([]);
    if (url.pathname === '/client/v4/zones') {
      assert.equal(url.searchParams.get('per_page'), '50');
      assert.equal(url.searchParams.get('account.id'), ACCOUNT_ID);
      const page = Number(url.searchParams.get('page'));
      zonePages.push(page);
      return Response.json({
        success: true,
        errors: [],
        messages: [],
        result: [{ id: String(page).repeat(32), name: `zone-${page}.example`, status: 'active' }],
        result_info: { page, per_page: 50, total_pages: 2, total_count: 2 },
      });
    }
    return Response.json({ success: false, errors: [{ code: 9999 }] }, { status: 500 });
  });
  const request = new Request('https://example.workers.dev/gpt-actions/cloudflare/overview', {
    headers: { Authorization: 'Bearer test' },
  });
  const response = await handleCloudflareAction(request, env(), createActionFetch(upstream));
  assert.ok(response);
  assert.equal(response.status, 200);
  const body = await response.json() as { zones?: { data?: Array<{ name?: string }> } };
  assert.deepEqual(zonePages, [1, 2]);
  assert.deepEqual(body.zones?.data?.map((zone) => zone.name), ['zone-1.example', 'zone-2.example']);
});
