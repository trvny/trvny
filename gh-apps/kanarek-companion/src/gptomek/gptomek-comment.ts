// Transport decoding only. Command validation and checkpointing stay downstream.
const COMMENT_COMMAND_RE = /^\s*```gptomek[ \t]*\r?\n([\s\S]*?)\r?\n```\s*$/;
const RAW_PREAMBLE_RE = /^raw-v1 ([A-Za-z0-9_-]{8,64})\n/;
const MAX_RAW_BLOCKS = 320; // 10 batch steps × 32 file slots

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function decodeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('invalid_comment_command_json');
  }
}

function decodeRaw(payload: string, preamble: RegExpMatchArray): unknown {
  const delimiter = `\n--${preamble[1]}--\n`;
  // Add only the framing LF; never normalize or trim raw strings.
  const parts = (payload.slice(preamble[0].length) + '\n').split(delimiter);
  const header = parts.shift();
  if (header === undefined || parts.pop() !== '' || !parts.length || parts.length > MAX_RAW_BLOCKS) {
    throw new Error('invalid_comment_raw_framing');
  }
  const command = decodeJson(header);
  if (!record(command)) throw new Error('invalid_comment_raw_header');
  const used = new Set<number>();
  const resolve = (value: unknown): unknown => {
    if (!record(value)) return value;
    const index = value.raw;
    if (Object.keys(value).length !== 1 || typeof index !== 'number' || !Number.isInteger(index)
      || index < 1 || index > parts.length || used.has(index)) {
      throw new Error('invalid_comment_raw_reference');
    }
    used.add(index);
    return parts[index - 1];
  };
  const hydrate = (input: Record<string, unknown>): void => {
    switch (input.op) {
      case 'commit_files':
        if (Array.isArray(input.files)) {
          for (const file of input.files) {
            if (record(file)) file.content = resolve(file.content);
          }
        }
        break;
      case 'apply_patch':
      case 'branch_from_patch':
      case 'review_fix':
        input.patch = resolve(input.patch);
        if (input.op === 'review_fix' && 'replyBody' in input) input.replyBody = resolve(input.replyBody);
        break;
      case 'comment':
      case 'reply_review':
        input.body = resolve(input.body);
        break;
    }
  };
  if (command.op === 'batch' && Array.isArray(command.steps)) {
    for (const step of command.steps) {
      if (record(step)) hydrate(step);
    }
  } else {
    hydrate(command);
  }
  if (used.size !== parts.length) throw new Error('unused_comment_raw_block');
  return command;
}

export function decodeGptomekComment(body: string): unknown {
  const match = body.match(COMMENT_COMMAND_RE);
  if (!match) throw new Error('invalid_comment_command');
  const payload = match[1];
  const preamble = payload.match(RAW_PREAMBLE_RE);
  return preamble ? decodeRaw(payload, preamble) : decodeJson(payload);
}
