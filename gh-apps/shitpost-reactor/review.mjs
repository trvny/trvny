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
const printSafe = (value) => JSON.stringify(value).replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ');
if (action === 'list') {
  for (const item of data.pending || []) console.log(printSafe(item));
  console.log('pending_count:', data.total);
} else if (action === 'show') {
  console.log(printSafe(data));
} else {
  console.log('review_result:', printSafe(data));
}
