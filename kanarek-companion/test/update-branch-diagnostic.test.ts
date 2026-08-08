import assert from 'node:assert/strict';
import test from 'node:test';

import { branchUpdatePermissionWarning } from '../src/companion-update.ts';
import { render } from '../src/companion-view.ts';
import type { GitHubInstallationClient } from '../src/github-app.ts';
import type { PullRequest } from '../src/companion-types.ts';

const pr: PullRequest = {
  additions: 1,
  base: { ref: 'main', sha: 'a'.repeat(40) },
  changed_files: 1,
  deletions: 0,
  draft: false,
  head: {
    ref: 'feature',
    repo: { full_name: 'trvny/trvny' },
    sha: 'b'.repeat(40),
  },
  mergeable: true,
  mergeable_state: 'clean',
  merged: false,
  number: 164,
  state: 'open',
};

function client(permissions: Record<string, string>): GitHubInstallationClient {
  return { permissions } as unknown as GitHubInstallationClient;
}

test('reports the exact missing GitHub App permissions', () => {
  assert.equal(
    branchUpdatePermissionWarning(
      client({ contents: 'read', pull_requests: 'write' }),
    ),
    'auto-update unavailable · needs Contents write',
  );
  assert.equal(
    branchUpdatePermissionWarning(
      client({ contents: 'write', pull_requests: 'read' }),
    ),
    'auto-update unavailable · needs Pull requests write',
  );
  assert.equal(
    branchUpdatePermissionWarning(
      client({ contents: 'read', pull_requests: 'read' }),
    ),
    'auto-update unavailable · needs Contents + Pull requests write',
  );
  assert.equal(
    branchUpdatePermissionWarning(
      client({ contents: 'write', pull_requests: 'write' }),
    ),
    null,
  );
});

test('renders the permission warning in the Kanarek status comment', () => {
  const warning = branchUpdatePermissionWarning(
    client({ contents: 'read', pull_requests: 'write' }),
  );
  const body = render(
    pr,
    { behind: 1 },
    { failed: [], passed: [{}], pending: [], total: 1 },
    { approvals: 0, changes: 0 },
    ['Kanarek'],
    { key: 'waiting', title: '🟡 waiting', blockers: ['1 behind main'] },
    'The machinery is chewing. Kanarek guards the cable.',
    '0123456789abcdef',
    'fedcba9876543210',
    'preset',
    [],
    true,
    warning,
  );

  assert.match(body, /auto-update unavailable · needs Contents write/);
});
