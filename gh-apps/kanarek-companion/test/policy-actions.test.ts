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

function filePayload(content: string, sha: string): Record<string, unknown> {
  return {
    encoding: 'base64',
    content: btoa(content),
    sha,
  };
}

test('operator bootstrap is exposed in Custom GPT OpenAPI', () => {
  const document = customGptOpenApi('https://example.workers.dev') as {
    paths: Record<string, Record<string, { operationId?: string; description?: string }>>;
  };
  const operations = Object.values(document.paths).flatMap((path) => Object.values(path));
  const bootstrap = operations.find((operation) => operation.operationId === 'getOperatorBootstrap');

  assert.ok(bootstrap);
  assert.ok(!bootstrap.description || bootstrap.description.length <= 300);
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
});

test('operator bootstrap loads private policy and repository guidance with one OAuth user check', async () => {
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
    stopConditions: string[];
    repository: {
      name: string;
      defaultBranch: string;
      instructions: { rootAgentsMarkdown: string | null };
    };
  };

  assert.equal(payload.policy.model.autonomy, 'high');
  assert.deepEqual(payload.stopConditions, POLICY.model.stopConditions);
  assert.equal(payload.repository.name, 'trvny/feedseek');
  assert.equal(payload.repository.defaultBranch, 'main');
  assert.match(payload.repository.instructions.rootAgentsMarkdown ?? '', /Keep it tidy/);
  assert.equal(calls.filter((call) => call === 'GET /user').length, 1);
});
