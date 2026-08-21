import assert from 'node:assert/strict';
import test from 'node:test';

import { paginateReviewThreadsGraphql } from '../src/review-thread-pagination.ts';

const query =
  'query($id: ID!) { node(id: $id) { ... on PullRequest { reviewThreads(first: 100) { nodes { id isResolved isOutdated comments(first: 1) { nodes { id body url author { login } } } } } } } }';

function request(bodyQuery = query): Request {
  return new Request('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query: bodyQuery, variables: { id: 'PR_test' } }),
  });
}

function threads(start: number, count: number): { id: string }[] {
  return Array.from({ length: count }, (_, index) => ({ id: `T${start + index}` }));
}

test('paginates review threads beyond the first 100 and merges nodes', async () => {
  let calls = 0;
  const cursors: unknown[] = [];
  const upstream: typeof fetch = async (input, init) => {
    calls += 1;
    const current = new Request(input, init);
    const body = await current.json() as {
      query: string;
      variables: { cursor?: unknown };
    };
    cursors.push(body.variables.cursor ?? null);
    assert.match(body.query, /\$cursor: String/);
    assert.match(body.query, /reviewThreads\(first: 100, after: \$cursor\)/);
    assert.match(body.query, /pageInfo \{ hasNextPage endCursor \}/);

    const first = calls === 1;
    return Response.json({
      data: {
        node: {
          reviewThreads: {
            nodes: first ? threads(1, 100) : threads(101, 50),
            pageInfo: {
              hasNextPage: first,
              endCursor: first ? 'cursor-100' : 'cursor-150',
            },
          },
        },
      },
    });
  };

  const response = await paginateReviewThreadsGraphql(request(), upstream);
  assert.ok(response);
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    data: { node: { reviewThreads: { nodes: { id: string }[] } } };
  };
  assert.equal(payload.data.node.reviewThreads.nodes.length, 150);
  assert.equal(payload.data.node.reviewThreads.nodes[0]?.id, 'T1');
  assert.equal(payload.data.node.reviewThreads.nodes[149]?.id, 'T150');
  assert.equal(calls, 2);
  assert.deepEqual(cursors, [null, 'cursor-100']);
});

test('ignores unrelated GraphQL requests', async () => {
  let calls = 0;
  const upstream: typeof fetch = async () => {
    calls += 1;
    return Response.json({ data: {} });
  };
  const response = await paginateReviewThreadsGraphql(
    request('query($id: ID!) { node(id: $id) { id } }'),
    upstream,
  );
  assert.equal(response, null);
  assert.equal(calls, 0);
});

test('fails closed when review thread pagination exceeds its bound', async () => {
  let calls = 0;
  const upstream: typeof fetch = async () => {
    calls += 1;
    return Response.json({
      data: {
        node: {
          reviewThreads: {
            nodes: threads((calls - 1) * 100 + 1, 100),
            pageInfo: {
              hasNextPage: true,
              endCursor: `cursor-${calls * 100}`,
            },
          },
        },
      },
    });
  };

  const response = await paginateReviewThreadsGraphql(request(), upstream);
  assert.ok(response);
  assert.equal(response.status, 502);
  assert.equal(calls, 10);
  assert.deepEqual(await response.json(), { message: 'review_thread_pagination_limit_1000' });
});
