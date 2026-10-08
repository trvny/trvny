import assert from 'node:assert/strict';
import test from 'node:test';

import { isGremlinGithubOwner } from '../src/operator-identity.ts';

test('GitHub OAuth owner identity requires both stable ID and login', () => {
  assert.equal(isGremlinGithubOwner({ login: 'trvny', id: 120686325 }), true);
  assert.equal(isGremlinGithubOwner({ login: 'trvny', id: 1 }), false);
  assert.equal(isGremlinGithubOwner({ login: 'other', id: 120686325 }), false);
  assert.equal(isGremlinGithubOwner({ login: 'trvny', id: '120686325' }), false);
  assert.equal(isGremlinGithubOwner(null), false);
  assert.equal(isGremlinGithubOwner([]), false);
  assert.equal(isGremlinGithubOwner('trvny'), false);
});
