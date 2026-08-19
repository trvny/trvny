import baseWorker, { CommentProbeLock } from './index.ts';
import { handleGptActions } from './gpt-actions.ts';

export { CommentProbeLock };

type BaseEnv = Parameters<typeof baseWorker.fetch>[1];

const worker = {
  async fetch(
    request: Request,
    env: BaseEnv,
    ctx?: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/gpt-actions' || url.pathname.startsWith('/gpt-actions/')) {
      return handleGptActions(request, env);
    }
    return baseWorker.fetch(request, env, ctx);
  },
};

export default worker;
