import { z } from 'zod';
import { Severity } from './findings.js';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----
export const IntentRiskKind = z.enum(['security', 'dependency', 'performance', 'data', 'api', 'other']);
export type IntentRiskKind = z.infer<typeof IntentRiskKind>;

export const IntentConfidence = z.enum(['high', 'medium', 'low']);
export type IntentConfidence = z.infer<typeof IntentConfidence>;

export const IntentBasis = z.enum(['spec', 'ticket', 'description', 'inferred']);
export type IntentBasis = z.infer<typeof IntentBasis>;

/** One input the intent was derived from (spec file, issue, PR description, signals). */
export const IntentSource = z.object({
  kind: IntentBasis,
  ref: z.string(),
  truncated: z.boolean(),
});
export type IntentSource = z.infer<typeof IntentSource>;

/** A reference found in the PR that could not be resolved/fetched. */
export const UnresolvedRef = z.object({
  ref: z.string(),
  reason: z.string(),
});
export type UnresolvedRef = z.infer<typeof UnresolvedRef>;

export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  risk_areas: z.array(z.object({ label: z.string(), kind: IntentRiskKind })),
  confidence: IntentConfidence,
  basis: IntentBasis,
  sources: z.array(IntentSource),
  unresolved_refs: z.array(UnresolvedRef),
});
export type Intent = z.infer<typeof Intent>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

/** Degradation reason for blast radius computation. */
export const BlastDegradedReason = z.enum(['flag_off', 'index_failed', 'index_partial', 'repo_too_large', 'no_data']);
export type BlastDegradedReason = z.infer<typeof BlastDegradedReason>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'tests', 'wiring', 'docs', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
  finding_ids: z.array(z.string()),
  max_severity: Severity.nullable(),
  rank_percentile: z.number().nullable(),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
  files_with_findings: z.number().int(),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Composed PR Brief (pr_brief.json) ----
export const BriefMissingInput = z.enum(['intent', 'blast', 'specs', 'review_findings']);
export type BriefMissingInput = z.infer<typeof BriefMissingInput>;

export const BriefBlast = z.object({
  summary: z.string(),
  caller_files: z.array(z.string()),
  degraded_reason: BlastDegradedReason.nullable(),
});
export type BriefBlast = z.infer<typeof BriefBlast>;

export const ReviewFocusItem = z.object({
  file: z.string(),
  line: z.number().int(),
  reason: z.string(),
});
export type ReviewFocusItem = z.infer<typeof ReviewFocusItem>;

export const PrBrief = z.object({
  summary: z.string(),
  intent: Intent.nullable(),
  intent_stale: z.boolean(),
  blast: BriefBlast.nullable(),
  risks: Risks,
  review_focus: z.array(ReviewFocusItem),
  history: PrHistory.default({ history: [] }),
  missing_inputs: z.array(BriefMissingInput),
  head_sha: z.string(),
  generated_at: z.string().datetime(),
  model: z.string(),
  cost_usd: z.number().nullable(),
});
export type PrBrief = z.infer<typeof PrBrief>;

export const PrBriefState = z.object({
  brief: PrBrief.nullable(),
  stale: z.boolean(),
});
export type PrBriefState = z.infer<typeof PrBriefState>;
