export interface UnifiedPatchLine {
  kind: 'context' | 'add' | 'remove';
  text: string;
  oldNoNewline?: boolean;
  newNoNewline?: boolean;
}

export interface UnifiedPatchHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: UnifiedPatchLine[];
}

export type UnifiedPatchFileMode = '100644' | '100755';

export interface UnifiedFilePatch {
  oldPath: string | null;
  newPath: string | null;
  oldMode?: UnifiedPatchFileMode;
  newMode?: UnifiedPatchFileMode;
  hunks: UnifiedPatchHunk[];
}

interface SourceLine {
  text: string;
  eol: '' | '\n' | '\r\n';
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/;

function parseCount(value: string | undefined): number {
  return value === undefined ? 1 : Number(value);
}

function parseFileMode(value: string): UnifiedPatchFileMode {
  if (value === '100644' || value === '100755') return value;
  throw new Error('unsupported_patch_file_mode');
}

function cleanPatchPath(value: string): string | null {
  const raw = value.split('\t', 1)[0].trim();
  if (raw === '/dev/null') return null;
  if (!raw || raw.startsWith('"')) throw new Error('unsupported_patch_path');
  if (raw.startsWith('a/') || raw.startsWith('b/')) return raw.slice(2);
  return raw;
}

function diffHeaderPaths(line: string): { oldPath: string; newPath: string } {
  const raw = line.slice('diff --git '.length);
  const parts = raw.split(' ');
  if (parts.length !== 2 || parts.some((part) => !part || part.startsWith('"'))) {
    throw new Error('unsupported_patch_path');
  }
  const oldPath = cleanPatchPath(parts[0]);
  const newPath = cleanPatchPath(parts[1]);
  if (!oldPath || !newPath) throw new Error('invalid_patch_paths');
  return { oldPath, newPath };
}

function finalizeFile(
  files: UnifiedFilePatch[],
  current: UnifiedFilePatch | null,
): UnifiedFilePatch | null {
  if (!current) return null;
  if (current.oldPath === null && current.newPath === null) {
    throw new Error('invalid_patch_paths');
  }
  if (current.oldPath && current.newPath && current.oldPath !== current.newPath) {
    throw new Error('patch_renames_not_supported');
  }
  const createsOrDeletes = (current.oldPath === null) !== (current.newPath === null);
  if (!current.hunks.length && !createsOrDeletes) {
    throw new Error('patch_file_has_no_hunks');
  }
  if (current.oldPath === null && current.oldMode) throw new Error('invalid_patch_file_mode');
  if (current.newPath === null && current.newMode) throw new Error('invalid_patch_file_mode');
  files.push(current);
  return null;
}

export function parseUnifiedPatch(patch: string): UnifiedFilePatch[] {
  if (!patch.trim()) throw new Error('empty_patch');
  if (patch.includes('\0')) throw new Error('invalid_patch');
  const lines = patch.replace(/\r\n/g, '\n').split('\n');
  const files: UnifiedFilePatch[] = [];
  let current: UnifiedFilePatch | null = null;
  let pendingOldMode: UnifiedPatchFileMode | undefined;
  let pendingNewMode: UnifiedPatchFileMode | undefined;
  let pendingDiffPaths: { oldPath: string; newPath: string } | null = null;
  let index = 0;

  const flushPending = () => {
    current = finalizeFile(files, current);
    if (!current && pendingDiffPaths && (pendingOldMode || pendingNewMode)) {
      if (pendingOldMode && pendingNewMode) throw new Error('unsupported_patch_metadata');
      current = pendingNewMode
        ? {
            oldPath: null,
            newPath: pendingDiffPaths.newPath,
            newMode: pendingNewMode,
            hunks: [],
          }
        : {
            oldPath: pendingDiffPaths.oldPath,
            newPath: null,
            oldMode: pendingOldMode,
            hunks: [],
          };
      current = finalizeFile(files, current);
    }
    pendingOldMode = undefined;
    pendingNewMode = undefined;
    pendingDiffPaths = null;
  };

  while (index < lines.length) {
    const line = lines[index];

    if (line.startsWith('diff --git ')) {
      flushPending();
      pendingDiffPaths = diffHeaderPaths(line);
      index += 1;
      continue;
    }

    if (line.startsWith('index ')) {
      index += 1;
      continue;
    }

    if (line.startsWith('new file mode ')) {
      pendingNewMode = parseFileMode(line.slice('new file mode '.length).trim());
      index += 1;
      continue;
    }

    if (line.startsWith('deleted file mode ')) {
      pendingOldMode = parseFileMode(line.slice('deleted file mode '.length).trim());
      index += 1;
      continue;
    }

    if (
      line.startsWith('rename from ') ||
      line.startsWith('rename to ') ||
      line.startsWith('copy from ') ||
      line.startsWith('copy to ') ||
      line.startsWith('old mode ') ||
      line.startsWith('new mode ') ||
      line === 'GIT binary patch' ||
      line.startsWith('Binary files ')
    ) {
      throw new Error('unsupported_patch_metadata');
    }

    if (line.startsWith('--- ')) {
      current = finalizeFile(files, current);
      const oldPath = cleanPatchPath(line.slice(4));
      const next = lines[index + 1];
      if (!next?.startsWith('+++ ')) throw new Error('missing_patch_new_path');
      const newPath = cleanPatchPath(next.slice(4));
      current = {
        oldPath,
        newPath,
        ...(pendingOldMode ? { oldMode: pendingOldMode } : {}),
        ...(pendingNewMode ? { newMode: pendingNewMode } : {}),
        hunks: [],
      };
      pendingOldMode = undefined;
      pendingNewMode = undefined;
      pendingDiffPaths = null;
      index += 2;
      continue;
    }

    if (line.startsWith('@@ ')) {
      if (!current) throw new Error('patch_hunk_without_file');
      const match = line.match(HUNK_RE);
      if (!match) throw new Error('invalid_patch_hunk_header');
      const hunk: UnifiedPatchHunk = {
        oldStart: Number(match[1]),
        oldCount: parseCount(match[2]),
        newStart: Number(match[3]),
        newCount: parseCount(match[4]),
        lines: [],
      };
      if (
        (hunk.oldCount > 0 && hunk.oldStart === 0) ||
        (hunk.newCount > 0 && hunk.newStart === 0)
      ) {
        throw new Error('invalid_patch_hunk_range');
      }
      index += 1;

      let oldSeen = 0;
      let newSeen = 0;
      while (index < lines.length && (oldSeen < hunk.oldCount || newSeen < hunk.newCount)) {
        const hunkLine = lines[index];
        const prefix = hunkLine[0];
        if (prefix === ' ') {
          hunk.lines.push({ kind: 'context', text: hunkLine.slice(1) });
          oldSeen += 1;
          newSeen += 1;
        } else if (prefix === '-') {
          hunk.lines.push({ kind: 'remove', text: hunkLine.slice(1) });
          oldSeen += 1;
        } else if (prefix === '+') {
          hunk.lines.push({ kind: 'add', text: hunkLine.slice(1) });
          newSeen += 1;
        } else {
          throw new Error('invalid_patch_hunk_line');
        }

        index += 1;
        if (lines[index] === '\\ No newline at end of file') {
          const previous = hunk.lines.at(-1);
          if (!previous) throw new Error('invalid_patch_no_newline_marker');
          if (previous.kind !== 'add') previous.oldNoNewline = true;
          if (previous.kind !== 'remove') previous.newNoNewline = true;
          index += 1;
        }
      }

      if (oldSeen !== hunk.oldCount || newSeen !== hunk.newCount) {
        throw new Error('patch_hunk_count_mismatch');
      }
      current.hunks.push(hunk);
      continue;
    }

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    throw new Error('unexpected_patch_line');
  }

  flushPending();
  if (!files.length) throw new Error('empty_patch');

  const paths = files.map((file) => file.newPath ?? file.oldPath);
  if (new Set(paths).size !== paths.length) throw new Error('duplicate_patch_path');
  return files;
}

function splitText(content: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === '\r') {
      if (content[index + 1] !== '\n') throw new Error('unsupported_patch_line_endings');
      lines.push({ text: content.slice(start, index), eol: '\r\n' });
      index += 1;
      start = index + 1;
      continue;
    }
    if (character === '\n') {
      lines.push({ text: content.slice(start, index), eol: '\n' });
      start = index + 1;
    }
  }

  if (start < content.length) lines.push({ text: content.slice(start), eol: '' });
  return lines;
}

function addedLineEol(source: SourceLine[], hunkStart: number): '\n' | '\r\n' {
  const at = source[hunkStart]?.eol;
  if (at === '\n' || at === '\r\n') return at;
  const before = source[hunkStart - 1]?.eol;
  if (before === '\n' || before === '\r\n') return before;
  return '\n';
}

function validateOldLineEnding(
  source: SourceLine[],
  sourceIndex: number,
  patchLine: UnifiedPatchLine,
): void {
  const line = source[sourceIndex];
  if (!line) throw new Error('patch_context_mismatch');
  const isFinalSourceLine = sourceIndex === source.length - 1;
  const sourceHasNoNewline = line.eol === '';

  if (patchLine.oldNoNewline) {
    if (!isFinalSourceLine || !sourceHasNoNewline) {
      throw new Error('patch_old_eof_mismatch');
    }
    return;
  }

  if (isFinalSourceLine && sourceHasNoNewline) {
    throw new Error('patch_old_eof_mismatch');
  }
}

function validateNewNoNewlineMarkers(output: SourceLine[]): void {
  for (let index = 0; index < output.length - 1; index += 1) {
    if (output[index].eol === '') throw new Error('patch_new_eof_mismatch');
  }
}

export function applyUnifiedFilePatch(
  content: string,
  patch: UnifiedFilePatch,
): string | null {
  if (patch.newPath === null && patch.oldPath === null) {
    throw new Error('invalid_patch_paths');
  }

  const source = splitText(content);
  const output: SourceLine[] = [];
  let sourceIndex = 0;

  for (const hunk of patch.hunks) {
    const hunkStart = hunk.oldCount === 0
      ? hunk.oldStart
      : hunk.oldStart - 1;
    if (hunkStart < sourceIndex || hunkStart > source.length) {
      throw new Error('patch_hunk_out_of_order');
    }

    output.push(...source.slice(sourceIndex, hunkStart));
    sourceIndex = hunkStart;

    const newHunkStart = hunk.newCount === 0
      ? hunk.newStart
      : hunk.newStart - 1;
    if (newHunkStart !== output.length) {
      throw new Error('patch_new_position_mismatch');
    }

    const insertionEol = addedLineEol(source, hunkStart);
    for (const line of hunk.lines) {
      if (line.kind === 'context' || line.kind === 'remove') {
        const current = source[sourceIndex];
        if (!current || current.text !== line.text) {
          throw new Error('patch_context_mismatch');
        }
        validateOldLineEnding(source, sourceIndex, line);
        sourceIndex += 1;

        if (line.kind === 'context') {
          const eol = line.newNoNewline ? '' : current.eol;
          output.push({ text: line.text, eol });
        }
      }

      if (line.kind === 'add') {
        output.push({
          text: line.text,
          eol: line.newNoNewline ? '' : insertionEol,
        });
      }
    }
  }

  output.push(...source.slice(sourceIndex));
  validateNewNoNewlineMarkers(output);

  if (patch.newPath === null) {
    if (output.length !== 0) throw new Error('delete_patch_did_not_empty_file');
    return null;
  }

  return output.map((line) => line.text + line.eol).join('');
}
