import { ToolError, appIdentity, graphql, rest, type GitHubEnv } from './github.ts';

type Args = Record<string, unknown>;

const REACTIONS = ['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes'] as const;
const GRAPHQL_REACTIONS: Record<string, string> = {
  '+1': 'THUMBS_UP',
  '-1': 'THUMBS_DOWN',
  laugh: 'LAUGH',
  confused: 'CONFUSED',
  heart: 'HEART',
  hooray: 'HOORAY',
  rocket: 'ROCKET',
  eyes: 'EYES',
};

export function str(args: Args, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) throw new ToolError(`${key} must be a non-empty string`);
  return value;
}

export function int(args: Args, key: string): number {
  const value = args[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new ToolError(`${key} must be a positive integer`);
  }
  return value;
}

function repoPath(args: Args): { owner: string; base: string } {
  const owner = str(args, 'owner');
  const repo = str(args, 'repo');
  return { owner, base: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` };
}

const repoProps = {
  owner: { type: 'string', description: 'Repository owner, e.g. trvny or travnie.' },
  repo: { type: 'string', description: 'Repository name.' },
} as const;

const write = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

export const TOOLS = [
  {
    name: 'whoami',
    description: 'Show the bot identity, app permissions and installations. Use to verify setup.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'comment',
    description: 'Post a comment on an issue or pull request conversation as claudiusz69[bot].',
    inputSchema: {
      type: 'object',
      properties: { ...repoProps, number: { type: 'integer', description: 'Issue or PR number.' }, body: { type: 'string' } },
      required: ['owner', 'repo', 'number', 'body'],
      additionalProperties: false,
    },
    annotations: write,
  },
  {
    name: 'edit_comment',
    description: 'Edit an issue/PR conversation comment previously posted by the bot.',
    inputSchema: {
      type: 'object',
      properties: { ...repoProps, comment_id: { type: 'integer' }, body: { type: 'string' } },
      required: ['owner', 'repo', 'comment_id', 'body'],
      additionalProperties: false,
    },
    annotations: { ...write, idempotentHint: true },
  },
  {
    name: 'react',
    description:
      'Add an emoji reaction. target=issue (issue or PR itself, needs number), issue_comment or ' +
      'review_comment (needs comment_id), node (any GraphQL node id, e.g. a discussion or discussion comment).',
    inputSchema: {
      type: 'object',
      properties: {
        ...repoProps,
        target: { type: 'string', enum: ['issue', 'issue_comment', 'review_comment', 'node'] },
        number: { type: 'integer' },
        comment_id: { type: 'integer' },
        node_id: { type: 'string' },
        content: { type: 'string', enum: [...REACTIONS] },
      },
      required: ['owner', 'repo', 'target', 'content'],
      additionalProperties: false,
    },
    annotations: { ...write, idempotentHint: true },
  },
  {
    name: 'reply_review_comment',
    description: 'Reply in a pull request review thread, identified by any comment id in that thread.',
    inputSchema: {
      type: 'object',
      properties: { ...repoProps, pull_number: { type: 'integer' }, comment_id: { type: 'integer' }, body: { type: 'string' } },
      required: ['owner', 'repo', 'pull_number', 'comment_id', 'body'],
      additionalProperties: false,
    },
    annotations: write,
  },
  {
    name: 'review',
    description: 'Submit a pull request review (APPROVE, REQUEST_CHANGES or COMMENT).',
    inputSchema: {
      type: 'object',
      properties: {
        ...repoProps,
        pull_number: { type: 'integer' },
        event: { type: 'string', enum: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'] },
        body: { type: 'string', description: 'Required for REQUEST_CHANGES and COMMENT.' },
      },
      required: ['owner', 'repo', 'pull_number', 'event'],
      additionalProperties: false,
    },
    annotations: write,
  },
  {
    name: 'resolve_thread',
    description: 'Resolve or unresolve a pull request review thread by its GraphQL thread id (PRRT_...).',
    inputSchema: {
      type: 'object',
      properties: { ...repoProps, thread_id: { type: 'string' }, unresolve: { type: 'boolean' } },
      required: ['owner', 'repo', 'thread_id'],
      additionalProperties: false,
    },
    annotations: { ...write, idempotentHint: true },
  },
  {
    name: 'discussion_comment',
    description: 'Comment on a GitHub Discussion by number; reply_to_id (DC_... node id) posts a threaded reply.',
    inputSchema: {
      type: 'object',
      properties: { ...repoProps, number: { type: 'integer' }, body: { type: 'string' }, reply_to_id: { type: 'string' } },
      required: ['owner', 'repo', 'number', 'body'],
      additionalProperties: false,
    },
    annotations: write,
  },
] as const;

export type ToolName = (typeof TOOLS)[number]['name'];

interface Html {
  id?: number | string;
  node_id?: string;
  html_url?: string;
}

const brief = (value: Html) => ({ id: value.id, node_id: value.node_id, url: value.html_url });

export async function callTool(env: GitHubEnv, name: string, args: Args): Promise<unknown> {
  switch (name) {
    case 'whoami':
      return appIdentity(env);

    case 'comment': {
      const { owner, base } = repoPath(args);
      const created = await rest<Html>(env, owner, 'POST', `${base}/issues/${int(args, 'number')}/comments`, 'comment', {
        body: str(args, 'body'),
      });
      return brief(created);
    }

    case 'edit_comment': {
      const { owner, base } = repoPath(args);
      const updated = await rest<Html>(env, owner, 'PATCH', `${base}/issues/comments/${int(args, 'comment_id')}`, 'edit comment', {
        body: str(args, 'body'),
      });
      return brief(updated);
    }

    case 'react': {
      const { owner, base } = repoPath(args);
      const content = str(args, 'content');
      if (!(REACTIONS as readonly string[]).includes(content)) throw new ToolError(`unsupported reaction: ${content}`);
      const target = str(args, 'target');
      if (target === 'node') {
        await graphql(
          env,
          owner,
          'mutation($id:ID!,$c:ReactionContent!){addReaction(input:{subjectId:$id,content:$c}){reaction{content}}}',
          { id: str(args, 'node_id'), c: GRAPHQL_REACTIONS[content] },
          'react',
        );
        return { ok: true };
      }
      const path =
        target === 'issue'
          ? `${base}/issues/${int(args, 'number')}/reactions`
          : target === 'issue_comment'
            ? `${base}/issues/comments/${int(args, 'comment_id')}/reactions`
            : target === 'review_comment'
              ? `${base}/pulls/comments/${int(args, 'comment_id')}/reactions`
              : null;
      if (!path) throw new ToolError(`unknown target: ${target}`);
      const reaction = await rest<{ id?: number; content?: string }>(env, owner, 'POST', path, 'react', { content });
      return { id: reaction.id, content: reaction.content };
    }

    case 'reply_review_comment': {
      const { owner, base } = repoPath(args);
      const created = await rest<Html>(
        env,
        owner,
        'POST',
        `${base}/pulls/${int(args, 'pull_number')}/comments/${int(args, 'comment_id')}/replies`,
        'reply review comment',
        { body: str(args, 'body') },
      );
      return brief(created);
    }

    case 'review': {
      const { owner, base } = repoPath(args);
      const event = str(args, 'event');
      if (!['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(event)) throw new ToolError(`unknown event: ${event}`);
      const body = typeof args.body === 'string' ? args.body : undefined;
      if (event !== 'APPROVE' && !body?.trim()) throw new ToolError(`body is required for ${event}`);
      const review = await rest<Html & { state?: string }>(
        env,
        owner,
        'POST',
        `${base}/pulls/${int(args, 'pull_number')}/reviews`,
        'review',
        { event, ...(body ? { body } : {}) },
      );
      return { ...brief(review), state: review.state };
    }

    case 'resolve_thread': {
      const { owner } = repoPath(args);
      const mutation = args.unresolve === true ? 'unresolveReviewThread' : 'resolveReviewThread';
      const data = await graphql<Record<string, { thread?: { isResolved?: boolean } }>>(
        env,
        owner,
        `mutation($id:ID!){${mutation}(input:{threadId:$id}){thread{isResolved}}}`,
        { id: str(args, 'thread_id') },
        mutation,
      );
      return { isResolved: data[mutation]?.thread?.isResolved };
    }

    case 'discussion_comment': {
      const { owner } = repoPath(args);
      const found = await graphql<{ repository?: { discussion?: { id?: string } } }>(
        env,
        owner,
        'query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){discussion(number:$n){id}}}',
        { o: owner, r: str(args, 'repo'), n: int(args, 'number') },
        'find discussion',
      );
      const discussionId = found.repository?.discussion?.id;
      if (!discussionId) throw new ToolError('discussion not found');
      const replyTo = typeof args.reply_to_id === 'string' && args.reply_to_id ? args.reply_to_id : undefined;
      const data = await graphql<{ addDiscussionComment?: { comment?: { id?: string; url?: string } } }>(
        env,
        owner,
        'mutation($d:ID!,$b:String!,$r:ID){addDiscussionComment(input:{discussionId:$d,body:$b,replyToId:$r}){comment{id url}}}',
        { d: discussionId, b: str(args, 'body'), r: replyTo ?? null },
        'discussion comment',
      );
      return { node_id: data.addDiscussionComment?.comment?.id, url: data.addDiscussionComment?.comment?.url };
    }

    default:
      throw new ToolError(`unknown tool: ${name}`);
  }
}
