import baseWorker, { CommentProbeLock } from './index.ts';
import gremlinRouter, {
  actionFetch,
  customGptOpenApi,
  githubOAuthAuthorizationUrl,
  normalizeGptActionsRequest,
  OperatorCheckpointStore,
  restrictedBotWrite,
  type GremlinRouterEnv,
} from './gremlin-router.ts';

export {
  actionFetch,
  CommentProbeLock,
  customGptOpenApi,
  githubOAuthAuthorizationUrl,
  normalizeGptActionsRequest,
  OperatorCheckpointStore,
  restrictedBotWrite,
};

type Env = Parameters<typeof baseWorker.fetch>[1] & GremlinRouterEnv;

const worker = {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const gremlinResponse = await gremlinRouter.fetch(request, env);
    return gremlinResponse ?? baseWorker.fetch(request, env, ctx);
  },
};

export default worker;
