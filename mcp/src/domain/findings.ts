import type { FindingRecord, ReviewRecord, Severity, Verdict } from '@devdigest/shared';

export const SEVERITY_ORDER: readonly Severity[] = ['CRITICAL', 'WARNING', 'SUGGESTION'];
export const MAX_FINDINGS = 50;
export const MAX_RESPONSE_CHARS = 16000;
const TITLE_MAX = 200;
const SUGGESTION_MAX = 400;
const RATIONALE_MAX = 800;
export const TRUNCATED_HINT = 'filter with severity_min';

export type Detail = 'concise' | 'full';

export interface CompactFinding {
  id: string;
  severity: Severity;
  file: string;
  line: number;
  title: string;
  suggestion?: string;
  rationale?: string;
}

export interface RunView {
  run_id: string | null;
  agent: string;
  status: string;
  error?: string;
  verdict: Verdict | null;
  summary?: string;
  counts_by_severity: Record<Severity, number>;
  findings: CompactFinding[];
  truncated: number;
  hint?: string;
}

const rank = (s: Severity): number => SEVERITY_ORDER.indexOf(s);

const cap = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const visible = (f: FindingRecord[]): FindingRecord[] => f.filter((x) => x.dismissed_at == null);

export function countsBySeverity(f: FindingRecord[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 };
  for (const x of visible(f)) counts[x.severity] += 1;
  return counts;
}

export function compactFindings(
  f: FindingRecord[],
  o: { severityMin?: Severity; detail: Detail; limit?: number },
): { findings: CompactFinding[]; truncated: number } {
  const limit = Math.min(o.limit ?? MAX_FINDINGS, MAX_FINDINGS);
  const minRank = o.severityMin ? rank(o.severityMin) : SEVERITY_ORDER.length - 1;
  const kept = visible(f)
    .filter((x) => rank(x.severity) <= minRank)
    .sort(
      (a, b) =>
        rank(a.severity) - rank(b.severity) || a.file.localeCompare(b.file) || a.start_line - b.start_line,
    );
  const findings = kept.slice(0, limit).map((x): CompactFinding => {
    const out: CompactFinding = {
      id: x.id,
      severity: x.severity,
      file: x.file,
      line: x.start_line,
      title: cap(x.title, TITLE_MAX),
    };
    if (x.suggestion) out.suggestion = cap(x.suggestion, SUGGESTION_MAX);
    if (o.detail === 'full') out.rationale = cap(x.rationale, RATIONALE_MAX);
    return out;
  });
  return { findings, truncated: kept.length - findings.length };
}

/** The API verdict when present; otherwise derived from the visible findings. */
export function deriveVerdict(apiVerdict: Verdict | null, f: FindingRecord[]): Verdict {
  if (apiVerdict) return apiVerdict;
  const v = visible(f);
  if (v.some((x) => x.severity === 'CRITICAL')) return 'request_changes';
  return v.length > 0 ? 'comment' : 'approve';
}

export function toRunView(
  input: {
    run_id: string | null;
    agent: string;
    status: string;
    error?: string | null;
    review?: ReviewRecord;
  },
  o: { severityMin?: Severity; detail: Detail; limit?: number },
): RunView {
  const review = input.review;
  const all = review?.findings ?? [];
  const { findings, truncated } = compactFindings(all, o);
  const view: RunView = {
    run_id: input.run_id,
    agent: input.agent,
    status: input.status,
    verdict: review ? deriveVerdict(review.verdict, all) : null,
    counts_by_severity: countsBySeverity(all),
    findings,
    truncated,
  };
  if (input.error) view.error = input.error;
  if (review?.summary) view.summary = review.summary;
  if (truncated > 0) view.hint = TRUNCATED_HINT;
  return view;
}

interface Holder {
  findings: unknown[];
  truncated: number;
  hint?: string;
}

const isHolder = (x: unknown): x is Holder =>
  typeof x === 'object' && x !== null && Array.isArray((x as Holder).findings) && typeof (x as Holder).truncated === 'number';

/**
 * Keep a response within `maxChars`: tail findings move into `truncated`
 * (last run first when the payload has `runs`). Mutates a structured clone.
 */
export function fitBudget<T>(payload: T, maxChars: number = MAX_RESPONSE_CHARS): T {
  if (JSON.stringify(payload).length <= maxChars) return payload;
  const out = structuredClone(payload);
  const root = out as { runs?: unknown };
  const holders: Holder[] = Array.isArray(root.runs) ? root.runs.filter(isHolder) : isHolder(out) ? [out] : [];
  while (JSON.stringify(out).length > maxChars) {
    const target = [...holders].reverse().find((h) => h.findings.length > 0);
    if (!target) break;
    target.findings.pop();
    target.truncated += 1;
    target.hint = TRUNCATED_HINT;
  }
  return out;
}
