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
          return Response.json({ error: 'not_found' }, { status: 404 });
        },
      } as DurableObjectStub;
    },
  } as unknown as DurableObjectNamespace;
}

function env(): Env {
  return {
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: 'cf-test-token',
    OPERATOR_CHECKPOINTS: checkpointNamespace(),
  } as Env;
}

function githubPolicyFetch(extra: typeof fetch): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === 'https://api.github.com' && url.pathname === '/user') {
      return Response.json({ login: 'trvny', id: 120686325 });
    }
    if (
      url.origin === 'https://api.github.com' &&
      url.pathname === '/repos/trvny/trvny/contents/.ai/private/openai/gremlin-policy.json'
    ) {
      return Response.json(filePayload(JSON.stringify(POLICY)));
    }
    return extra(request);
  };
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
  const upstream: typeof fetch = githubPolicyFetch(async (input, init) => {
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
    headers: { Authorization: 'Bearer github-user-token' },
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
  const upstream: typeof fetch = githubPolicyFetch(async (input, init) => {
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
      Authorization: 'Bearer github-user-token',
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
  const upstream: typeof fetch = githubPolicyFetch(async (input, init) => {
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
      Authorization: 'Bearer github-user-token',
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
  const upstream: typeof fetch = githubPolicyFetch(async (input, init) => {
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
      Authorization: 'Bearer github-user-token',
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
          id: expectedId,
          created_on: '2026-08-28T15:00:00Z',
          versions: [{ version_id: '55555555-5555-4555-8555-555555555555', percentage: 100 }],
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
        Authorization: 'Bearer github-user-token',
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
  assert.equal((await competing.json() as { error?: string }).error, 'cloudflare_rollback_conflict');
  assert.equal(deploymentWrites, 1);

  releasePost();
  const first = await firstPromise;
  assert.ok(first);
  assert.equal(first.status, 200);

  const replay = await handleCloudflareAction(requestFor(targetA), runtime, createActionFetch(upstream));
  assert.ok(replay);
  assert.equal(replay.status, 200);
  const replayPayload = await replay.json() as { operation?: { replayed?: boolean } };
  assert.equal(replayPayload.operation?.replayed, true);
  assert.equal(deploymentWrites, 1);
});

test('Pages rollback replays an identical retry without a second mutation', async () => {
  const runtime = env();
  const expectedId = '11111111-1111-4111-8111-111111111111';
  const targetId = '22222222-2222-4222-8222-222222222222';
  let rollbackWrites = 0;
  const upstream: typeof fetch = githubPolicyFetch(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname.endsWith('/pages/projects/trfny')) {
      return cf({
        id: 'project-1',
        name: 'trfny',
        canonical_deployment: {
          id: expectedId,
          environment: 'production',
        },
      });
    }
    if (url.pathname.endsWith(`/pages/projects/trfny/deployments/${targetId}`)) {
      return cf({ id: targetId, environment: 'production' });
    }
    if (url.pathname.endsWith(`/pages/projects/trfny/deployments/${targetId}/rollback`)) {
      rollbackWrites += 1;
      return cf({ id: targetId, environment: 'production' });
    }
    return Response.json({ success: false, errors: [{ code: 9999 }] }, { status: 500 });
  });
  const request = () => new Request(
    'https://example.workers.dev/gpt-actions/cloudflare/pages/rollback',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer github-user-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        project: 'trfny',
        expectedProductionDeploymentId: expectedId,
        targetDeploymentId: targetId,
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
  const payload = await replay.json() as { operation?: { replayed?: boolean } };
  assert.equal(payload.operation?.replayed, true);
  assert.equal(rollbackWrites, 1);
});
