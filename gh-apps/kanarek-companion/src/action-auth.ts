import { isObject } from './tools/common.ts';
import { GithubActionError, type GithubGateway } from './gptomek/github-gateway.ts';
import { json } from './json-response.ts';

export type ActionInvoke = (request: Request) => Promise<Response>;

const EXPECTED_OPERATOR = 'trvny';

// Caller must be the operator. Gateway failure -> the read route's envelope/status.
export async function authorizeOperator(github: GithubGateway): Promise<Response | null> {
  let data: unknown;
  try {
    data = await github.read('/user');
  } catch (error) {
    if (error instanceof GithubActionError) return json(error.envelope(), error.status);
    throw error;
  }
  if (!isObject(data) || data.login !== EXPECTED_OPERATOR) {
    return json({ ok: false, error: 'operator_not_allowed' }, 403);
  }
  return null;
}
