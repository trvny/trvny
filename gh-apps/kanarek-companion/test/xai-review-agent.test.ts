import assert from 'node:assert/strict';
import test from 'node:test';
import { agenticReviewTarget, runGrokAgentSession, requestAgenticGrokReview } from '../src/companion/xai-review-agent.ts';

const sha = 'a'.repeat(40);
const scope = { messages: [{ role: 'system', content: 'Review' }, {
  role: 'user', content: JSON.stringify({ review_scope: { repository: 'trvny/trvny', head_sha: sha },
    pull_request: { number: 17 } }),
}] };

test('agent mode requires an explicit valid repository and immutable head', () => {
  assert.deepEqual(agenticReviewTarget(scope), { repository: 'trvny/trvny', number: 17, headSha: sha });
  assert.equal(agenticReviewTarget({ messages: [{ role: 'user', content: '{}' }] }), null);
  assert.equal(agenticReviewTarget({ messages: [{ role: 'user', content: JSON.stringify({
    review_scope: { repository: 'other/private', head_sha: sha }, pull_request: { number: 17 },
  }) }] }), null);
});

test('Grok asks for source, receives evidence and returns structured findings', async () => {
  const requests: Record<string, unknown>[] = [];
  const calls: string[] = [];
  const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(request);
    if (requests.length === 1) return Response.json({
      status: 'completed', usage: { input_tokens: 100, output_tokens: 20 },
      output: [{ type: 'reasoning', encrypted_content: 'opaque' },
        { type: 'function_call', name: 'read_diff', call_id: 'c1',
          arguments: '{"path":"src/a.ts"}' }],
    });
    return Response.json({
      status: 'completed', usage: { input_tokens: 160, output_tokens: 60 },
      output: [{ type: 'message', role: 'assistant', content: [{
        type: 'output_text', text: '{"summary":"无问题","findings":[]}',
      }] }],
    });
  }) as typeof fetch;
  const result = await runGrokAgentSession({ model: 'grok-4.7', max_output_tokens: 32768,
    reasoning: { effort: 'high' } }, { repository: 'trvny/trvny', number: 17, headSha: sha },
  fetcher, async (name) => { calls.push(name); return { patch: '@@ -1 +1 @@\n-a\n+b' }; },
  'test-key', Date.now() + 30_000, [{ path: 'src/a.ts' }]);
  assert.equal(result.status, 200);
  assert.deepEqual(calls, ['read_diff']);
  assert.equal(requests[0].tool_choice, 'required');
  assert.equal(requests[0].store, false);
  assert.equal(requests[1].prompt_cache_key, requests[0].prompt_cache_key);
  const history = requests[1].input as Array<Record<string, unknown>>;
  assert.equal(history.some((part) => part.type === 'reasoning' && part.encrypted_content === 'opaque'), true);
  assert.equal(history.some((part) => part.type === 'function_call_output' && part.call_id === 'c1' &&
    String(part.output).includes('@@ -1 +1 @@')), true);
  const parsed = JSON.parse((result.payload.choices as Array<{ message: { content: string } }>)[0].message.content);
  assert.deepEqual(parsed, { summary: '无问题', findings: [] });
});

test('agentic reviews reject stale or closed PRs before any model calls', async () => {
  const sha = 'a'.repeat(40);
  const target = { repository: 'trvny/trvny', number: 17, headSha: sha };
  let modelCalls = 0;
  const fetcher = (async () => { modelCalls++; return Response.json({}); }) as typeof fetch;
  const stale = await requestAgenticGrokReview({ model: 'grok-4.7' }, target, 'dummy', {
    read: async () => ({ state: 'closed', head: { sha } }),
  }, fetcher, Date.now() + 30_000);
  assert.equal(stale.status, 409);
  assert.equal(modelCalls, 0);
});

test('paid Grok caps tool iterations and forces a final answer', async () => {
  const requests: Array<Record<string, unknown>> = [];
  let toolsCalled = 0;
  const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    if (body.tool_choice !== 'none') {
      return Response.json({
        status: 'completed',
        usage: { input_tokens: 100, output_tokens: 20 },
        output: [{ type: 'function_call', name: 'read_pr', call_id: 'c' + requests.length,
          arguments: '{}' }],
      });
    }
    return Response.json({
      status: 'completed',
      usage: { input_tokens: 150, output_tokens: 40 },
      output: [{ type: 'message', role: 'assistant', content: [{
        type: 'output_text', text: '{"summary":"无问题","findings":[]}',
      }] }],
    });
  }) as typeof fetch;
  const result = await runGrokAgentSession({ model: 'grok-4.7', max_output_tokens: 32768,
    reasoning: { effort: 'high' } }, { repository: 'trvny/trvny', number: 17, headSha: sha },
  fetcher, async () => { toolsCalled++; return { title: 'PR' }; },
  'test-key', Date.now() + 30_000, [{ path: 'src/a.ts' }]);

  assert.equal(result.status, 200);
  assert.equal(requests.length, 6);
  assert.equal(toolsCalled, 5);
  assert.equal(requests[0]?.tool_choice, 'required');
  assert.equal(requests[requests.length - 1]?.tool_choice, 'none');
  assert.deepEqual(requests[requests.length - 1]?.tools, []);
});
