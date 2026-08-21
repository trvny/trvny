import { runWithActionRequestContext } from './action-context.ts';
import { enrichConflictResponse } from './conflict-response.ts';
import worker, {
  actionFetch,
  CommentProbeLock,
  OperatorCheckpointStore,
} from './entry.ts';

export { actionFetch, CommentProbeLock, OperatorCheckpointStore };

type Env = Parameters<typeof worker.fetch>[1];

const runtime = {
  fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    return runWithActionRequestContext(async () => {
      const response = await worker.fetch(request, env, ctx);
      return enrichConflictResponse(
        request,
        response,
        (internalRequest) => worker.fetch(internalRequest, env, ctx),
      );
    });
  },
};

export default runtime;
