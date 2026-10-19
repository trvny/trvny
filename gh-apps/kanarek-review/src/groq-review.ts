// Free Groq reviews must fit the account's token-per-minute allowance.
// Keep complete diffs whenever possible; when only a subset fits, the caller
// must treat a clean answer as inconclusive rather than a full-PR clean review.
const FREE_REVIEW_TPM_TARGET = 7_500;
const FREE_REVIEW_MIN_OUTPUT = 2_048;
const FREE_REVIEW_MAX_OUTPUT = 4_096;

type Json = Record<string, unknown>;
type GroqPreparedInput = { input: Json; partial: boolean };

function isObject(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function estimateTokens(value: Json): number {
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  return Math.ceil(bytes / 2) + 512;
}

export function prepareGroqFreeReview(input: Json): GroqPreparedInput | null {
  let request = input;
  let partial = false;
  const fits = (candidate: Json) =>
    estimateTokens(candidate) + FREE_REVIEW_MIN_OUTPUT <= FREE_REVIEW_TPM_TARGET;

  if (!fits(request) && Array.isArray(request.messages)) {
    const messages = request.messages;
    const index = messages.findLastIndex((item) => isObject(item) && item.role === 'user');
    const message = messages[index];
    if (index >= 0 && isObject(message) && typeof message.content === 'string') {
      let payload: unknown;
      try {
        payload = JSON.parse(message.content);
      } catch {
        payload = null;
      }
      if (isObject(payload) && typeof payload.diff === 'string') {
        const wrap = (body: Json): Json => ({
          ...request,
          messages: messages.map((item, i) =>
            i === index ? { ...message, content: JSON.stringify(body) } : item),
        });
        // Reduce ancillary context before touching the actual diff.
        const slim: Json = {
          ...payload,
          repository_context: { files: [], callers: [], dependency_evidence: [] },
        };
        request = wrap(slim);
        if (!fits(request)) {
          const parts = payload.diff.split(/\n\n(?=### [^\n]+\n)/);
          const selected: string[] = [];
          const body = (diff: string): Json => ({
            ...slim,
            diff,
            review_scope: 'partial_free_tier: not all changed code is shown; do not claim the whole PR is clean',
          });
          for (const part of parts) {
            const candidate = [...selected, part].join('\n\n');
            if (!fits(wrap(body(candidate)))) break;
            selected.push(part);
          }
          if (selected.length === 0 && parts.length > 0) {
            // A single long file may need a complete-line prefix of its patch.
            const first = parts[0];
            let end = first.length;
            while (end > 80) {
              end = first.lastIndexOf('\n', Math.floor(end * 0.75));
              if (end <= 80) break;
              if (fits(wrap(body(first.slice(0, end))))) {
                selected.push(first.slice(0, end));
                break;
              }
            }
          }
          if (!selected.length) return null;
          request = wrap(body(selected.join('\n\n')));
          partial = true;
        }
      }
    }
  }

  const available = FREE_REVIEW_TPM_TARGET - estimateTokens(request);
  if (available < FREE_REVIEW_MIN_OUTPUT) return null;
  const requested = typeof input.max_tokens === 'number' && Number.isFinite(input.max_tokens)
    ? input.max_tokens
    : FREE_REVIEW_MAX_OUTPUT;
  return {
    input: { ...request, max_tokens: Math.min(requested, FREE_REVIEW_MAX_OUTPUT, available) },
    partial,
  };
}
