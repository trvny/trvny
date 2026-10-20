import { GithubActionError, type GithubGateway } from '../../src/github-gateway.ts';
import { internalRequest, isObject } from '../../src/tools/common.ts';

// Test-only GithubGateway backed by a fake of the /gpt-actions/github/read|graphql
// routes, so existing route-shaped fixtures keep working.
export function loopbackGateway(
  source: Request,
  invoke: (request: Request) => Promise<Response>,
): GithubGateway {
  const call = async (request: Request): Promise<unknown> => {
    const response = await invoke(request);
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // non-JSON fake
    }
    if (!response.ok || !isObject(payload) || payload.ok !== true) {
      const { ok: _ok, error, ...details } = isObject(payload) ? payload : {};
      throw new GithubActionError(
        typeof error === 'string' ? error : `read_${response.status}`,
        response.status,
        details,
      );
    }
    return payload.data;
  };
  const read = (path: string) => call(internalRequest(source, '/gpt-actions/github/read', { path }));
  const unsupported = () => Promise.reject(new Error('loopbackGateway: bot not supported'));
  return {
    read,
    readOptional: async (path) => {
      try {
        return { data: await read(path) };
      } catch (error) {
        if (error instanceof GithubActionError && error.status === 404) return null;
        throw error;
      }
    },
    graphql: (query, variables) =>
      call(internalRequest(source, '/gpt-actions/github/graphql', { query, variables: variables ?? {} })),
    bot: unsupported,
    botEmpty: unsupported,
  };
}
