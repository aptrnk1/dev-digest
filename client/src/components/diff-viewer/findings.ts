/** Anchoring of review findings onto parsed diff lines (client-side: only the
    client knows which new-side line numbers are actually visible). */
import type { FindingRecord } from "@devdigest/shared";
import type { Line } from "./helpers";

type Severity = FindingRecord["severity"];

/** Display order, most severe first. */
export const SEVERITY_ORDER = ["CRITICAL", "WARNING", "SUGGESTION"] as const satisfies readonly Severity[];

/** Severity → CSS colour token. */
export const SEVERITY_COLOR = {
  CRITICAL: "var(--crit)",
  WARNING: "var(--warn)",
  SUGGESTION: "var(--sugg)",
} as const satisfies Record<(typeof SEVERITY_ORDER)[number], string>;

function rank(sev: Severity): number {
  const i = (SEVERITY_ORDER as readonly string[]).indexOf(sev);
  return i === -1 ? SEVERITY_ORDER.length : i;
}

function bySeverity(a: FindingRecord, b: FindingRecord): number {
  return rank(a.severity) - rank(b.severity) || a.start_line - b.start_line;
}

export interface AnchoredFindings {
  byNewLine: Map<number, FindingRecord[]>;
  fileLevel: FindingRecord[];
}

/** Anchor on the RIGHT side: `end_line` if visible, else the largest visible
    new line in `[start_line, end_line]`, else file-level. */
export function anchorFindings(lines: Line[], findings: FindingRecord[]): AnchoredFindings {
  const visible = new Set<number>();
  for (const ln of lines) {
    if (ln.kind !== "hunk" && ln.kind !== "del" && ln.newNo != null) visible.add(ln.newNo);
  }

  const byNewLine = new Map<number, FindingRecord[]>();
  const fileLevel: FindingRecord[] = [];
  for (const f of [...findings].sort(bySeverity)) {
    let target: number | null = null;
    if (visible.has(f.end_line)) {
      target = f.end_line;
    } else {
      for (const n of visible) {
        if (n >= f.start_line && n <= f.end_line && (target == null || n > target)) target = n;
      }
    }
    if (target == null) fileLevel.push(f);
    else byNewLine.set(target, [...(byNewLine.get(target) ?? []), f]);
  }
  return { byNewLine, fileLevel };
}
