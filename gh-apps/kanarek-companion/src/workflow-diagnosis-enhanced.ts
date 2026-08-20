import { handleGptActions, type GptActionsEnv } from './gpt-actions.ts';
import { handleOperatorAction } from './operator-actions.ts';

const READ_PATH = '/gpt-actions/github/read';
const DIAGNOSE_RUN_PATH = '/gpt-actions/github/workflows/diagnose';
const MAX_LOG_JOBS = 3;
const MAX_EXCERPT_CHARS = 12_000;
const TAIL_LINES = 100;
const SIGNAL_WINDOW_BEFORE = 4;
const SIGNAL_WINDOW_AFTER = 8;
const MAX_SIGNAL_WINDOWS = 12;
const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const FAILURE_SIGNAL_RE = /(?:^|[\s:])(error|fatal|exception|traceback|failed|failure|assertionerror|panic|npm err!|::error\b|ts\d{4}:)/i;

type JsonObject = Record<string, unknown>;

export interface FailureFocusedExcerpt {
  excerpt: string;
  strategy: 'failure-signals-plus-tail' | 'tail-only';
  sourceLineCount: number;
  selectedLineCount: number;
  matchedSignals: number;
  truncated: boolean;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function internalReadRequest(source: Request, path: string): Request {
  const url = new URL(source.url);
  url.pathname = READ_PATH;
  url.search = '';
  const headers = new Headers(source.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path }),
  });
}

async function readLogText(
  source: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  path: string,
): Promise<{ text: string | null; error: string | null }> {
  const response = await handleGptActions(internalReadRequest(source, path), env, fetcher);
  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    return { text: null, error: 'invalid_action_response' };
  }
  if (!isObject(payload)) return { text: null, error: 'invalid_action_response' };
  if (!response.ok) {
    return {
      text: null,
      error: typeof payload.error === 'string' ? payload.error : `http_${response.status}`,
    };
  }
  const data = isObject(payload.data) ? payload.data : null;
  return {
    text: data && typeof data.text === 'string' ? data.text : null,
    error: null,
  };
}

function lineIndexesAroundSignals(lines: string[]): { indexes: Set<number>; matchedSignals: number } {
  const signalIndexes: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (FAILURE_SIGNAL_RE.test(lines[index])) signalIndexes.push(index);
  }
  const selectedSignals = signalIndexes.slice(-MAX_SIGNAL_WINDOWS);
  const indexes = new Set<number>();
  for (const signalIndex of selectedSignals) {
    for (
      let index = Math.max(0, signalIndex - SIGNAL_WINDOW_BEFORE);
      index <= Math.min(lines.length - 1, signalIndex + SIGNAL_WINDOW_AFTER);
      index += 1
    ) {
      indexes.add(index);
    }
  }
  return { indexes, matchedSignals: signalIndexes.length };
}

export function failureFocusedLogExcerpt(
  rawText: string,
  maxChars = MAX_EXCERPT_CHARS,
): FailureFocusedExcerpt {
  const clean = rawText.replace(ANSI_RE, '').replace(/\r\n?/g, '\n');
  const lines = clean.split('\n');
  const { indexes, matchedSignals } = lineIndexesAroundSignals(lines);
  const tailStart = Math.max(0, lines.length - TAIL_LINES);
  for (let index = tailStart; index < lines.length; index += 1) indexes.add(index);

  const ordered = [...indexes].sort((left, right) => left - right);
  let excerpt = ordered.map((index) => lines[index]).join('\n').trim();
  let truncated = ordered.length < lines.length;
  if (excerpt.length > maxChars) {
    excerpt = `…\n${excerpt.slice(-maxChars + 2)}`;
    truncated = true;
  }

  return {
    excerpt,
    strategy: matchedSignals > 0 ? 'failure-signals-plus-tail' : 'tail-only',
    sourceLineCount: lines.length,
    selectedLineCount: ordered.length,
    matchedSignals,
    truncated,
  };
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function objectArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function legacyLogByJob(payload: JsonObject): Map<number, JsonObject> {
  const map = new Map<number, JsonObject>();
  for (const entry of objectArray(payload.logExcerpts)) {
    const jobId = numberValue(entry.jobId);
    if (jobId) map.set(jobId, entry);
  }
  return map;
}

export function addEnhancedWorkflowDiagnosisOpenApi(document: JsonObject): void {
  const paths = isObject(document.paths) ? document.paths : null;
  const path = paths && isObject(paths[DIAGNOSE_RUN_PATH]) ? paths[DIAGNOSE_RUN_PATH] : null;
  const post = path && isObject(path.post) ? path.post : null;
  if (!post) return;
  post.description =
    'Returns run state, jobs and failed steps plus failure-focused log excerpts for up to three failing jobs. Excerpts keep the log tail and windows around error/failure signals instead of only the beginning.';
}

export async function handleEnhancedWorkflowDiagnosis(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== DIAGNOSE_RUN_PATH) return null;

  const base = await handleOperatorAction(request, env, fetcher);
  if (!base || !base.ok) return base;
  let payload: unknown;
  try {
    payload = await base.clone().json();
  } catch {
    return base;
  }
  if (!isObject(payload)) return base;

  const repositoryInput = await request.clone().json().catch(() => null) as unknown;
  const repository = isObject(repositoryInput) && typeof repositoryInput.repository === 'string'
    ? repositoryInput.repository
    : null;
  if (!repository || !/^trvny\/[A-Za-z0-9_.-]+$/.test(repository)) return base;
  const repo = repository.split('/').map((part) => encodeURIComponent(part)).join('/');
  const failingJobs = objectArray(payload.failingJobs).slice(0, MAX_LOG_JOBS);
  const legacy = legacyLogByJob(payload);

  const focusedLogs = await Promise.all(
    failingJobs.map(async (job) => {
      const jobId = numberValue(job.id);
      if (!jobId) return { jobId: null, excerpt: null, strategy: 'unavailable' };
      const log = await readLogText(
        request,
        env,
        fetcher,
        `/repos/${repo}/actions/jobs/${jobId}/logs`,
      );
      if (!log.text) {
        const fallback = legacy.get(jobId);
        return {
          jobId,
          excerpt: fallback && typeof fallback.excerpt === 'string' ? fallback.excerpt : null,
          strategy: 'legacy-fallback',
          error: log.error ?? 'log_unavailable',
        };
      }
      return { jobId, ...failureFocusedLogExcerpt(log.text) };
    }),
  );

  return json({
    ...payload,
    diagnosisVersion: 2,
    logExcerpts: focusedLogs,
  }, base.status);
}
