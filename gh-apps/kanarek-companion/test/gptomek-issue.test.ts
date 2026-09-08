import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import type { CompanionEnv, CompanionTarget } from '../src/companion-types.ts';
import { commandMarker } from '../src/gptomek.ts';
import {
  GPTOMEK_CONTROL_ISSUE,
  GPTOMEK_WAKE_LABEL,
  handleGptomekIssueControl,
  isGptomekControlIssueEvent,
} from '../src/gptomek-issue.ts';
import { companionTargets, isCompanionEvent } from '../src/index.ts';

const metadata = {
  action: 'edited',
  delivery: 'issue-delivery-1',
  event: 'issues',
  installationId: 152126523,
  repository: 'trvny/trvny',
};

const payload = {
  action: 'edited',
  changes: { body: { from: 'GPTomek control mailbox.' } },
  issue: {
    body: '<!-- gptomek-command:dGVzdA -->',
    number: GPTOMEK_CONTROL_ISSUE,
    state: 'open',
    user: { login: 'trvny' },
  },
  repository: { full_name: 'trvny/trvny' },
  sender: { login: 'trvny' },
};

test('routes marked body edits or wake-label toggles of open issue #203', () => {
  assert.equal(isGptomekControlIssueEvent(metadata, payload), true);
  assert.equal(isCompanionEvent(metadata, payload), true);
  const labelMetadata = { ...metadata, action: 'labeled' };
  const labelPayload = {
    ...payload,
    action: 'labeled',
    changes: undefined,
    label: { name: GPTOMEK_WAKE_LABEL },
  };
  assert.equal(isGptomekControlIssueEvent(labelMetadata, labelPayload), true);
  assert.equal(isCompanionEvent(labelMetadata, labelPayload), true);
  assert.equal(
    isGptomekControlIssueEvent(labelMetadata, {
      ...labelPayload,
      label: { name: 'bug' },
    }),
    false,
  );
  assert.equal(
    isGptomekControlIssueEvent(metadata, {
      ...payload,
      issue: { ...payload.issue, number: 204 },
    }),
    false,
  );
  assert.equal(
    isGptomekControlIssueEvent(metadata, {
      ...payload,
      issue: { ...payload.issue, state: 'closed' },
    }),
    false,
  );
  assert.equal(
    isGptomekControlIssueEvent(metadata, {
      ...payload,
      issue: { ...payload.issue, body: 'idle' },
    }),
    false,
  );
  assert.equal(
    isGptomekControlIssueEvent(metadata, {
      ...payload,
      changes: { title: { from: 'old' } },
    }),
    false,
  );
  assert.equal(
    isGptomekControlIssueEvent(metadata, {
      ...payload,
      sender: { login: 'someone' },
    }),
    false,
  );
});

test('maps a real issues payload into the serialized control target', async () => {
  const targets = await companionTargets(
    metadata,
    payload,
    { KANAREK_REPOSITORIES: 'trvny/trvny' } as CompanionEnv,
  );
  assert.deepEqual(targets, [
    {
      delivery: 'issue-delivery-1',
      installationId: 152126523,
      pullRequestNumber: GPTOMEK_CONTROL_ISSUE,
      repository: 'trvny/trvny',
      sourceEvent: 'issues',
    },
  ]);
});

function checkpointNamespace(): DurableObjectNamespace {
  const completed = new Map<string, { inputHash: string; result: unknown }>();
  return {
    idFromName(name: string) {
      return name as unknown as DurableObjectId;
    },
    get(id: DurableObjectId) {
      const operationId = String(id);
      return {
        async fetch(input: RequestInfo | URL, init?: RequestInit) {
          const url = new URL(typeof input === 'string' ? input : input.toString());
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          if (url.pathname === '/claim') {
            const stored = completed.get(operationId);
            if (stored) {
              if (stored.inputHash !== body.inputHash) {
                return Response.json({ ok: true, state: 'input_mismatch' });
              }
              return Response.json({
                ok: true,
                state: 'complete',
                result: { status: 200, body: stored.result },
              });
            }
            return Response.json({ ok: true, state: 'claimed' });
          }
          if (url.pathname === '/complete') {
            completed.set(operationId, {
              inputHash: String(body.inputHash),
              result: body.body,
            });
            return Response.json({ ok: true });
          }
          if (url.pathname === '/release') {
            completed.delete(operationId);
            return Response.json({ ok: true, state: 'released' });
          }
          return Response.json({ error: 'unexpected_checkpoint_request' }, { status: 500 });
        },
      } as DurableObjectStub;
    },
  } as unknown as DurableObjectNamespace;
}

test('executes and clears the issue mailbox without the legacy PR shim', async () => {
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();
  const marker = commandMarker({
    id: 'issue-native-1',
    op: 'react_issue_comment',
    repository: 'trvny/trvny',
    commentId: 12345,
    reaction: 'eyes',
  });
  const issueBody = `GPTomek control mailbox.\n\n${marker}`;
  const calls: Array<{ method: string; path: string; body: string | null }> = [];
  const json = (value: unknown) =>
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  const fetcher: typeof fetch = async (input, init = {}) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const body = typeof init.body === 'string' ? init.body : null;
    calls.push({ method, path: url.pathname, body });

    if (method === 'POST' && url.pathname === '/app/installations/152126523/access_tokens') {
      return json({
        token: 'installation-token',
        expires_at: '2099-01-01T00:00:00Z',
        permissions: { issues: 'write', pull_requests: 'write', contents: 'write' },
      });
    }
    if (method === 'GET' && url.pathname === '/repos/trvny/trvny/issues/203') {
      return json({
        body: issueBody,
        number: 203,
        state: 'open',
        user: { login: 'trvny' },
      });
    }
    if (method === 'GET' && url.pathname === '/repos/trvny/trvny/installation') {
      return json({ id: 152126523 });
    }
    if (
      method === 'POST' &&
      url.pathname === '/repos/trvny/trvny/issues/comments/12345/reactions'
    ) {
      return json({ id: 1, content: 'eyes' });
    }
    if (method === 'PATCH' && url.pathname === '/repos/trvny/trvny/issues/203') {
      return json({ body: 'GPTomek control mailbox.' });
    }
    return new Response('unexpected request', { status: 500 });
  };
  const target: CompanionTarget = {
    delivery: 'issue-native-delivery',
    installationId: 152126523,
    pullRequestNumber: 203,
    repository: 'trvny/trvny',
    sourceEvent: 'issues',
  };
  const env = {
    GPTOMEK_APP_ID: '4524407',
    GPTOMEK_INSTALLATION_ID: '152126523',
    GPTOMEK_PRIVATE_KEY: privateKey,
    OPERATOR_CHECKPOINTS: checkpointNamespace(),
  } as CompanionEnv & { OPERATOR_CHECKPOINTS: DurableObjectNamespace };

  const result = await handleGptomekIssueControl(target, env, fetcher);

  assert.equal(result.changed, true);
  assert.equal(result.state, 'gptomek-control');
  assert.equal(calls.some((call) => call.path.includes('/pulls/176')), false);
  const patches = calls.filter((call) => call.method === 'PATCH');
  assert.equal(patches.length, 1);
  assert.equal(patches[0]?.path, '/repos/trvny/trvny/issues/203');
  const patched = JSON.parse(patches[0]?.body ?? '{}') as { body?: string };
  assert.match(patched.body ?? '', /^GPTomek control mailbox\.\n\n<!-- gptomek-result:/);
  assert.equal((patched.body ?? '').includes('gptomek-command:'), false);
});
