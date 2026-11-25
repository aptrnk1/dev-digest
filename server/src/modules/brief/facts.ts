import type {
  BlastRadiusResponse,
  BriefBlast,
  BriefMissingInput,
  Intent,
  PrIntentState,
  Severity,
  SmartDiffRole,
} from '@devdigest/shared';
import type { RunProjectContext } from '../context/types.js';
import { MAX_ANCHORS, MAX_BLAST_CALLERS, MAX_BLAST_SYMBOLS, MAX_FILES, MAX_RANGES_PER_FILE } from './constants.js';
import { hunkRanges, toBriefBlast, type LineRange } from './helpers.js';
import type { SmartDiffFacts } from '../smart-diff/types.js';
import type { BriefPull } from './ports.js';

export interface FileFact {
  path: string;
  additions: number;
  deletions: number;
  /** null = the file is in the PR but not in Smart Diff's list. */
  role: SmartDiffRole | null;
  ranges: LineRange[];
}

export interface AnchorFact {
  file: string;
  start_line: number;
  severity: Severity;
  title: string;
}

/** Everything the prompt may show — no patch content, only numbers from `@@` headers. */
export interface PromptFacts {
  title: string;
  description: string;
  intent: Pick<Intent, 'intent' | 'in_scope' | 'out_of_scope' | 'risk_areas'> | null;
  blast: {
    summary: string;
    degraded_reason: BriefBlast['degraded_reason'];
    symbols: string[];
    callers: { name: string; file: string; line: number }[];
  } | null;
  files: FileFact[];
  anchors: AnchorFact[];
  specs: { path: string; content: string }[];
}

export interface BriefFacts {
  facts: PromptFacts;
  missing: BriefMissingInput[];
  intentStale: boolean;
  intent: Intent | null;
  blast: BriefBlast | null;
  /** ALL changed files → ALL new-side hunk ranges (what Review focus may point at); caps apply to the prompt only. */
  files: Map<string, LineRange[]>;
  callerFiles: Set<string>;
}

const SEVERITY_RANK: Record<Severity, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };

export function buildFacts(input: {
  pull: BriefPull;
  intent: PrIntentState;
  blast: BlastRadiusResponse;
  diff: SmartDiffFacts;
  specs: RunProjectContext;
}): BriefFacts {
  const { pull, blast, diff, specs } = input;
  const missing: BriefMissingInput[] = [];

  const rec = input.intent.intent;
  const intent: Intent | null = rec
    ? {
        intent: rec.intent,
        in_scope: rec.in_scope,
        out_of_scope: rec.out_of_scope,
        risk_areas: rec.risk_areas,
        confidence: rec.confidence,
        basis: rec.basis,
        sources: rec.sources,
        unresolved_refs: rec.unresolved_refs,
      }
    : null;
  if (!intent) missing.push('intent');
  const intentStale = intent !== null && input.intent.stale;

  const briefBlast = toBriefBlast(blast);
  if (!briefBlast) missing.push('blast');
  if (specs.specs.length === 0) missing.push('specs');
  if (!diff.reviewed) missing.push('review_findings');

  // Files: Smart Diff order first, then PR files it does not list.
  const byPath = new Map(pull.files.map((f) => [f.path, f]));
  const roles = new Map(diff.files.map((f) => [f.path, f.role]));
  const ordered = [
    ...diff.files.map((f) => f.path).filter((p) => byPath.has(p)),
    ...pull.files.map((f) => f.path).filter((p) => !roles.has(p)),
  ].slice(0, MAX_FILES);
  const allRanges = new Map(pull.files.map((f) => [f.path, hunkRanges(f.patch)]));
  const files: FileFact[] = ordered.map((path) => {
    const f = byPath.get(path)!;
    return {
      path,
      additions: f.additions,
      deletions: f.deletions,
      role: roles.get(path) ?? null,
      ranges: (allRanges.get(path) ?? []).slice(0, MAX_RANGES_PER_FILE),
    };
  });

  const anchors = [...diff.findings]
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
        a.start_line - b.start_line,
    )
    .slice(0, MAX_ANCHORS)
    .map((f) => ({ file: f.file, start_line: f.start_line, severity: f.severity, title: f.title }));

  const callers = blast.downstream.flatMap((d) => d.callers);
  return {
    facts: {
      title: pull.title,
      description: pull.body ?? '',
      intent: intent && {
        intent: intent.intent,
        in_scope: intent.in_scope,
        out_of_scope: intent.out_of_scope,
        risk_areas: intent.risk_areas,
      },
      blast: briefBlast && {
        summary: blast.summary,
        degraded_reason: blast.degraded_reason,
        symbols: blast.changed_symbols.slice(0, MAX_BLAST_SYMBOLS).map((s) => s.name),
        callers: callers.slice(0, MAX_BLAST_CALLERS).map((c) => ({ name: c.name, file: c.file, line: c.line })),
      },
      files,
      anchors,
      specs: specs.specs.map((s) => ({ path: s.path, content: s.content })),
    },
    missing,
    intentStale,
    intent,
    blast: briefBlast,
    files: allRanges,
    callerFiles: new Set(briefBlast?.caller_files ?? []),
  };
}
