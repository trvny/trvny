// Deterministic publication policy: claims CI already settles are never review findings.
// Build, syntax and import breakage fails a compile or test job on its own; models reading
// only a diff mostly invent it (missing imports for member functions, Kotlin trailing commas,
// sibling imports under unittest discovery).
import type { ParsedReview, RawFinding } from './webhook-review-context.ts';

// Only sources a compile or test job loads. Workflow, config and data files stay reviewable:
// nothing guarantees a check parses them before merge.
const CI_CHECKED_SOURCE = /\.(?:kts?|java|swift|[cm]?[jt]sx?|py|go|rs)$/iu;

const BREAKAGE = '编译(?:会)?(?:失败|错误|报错|不通过)|无法(?:通过)?编译|语法错误';
// Titles name the claim. Bare "导入" is not enough: it is also data import.
const TITLE_CLAIM = new RegExp(
  `${BREAKAGE}|(?:缺少|缺失|未)[^，。；]{0,60}导入|导入[^，。；]{0,20}(?:缺失|路径错误)|错误[^，。；]{0,10}导入路径`,
  'iu',
);
// Bodies of real findings mention imports in passing, so only an asserted breakage counts.
const BODY_CLAIM = new RegExp(
  `${BREAKAGE}|unresolved reference|(?:导致|抛出|引发|报)[^。；]{0,16}(?:ImportError|ModuleNotFoundError)`,
  'iu',
);

export function isCiCheckedClaim(finding: RawFinding): boolean {
  if (typeof finding.path !== 'string' || !CI_CHECKED_SOURCE.test(finding.path)) return false;
  return (typeof finding.title === 'string' && TITLE_CLAIM.test(finding.title)) ||
    (typeof finding.body === 'string' && BODY_CLAIM.test(finding.body));
}

// Filters raw findings, before verification: a reply holding only dropped claims must read as
// clean, not as unverifiable output that escalates to the paid phase.
export function applyFindingPolicy(parsed: ParsedReview): { parsed: ParsedReview; dropped: number } {
  const findings = parsed.findings.filter((finding) => !isCiCheckedClaim(finding));
  const dropped = parsed.findings.length - findings.length;
  // The summary may describe a dropped claim; publication falls back to the stock one.
  return dropped ? { parsed: { summary: '', findings }, dropped } : { parsed, dropped };
}
