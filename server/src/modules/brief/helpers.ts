import type { BlastRadiusResponse, BriefBlast } from '@devdigest/shared';

export interface LineRange {
  start: number;
  count: number;
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;

/** New-side `+c,d` numbers of every `@@` header (d defaults to 1). Nothing else of the patch is read. */
export function hunkRanges(patch: string | null): LineRange[] {
  if (!patch) return [];
  const out: LineRange[] = [];
  for (const m of patch.matchAll(HUNK_HEADER)) {
    out.push({ start: Number(m[1]), count: m[2] === undefined ? 1 : Number(m[2]) });
  }
  return out;
}

export function inRanges(line: number, ranges: LineRange[]): boolean {
  return ranges.some((r) => line >= r.start && line < r.start + r.count);
}

/** Replace lone surrogates with U+FFFD (Postgres jsonb rejects them). */
export function wellFormed(s: string): string {
  return s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

/** Cut to `max` code points (never inside a surrogate pair); lone surrogates are replaced. */
export function truncateCodePoints(s: string, max: number): string {
  const cps = Array.from(wellFormed(s));
  return cps.length <= max ? cps.join('') : cps.slice(0, max).join('');
}

/** degraded with no symbols and no callers = no blast data (null); otherwise the compact brief form. */
export function toBriefBlast(r: BlastRadiusResponse): BriefBlast | null {
  const callers = r.downstream.flatMap((d) => d.callers);
  if (r.degraded && r.changed_symbols.length === 0 && callers.length === 0) return null;
  return {
    summary: r.summary,
    caller_files: [...new Set(callers.map((c) => c.file))],
    degraded_reason: r.degraded_reason,
  };
}
