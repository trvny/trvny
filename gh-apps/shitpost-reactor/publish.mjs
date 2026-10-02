import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PUBLISH_URL = 'https://shitpost.trfny.com/api/publish';
export const DEFAULT_AUDIENCE = 'https://shitpost.trfny.com';
const MAX_ERROR_BODY = 2_000;

export async function requestOidcToken({ requestUrl, requestToken, audience = DEFAULT_AUDIENCE, fetchImpl = fetch }) {
  if (!requestUrl || !requestToken) throw new Error('github_oidc_environment_missing');
  const url = new URL(requestUrl);
  url.searchParams.set('audience', audience);
  const response = await fetchImpl(url, {
    headers: {
      authorization: `Bearer ${requestToken}`,
      accept: 'application/json',
      'user-agent': 'trvny-shitpost-reactor/1',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`github_oidc_failed:${response.status}`);
  const payload = await response.json();
  if (typeof payload?.value !== 'string' || !payload.value) throw new Error('github_oidc_missing_token');
  return payload.value;
}

export async function publishRecord({ publishUrl = DEFAULT_PUBLISH_URL, oidcToken, record, fetchImpl = fetch }) {
  const response = await fetchImpl(publishUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${oidcToken}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'trvny-shitpost-reactor/1',
    },
    body: JSON.stringify(record),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, MAX_ERROR_BODY);
    throw new Error(`publish_failed:${response.status}:${body}`);
  }
  return response.json();
}

export async function main() {
  const outputDir = resolve(process.env.SHITPOST_OUTPUT_DIR || 'out');
  const record = JSON.parse(await readFile(resolve(outputDir, 'latest.json'), 'utf8'));
  const oidcToken = await requestOidcToken({
    requestUrl: process.env.ACTIONS_ID_TOKEN_REQUEST_URL,
    requestToken: process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    audience: process.env.SHITPOST_PUBLISH_AUDIENCE?.trim() || DEFAULT_AUDIENCE,
  });
  const result = await publishRecord({
    publishUrl: process.env.SHITPOST_PUBLISH_URL?.trim() || DEFAULT_PUBLISH_URL,
    oidcToken,
    record,
  });
  process.stdout.write(`published: ${result.url}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
