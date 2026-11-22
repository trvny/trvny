import { requestOidcToken } from './publish.mjs';
import { WORKER_ORIGIN } from './urls.mjs';

const actions = new Set(['list', 'show', 'approve', 'reject']);
const action = process.env.SHITPOST_REVIEW_ACTION;
const id = process.env.SHITPOST_SUBMISSION_ID?.trim() || '';
if (!actions.has(action)) throw Error('review_action_invalid');
if (action !== 'list' && !/^s-\d{8}-[a-f0-9-]{36}$/u.test(id)) {
  throw Error('submission_id_invalid');
}
const token = await requestOidcToken({
  requestUrl: process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
  requestToken: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
});
const url = action === 'list' ? WORKER_ORIGIN + '/api/submissions'
  : WORKER_ORIGIN + '/api/submissions/' + encodeURIComponent(id)
    + (action === 'approve' || action === 'reject' ? '/' + action : '');
const response = await fetch(url, {
  method: action === 'approve' || action === 'reject' ? 'POST' : 'GET',
  headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
  signal: AbortSignal.timeout(30000),
});
const data = await response.json().catch(() => ({ error: 'invalid_response' }));
if (!response.ok || data.ok === false) throw Error('review_failed:' + response.status + ':' + String(data.error || 'unknown'));
// Public Actions logs must never disclose private draft text, titles or attribution.
// Review the full JSON privately in Cloudflare R2 before entering a decision.
if (action === 'list') {
  for (const item of data.pending || []) {
    console.log('submission:', item.id, 'status:', item.status, 'submitted_at:', item.submitted_at);
  }
  console.log('pending_count:', data.total);
} else if (action === 'show') {
  console.log('Open this private object in Cloudflare R2 (bucket shitpost-reactor):');
  console.log('submissions/pending/' + id + '.json');
  console.log('No draft content is printed to public GitHub Actions logs.');
} else {
  console.log('decision:', data.status, 'submission_id:', data.id,
    ...(data.url ? ['post_url:', data.url] : []));
}
