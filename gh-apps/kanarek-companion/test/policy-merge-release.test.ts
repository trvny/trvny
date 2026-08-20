import assert from 'node:assert/strict';
import test from 'node:test';

import { createActionFetch } from '../src/action-context.ts';
import {
  handleMergeReleasePolicyAction,
  mergeMethodAllowedByPolicy,
  releaseComparisonContainsTarget,
} from '../src/policy-merge-release.ts';
import type { GremlinPolicy } from '../src/policy-actions.ts';

type Env = Parameters<typeof handleMergeReleasePolicyAction>[1];

const POLICY: GremlinPolicy = {
  version: 1,
  model: {
    autonomy: 'high',
    operatingMode: 'act_then_report',
    stopConditions: ['missing_credentials_or_permissions'],
    preferredActions: ['finalizePullRequest', 'releaseAsGptomek'],
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

function filePayload(content: string): Record<string, unknown> {
  return {
    encoding: 'base64',
    content: btoa(content),
    sha: '1'.repeat(40),
  };
}

function policyFetch(extra: (url: URL, request: Request) => Response | null): typeof fetch {
  return createActionFetch(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === '/user') {
      return Response.json({ login: 'trvny', id: 120686325 });
    }
    if (url.pathname === '/repos/trvny/trvny/contents/.ai/private/openai/gremlin-policy.json') {
      return Response.json(filePayload(JSON.stringify(POLICY)));
    }
    if (url.pathname === '/repos/trvny/feedseek') {
      return Response.json({ full_name: 'trvny/feedseek', default_branch: 'main', archived: false });
    }
    return extra(url, request) ?? Response.json({ message: 'unexpected' }, { status: 500 });
  });
}

test('merge policy selects its method and rejects a conflicting request', () => {
  assert.deepEqual(mergeMethodAllowedByPolicy('squash', undefined), {
    allowed: true,
    method: 'squash',
  });
  assert.deepEqual(mergeMethodAllowedByPolicy('squash', 'squash'), {
    allowed: true,
    method: 'squash',
  });
  assert.deepEqual(mergeMethodAllowedByPolicy('squash', 'merge'), {
    allowed: false,
    method: 'squash',
  });
});

test('release target comparison accepts only a commit contained in the allowed branch', () => {
  const target = 'a'.repeat(40);
  assert.equal(
    releaseComparisonContainsTarget(
      { status: 'ahead', merge_base_commit: { sha: target } },
      target,
    ),
    true,
  );
  assert.equal(
    releaseComparisonContainsTarget(
      { status: 'identical', merge_base_commit: { sha: target } },
      target,
    ),
    true,
  );
  assert.equal(
    releaseComparisonContainsTarget(
      { status: 'diverged', merge_base_commit: { sha: 'b'.repeat(40) } },
      target,
    ),
    false,
  );
});

test('finalize route blocks a merge method that conflicts with private policy', async () => {
  let pullReads = 0;
  const fetcher = policyFetch((url) => {
    if (url.pathname.includes('/pulls/')) pullReads += 1;
    return null;
  });
  const request = new Request(
    'https://example.workers.dev/gpt-actions/github/pull-requests/finalize',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer policy-user-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        repository: 'trvny/feedseek',
        pullRequestNumber: 7,
        expectedHeadSha: 'a'.repeat(40),
        mergeMethod: 'merge',
      }),
    },
  );

  const response = await handleMergeReleasePolicyAction(request, {} as Env, fetcher);
  assert.ok(response);
  assert.equal(response.status, 403);
  const payload = await response.json() as { error: string; requested: string; required: string };
  assert.equal(payload.error, 'merge_method_not_allowed_by_policy');
  assert.equal(payload.requested, 'merge');
  assert.equal(payload.required, 'squash');
  assert.equal(pullReads, 0);
});

test('release route blocks a target not contained in an allowed branch', async () => {
  const target = 'a'.repeat(40);
  const fetcher = policyFetch((url) => {
    if (url.pathname === `/repos/trvny/feedseek/compare/${target}...main`) {
      return Response.json({
        status: 'diverged',
        merge_base_commit: { sha: 'b'.repeat(40) },
      });
    }
    return null;
  });
  const request = new Request('https://example.workers.dev/gpt-actions/github/releases/manage', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer policy-user-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      repository: 'trvny/feedseek',
      tag: 'v1.0.0',
      targetSha: target,
    }),
  });

  const response = await handleMergeReleasePolicyAction(request, {} as Env, fetcher);
  assert.ok(response);
  assert.equal(response.status, 403);
  const payload = await response.json() as {
    error: string;
    targetSha: string;
    allowedBranches: string[];
  };
  assert.equal(payload.error, 'release_target_not_allowed_by_policy');
  assert.equal(payload.targetSha, target);
  assert.deepEqual(payload.allowedBranches, ['main']);
});
