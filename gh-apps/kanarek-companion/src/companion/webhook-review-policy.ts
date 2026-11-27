// Deterministic publication policy: claims CI already settles are never review findings.
// Compile and import breakage fails a build or test job on its own; models reading
// only a diff mostly invent it (missing imports for member functions, Kotlin trailing commas,
// sibling imports under unittest discovery).
//
// A false drop is invisible and a false keep is one noisy comment, so every pattern below
// errs towards keeping. A path proves nothing about CI coverage; the scope is a heuristic.
import type { ParsedReview, RawFinding } from './webhook-review-context.ts';

// Sources a build type-checks or compiles.
const COMPILED_SOURCE = /\.(?:kt|java|swift|tsx?|rs|go)$/iu;
// Interpreted sources only count when a test runner loads them: other scripts may never run in CI.
const SCRIPT_TEST = /(?:^|\/)test_[^/]*\.py$|\.(?:test|spec)\.[cm]?jsx?$/iu;
// Build and tool configuration may be read by no job that fails the pull request.
const CONFIGURATION = /\.config\.[cm]?[jt]s$|\.gradle\.kts$/iu;

// A title is a claim when the breakage is what it ends on. "语法错误" is not a trigger:
// it also names a parser mishandling valid input. "导入" alone also means data import.
const TITLE_CLAIM =
  /(?:编译(?:失败|错误|报错|不通过)|无法(?:通过)?编译)$|(?:缺少|缺失)[^，。；]{0,60}(?:[A-Za-z_)]\s*|断言|扩展|函数|模块)导入$|(?:模块导入|导入模块)路径错误$|错误的(?:模块)?导入路径$/u;
// In a body, only a stated consequence for the build counts; mentions do not.
const BODY_CLAIM =
  /无法(?:通过)?编译|(?:导致|使得|会(?:因)?)[^。；，]{0,40}编译(?:会)?(?:失败|错误|报错|不通过)/u;
// A denied breakage ("不会使代码无法编译，但…") introduces the real defect.
const NEGATION = /不会|不是|并非|并不|不导致|不使|不至于|不引起/u;
const CLAUSE_END = /[。；，;\n]/u;

function claimsBuildBreakage(title: string, body: string): boolean {
  if (!NEGATION.test(title) && TITLE_CLAIM.test(title.trim().replace(/[。.!！]+$/u, ''))) return true;
  return body.split(CLAUSE_END).some((clause) => !NEGATION.test(clause) && BODY_CLAIM.test(clause));
}

export function isCiCheckedClaim(finding: RawFinding): boolean {
  const { path, title, body } = finding;
  if (typeof path !== 'string' || CONFIGURATION.test(path)) return false;
  if (!COMPILED_SOURCE.test(path) && !SCRIPT_TEST.test(path)) return false;
  return claimsBuildBreakage(
    typeof title === 'string' ? title : '',
    typeof body === 'string' ? body : '',
  );
}

// Filters raw findings, before verification: a reply holding only dropped claims must read as
// clean, not as unverifiable output that escalates to the paid phase.
export function applyFindingPolicy(parsed: ParsedReview): { parsed: ParsedReview; dropped: number } {
  const findings = parsed.findings.filter((finding) => !isCiCheckedClaim(finding));
  const dropped = parsed.findings.length - findings.length;
  // The summary may describe a dropped claim; publication falls back to the stock one.
  return dropped ? { parsed: { summary: '', findings }, dropped } : { parsed, dropped };
}
