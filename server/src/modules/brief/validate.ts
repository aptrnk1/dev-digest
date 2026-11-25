import { PrBrief } from '@devdigest/shared';
import {
  MAX_EXPLANATION,
  MAX_FOCUS,
  MAX_KIND,
  MAX_REASON,
  MAX_RISKS,
  MAX_RISK_TITLE,
  MAX_SUMMARY,
} from './constants.js';
import { inRanges, truncateCodePoints, wellFormed, type LineRange } from './helpers.js';
import type { BriefDraft } from './prompt.js';

export interface DraftContext {
  files: Map<string, LineRange[]>;
  callerFiles: Set<string>;
}

/** `path`, `path:N` or `path:N-M` → the path part. */
function refPath(ref: string): string {
  const m = /^(.*?)(?::\d+(?:-\d+)?)?$/.exec(ref);
  return m?.[1] ?? ref;
}

/**
 * Order: drop invalid (focus outside the diff, refs outside PR ∪ callers, risks without refs)
 * → first 6 / 6 in model order → truncate by code point.
 */
export function sanitizeDraft(
  draft: BriefDraft,
  ctx: DraftContext,
): Pick<PrBrief, 'summary' | 'risks' | 'review_focus'> {
  const known = (p: string) => ctx.files.has(p) || ctx.callerFiles.has(p);

  const risks = draft.risks
    .map((r) => ({ ...r, file_refs: r.file_refs.filter((ref) => known(refPath(ref))) }))
    .filter((r) => r.file_refs.length > 0)
    .slice(0, MAX_RISKS)
    .map((r) => ({
      kind: truncateCodePoints(r.kind, MAX_KIND),
      title: truncateCodePoints(r.title, MAX_RISK_TITLE),
      explanation: truncateCodePoints(r.explanation, MAX_EXPLANATION),
      severity: r.severity,
      file_refs: r.file_refs.map((x) => wellFormed(x)),
    }));

  const review_focus = draft.review_focus
    .filter((f) => {
      const ranges = ctx.files.get(f.file);
      return ranges !== undefined && inRanges(f.line, ranges);
    })
    .slice(0, MAX_FOCUS)
    .map((f) => ({ file: f.file, line: f.line, reason: truncateCodePoints(f.reason, MAX_REASON) }));

  return { summary: truncateCodePoints(draft.summary, MAX_SUMMARY), risks: { risks }, review_focus };
}

/** A stored `pr_brief.json` that no longer matches the contract is treated as absent. */
export function parseStoredBrief(json: unknown): PrBrief | null {
  const r = PrBrief.safeParse(json);
  return r.success ? r.data : null;
}
