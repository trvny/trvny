import assert from 'node:assert/strict';
import test from 'node:test';

import { createActionFetch } from '../src/action-context.ts';
import {
  handlePolicyAction,
  parseGremlinPolicy,
  type GremlinPolicy,
} from '../src/policy-actions.ts';
import { customGptOpenApi } from '../src/router.ts';

type Env = Parameters<typeof handlePolicyAction>[1];

const POLICY: GremlinPolicy = {
  version: 1,
  model: {
    autonomy: 'high',
    operatingMode: 'act_then_report',
    stopConditions: [
      'missing_credentials_or_permissions',
      'material_product_decision_required',
    ],
    preferredActions: ['getOperatorBootstrap', 'prepareChange', 'finalizePullRequest'],
  },
  runtime: {
    repositories: {
      include: ['trvny/*'],
      exclude: [],
      skipArchived: true,
    },
    maintenance: {
      autofix: true,
      maxRepositoriesPerRun: 8,
      maxFixesPerRun: 12,
      workflowRetries: 1,
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
    release: {
      allowedBranches: ['main'],
      requireExpectedTargetSha: true,
    },
  },
};

const STYLE_PROFILE = `schemaVersion: "0.2"
id: gremlin-private
locale: pl-PL

personality:
  base: cynical
  intensity: 2
  modifiers:
    concise: 2
    technical: 2
    critical: 2
    whimsical: 2
    cynical: 3

collaboration:
  preamble: multiStepOnly
  initiative: proactive
  verification: strict
  questionPolicy: blockingOnly
  assumptionPolicy: decisive
`;


const KNOWLEDGE_MANIFEST = {
  version: 1,
  topics: {
    brainrot: {
      path: '.ai/private/openai/knowledge/brainrot.md',
      aliases: ['brainrotlang'],
      description: 'Brainrot expert reference.',
    },
    rickroll: {
      path: '.ai/private/openai/knowledge/rickroll.md',
      aliases: ['rick', 'rick-lang', 'rickroll-lang'],
      description: 'Rickroll-Lang expert reference.',
    },
  },
};

const BRAINROT_KNOWLEDGE = '# Brainrot\n\nUse `rizz` for integers.\n';

function filePayload(content: string, sha: string): Record<string, unknown> {
  return {
    encoding: 'base64',
    content: btoa(content),
    sha,
  };
}

test('operator bootstrap and specialist knowledge are exposed in Custom GPT OpenAPI', () => {
  const document = customGptOpenApi('https://example.workers.dev') as {
    paths: Record<string, Record<string, { operationId?: string; description?: string }>>;
  };
  const operations = Object.values(document.paths).flatMap((path) => Object.values(path));
  const bootstrap = operations.find((operation) => operation.operationId === 'getOperatorBootstrap');
  const knowledge = operations.find((operation) => operation.operationId === 'getGremlinKnowledge');

  assert.ok(bootstrap);
  assert.ok(knowledge);
  assert.ok(!bootstrap.description || bootstrap.description.length <= 300);
  assert.ok(!knowledge.description || knowledge.description.length <= 300);
});

test('Gremlin policy parser rejects unknown keys and unsafe limits', () => {
  assert.deepEqual(parseGremlinPolicy(POLICY), POLICY);

  const unknown = structuredClone(POLICY) as GremlinPolicy & {
    runtime: GremlinPolicy['runtime'] & { surprise?: boolean };
  };
  unknown.runtime.surprise = true;
  assert.throws(() => parseGremlinPolicy(unknown), /invalid_policy_runtime_surprise/);

  const excessive = structuredClone(POLICY);
  excessive.runtime.maintenance.workflowRetries = 9;
  assert.throws(
    () => parseGremlinPolicy(excessive),
    /invalid_policy_runtime_maintenance_workflow_retries/,
  );

  const tinyCache = structuredClone(POLICY);
  tinyCache.runtime.maintenance.cacheMaxBytes = 1024;
  assert.throws(
    () => parseGremlinPolicy(tinyCache),
    /invalid_policy_runtime_maintenance_cache_max_bytes/,
  );
});

test('Gremlin policy parser accepts strict per-repository maintenance overrides', () => {
  const configured = structuredClone(POLICY);
  configured.runtime.maintenance.repositoryOverrides = [
    {
      repository: 'trvny/trvny',
      autofix: false,
      workflowRetries: 0,
      cacheMaxBytes: 2 * 1024 * 1024 * 1024,
      cacheStaleDays: 10,
    },
  ];
  assert.deepEqual(parseGremlinPolicy(configured), configured);

  configured.runtime.maintenance.repositoryOverrides.push({
    repository: 'trvny/trvny',
  });
  assert.throws(
    () => parseGremlinPolicy(configured),
    /invalid_policy_runtime_maintenance_repository_overrides_duplicate/,
  );
});

test('operator bootstrap loads private policy, style and repository guidance with one OAuth user check', async () => {
  const calls: string[] = [];
  const upstream: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push(`${request.method} ${url.pathname}${url.search}`);

    if (url.pathname === '/user') {
      return Response.json({ login: 'trvny', id: 120686325 });
    }
    if (url.pathname === '/repos/trvny/trvny/contents/.ai/private/openai/gremlin-policy.json') {
      assert.equal(url.searchParams.get('ref'), 'main');
      return Response.json(filePayload(JSON.stringify(POLICY), '1'.repeat(40)));
    }
    if (url.pathname === '/repos/trvny/trvny/contents/.ai/private/openai/gremlin-profile.yaml') {
      assert.equal(url.searchParams.get('ref'), 'main');
      return Response.json(filePayload(STYLE_PROFILE, '3'.repeat(40)));
    }
    if (url.pathname === '/repos/trvny/feedseek') {
      return Response.json({
        full_name: 'trvny/feedseek',
        default_branch: 'main',
        archived: false,
        private: false,
        html_url: 'https://github.com/trvny/feedseek',
      });
    }
    if (url.pathname === '/repos/trvny/feedseek/contents/AGENTS.md') {
      assert.equal(url.searchParams.get('ref'), 'main');
      return Response.json(filePayload('# AGENTS\n\nKeep it tidy.\n', '2'.repeat(40)));
    }
    return Response.json({ message: 'unexpected' }, { status: 500 });
  };

  const request = new Request('https://example.workers.dev/gpt-actions/operator/bootstrap', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer policy-user-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ repository: 'trvny/feedseek' }),
  });

  const response = await handlePolicyAction(request, {} as Env, createActionFetch(upstream));
  assert.ok(response);
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    policy: GremlinPolicy;
    styleProfile: {
      source: { repository: string; path: string; ref: string; sha: string };
      format: string;
      content: string;
    };
    stopConditions: string[];
    capabilities: string[];
    repository: {
      name: string;
      defaultBranch: string;
      instructions: { rootAgentsMarkdown: string | null };
    };
  };

  assert.equal(payload.policy.model.autonomy, 'high');
  assert.deepEqual(payload.stopConditions, POLICY.model.stopConditions);
  assert.equal(payload.styleProfile.format, 'yaml');
  assert.equal(payload.styleProfile.source.path, '.ai/private/openai/gremlin-profile.yaml');
  assert.match(payload.styleProfile.content, /base: cynical/);
  assert.match(payload.styleProfile.content, /initiative: proactive/);
  assert.ok(payload.capabilities.includes('operator_style_profile'));
  assert.equal(payload.repository.name, 'trvny/feedseek');
  assert.equal(payload.repository.defaultBranch, 'main');
  assert.match(payload.repository.instructions.rootAgentsMarkdown ?? '', /Keep it tidy/);
  assert.equal(calls.filter((call) => call === 'GET /user').length, 1);
});

test('specialist knowledge resolves aliases through the private manifest', async () => {
  const calls: string[] = [];
  const upstream: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push(`${request.method} ${url.pathname}${url.search}`);

    if (url.pathname === '/user') {
      return Response.json({ login: 'trvny', id: 120686325 });
    }
    if (url.pathname === '/repos/trvny/trvny/contents/.ai/private/openai/gremlin-knowledge.json') {
      assert.equal(url.searchParams.get('ref'), 'main');
      return Response.json(filePayload(JSON.stringify(KNOWLEDGE_MANIFEST), '4'.repeat(40)));
    }
    if (url.pathname === '/repos/trvny/trvny/contents/.ai/private/openai/knowledge/brainrot.md') {
      assert.equal(url.searchParams.get('ref'), 'main');
      return Response.json(filePayload(BRAINROT_KNOWLEDGE, '5'.repeat(40)));
    }
    return Response.json({ message: 'unexpected' }, { status: 500 });
  };

  const request = new Request('https://example.workers.dev/gpt-actions/operator/knowledge', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer policy-user-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ topic: 'brainrotlang' }),
  });

  const response = await handlePolicyAction(request, {} as Env, createActionFetch(upstream));
  assert.ok(response);
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    topic: string;
    requestedTopic: string;
    format: string;
    content: string;
    source: { path: string; sha: string };
  };

  assert.equal(payload.topic, 'brainrot');
  assert.equal(payload.requestedTopic, 'brainrotlang');
  assert.equal(payload.format, 'markdown');
  assert.equal(payload.content, BRAINROT_KNOWLEDGE);
  assert.equal(payload.source.path, '.ai/private/openai/knowledge/brainrot.md');
  assert.equal(calls.filter((call) => call === 'GET /user').length, 1);
});

test('specialist knowledge rejects manifest paths outside the private knowledge directory', async () => {
  const unsafeManifest = structuredClone(KNOWLEDGE_MANIFEST);
  unsafeManifest.topics.brainrot.path = '../../AGENTS.md';

  const upstream: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === '/user') {
      return Response.json({ login: 'trvny', id: 120686325 });
    }
    if (url.pathname === '/repos/trvny/trvny/contents/.ai/private/openai/gremlin-knowledge.json') {
      return Response.json(filePayload(JSON.stringify(unsafeManifest), '6'.repeat(40)));
    }
    return Response.json({ message: 'unexpected' }, { status: 500 });
  };

  const request = new Request('https://example.workers.dev/gpt-actions/operator/knowledge', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer policy-user-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ topic: 'brainrot' }),
  });

  const response = await handlePolicyAction(request, {} as Env, createActionFetch(upstream));
  assert.ok(response);
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: 'invalid_knowledge_manifest_topic_brainrot_path',
  });
});

test('specialist knowledge treats inherited object properties as unknown topics', async () => {
  const upstream: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === '/user') {
      return Response.json({ login: 'trvny', id: 120686325 });
    }
    if (url.pathname === '/repos/trvny/trvny/contents/.ai/private/openai/gremlin-knowledge.json') {
      return Response.json(filePayload(JSON.stringify(KNOWLEDGE_MANIFEST), '7'.repeat(40)));
    }
    return Response.json({ message: 'unexpected' }, { status: 500 });
  };

  const request = new Request('https://example.workers.dev/gpt-actions/operator/knowledge', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer policy-user-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ topic: 'constructor' }),
  });

  const response = await handlePolicyAction(request, {} as Env, createActionFetch(upstream));
  assert.ok(response);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { ok: false, error: 'knowledge_topic_not_found' });
});

test('legacy Gremlin policy defaults Cloudflare operator off', () => {
  const legacy = structuredClone(POLICY) as unknown as {
    runtime: Record<string, unknown>;
  };
  delete legacy.runtime.cloudflare;

  const parsed = parseGremlinPolicy(legacy);
  assert.equal(parsed.runtime.cloudflare.enabled, false);
  assert.deepEqual(parsed.runtime.cloudflare.mutations, {
    workerRollback: false,
    pagesRollback: false,
    workerSubdomain: false,
    routeUpdate: false,
    dnsUpdate: false,
  });
});
