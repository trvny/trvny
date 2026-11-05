'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { digestTarget, workflowGate, resolveNumber } = require('./coczydziennik-publish.cjs');
const pr = {
  state: 'open', draft: false, base: { ref: 'main' }, user: { login: 'trvny' },
  head: { ref: 'content/coczydziennik-2026-11-08', repo: { full_name: 'trvny/trvny' } },
};
const file = { filename: 'pages/astro/src/content/digests/2026-11-08.md' };
test('accept one digest on matching trusted branch', () => {
  assert.deepEqual(digestTarget(pr, [file]), { date: '2026-11-08', path: file.filename });
});
test('never republish an issue by renaming its source file', () => {
  assert.equal(digestTarget(pr, [{ ...file, status: 'renamed', previous_filename: 'pages/astro/src/content/digests/2026-11-05.md' }]), null);
});
test('reject extra files and incorrect source date', () => {
  assert.equal(digestTarget(pr, [file, { filename: '.github/workflows/x.yml' }]), null);
  assert.equal(digestTarget(pr, [{ filename: 'pages/astro/src/content/digests/2026-11-11.md' }]), null);
});
test('reject forks, user mismatch, drafts and other branches', () => {
  assert.equal(digestTarget({ ...pr, user: { login: 'stranger' } }, [file]), null);
  assert.equal(digestTarget({ ...pr, draft: true }, [file]), null);
  assert.equal(digestTarget({ ...pr, head: { ...pr.head, repo: { full_name: 'stranger/trvny' } } }, [file]), null);
});
const run = (name, conclusion, sha = 'abc') => ({ name, status: 'completed', conclusion, head_sha: sha, event: 'pull_request', created_at: '2026-11-08T20:00:00Z' });
test('both success workflows required on exact final sha', () => {
  assert.equal(workflowGate([run('TRAVNY Pages','success'), run('MegaLinter','success')], 'abc').ready, true);
  assert.equal(workflowGate([run('TRAVNY Pages','success')], 'abc').pending, true);
  assert.equal(workflowGate([run('TRAVNY Pages','success'), run('MegaLinter','failure')], 'abc').ready, false);
  assert.equal(workflowGate([run('TRAVNY Pages','success'), run('MegaLinter','success', 'other')], 'abc').pending, true);
});
test('choose PR number from review; ignore untrusted dispatch input', () => {
  assert.equal(resolveNumber({ payload: { pull_request: { number: 18 } } }), 18);
  assert.equal(resolveNumber({ payload: { inputs: { pr: '19' } } }), null);
  assert.equal(resolveNumber({ payload: { workflow_run: {} } }), null);
});
