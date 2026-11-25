import { z } from 'zod';
import { Finding, Verdict } from './findings.js';
import { Intent, SmartDiff, BlastRadius } from './brief.js';

/**
 * A2 — Review-Core API surface contracts. These extend the core
 * Review/Finding/Intent/SmartDiff contracts with the persisted/transport shapes
 * the reviewer endpoints return. A2 owns this file; the barrel re-exports it.
 *
 * Distinct from `Finding` (the raw LLM-output unit): `FindingRecord` adds the
 * persisted row identity + action timestamps so the UI can render accept/dismiss
 * state and the `review_id` it belongs to.
 */

export const FindingRecord = Finding.extend({
  review_id: z.string(),
  accepted_at: z.string().nullable(),
  dismissed_at: z.string().nullable(),
});
export type FindingRecord = z.infer<typeof FindingRecord>;

/** A persisted review with its kept findings + grounding summary. */
export const ReviewRecord = z.object({
  id: z.string(),
  pr_id: z.string(),
  agent_id: z.string().nullable(),
  run_id: z.string().nullable(),
  agent_name: z.string().nullish(),
  kind: z.enum(['summary', 'review']),
  verdict: Verdict.nullable(),
  summary: z.string().nullable(),
  score: z.number().int().nullable(),
  model: z.string().nullable(),
  grounding: z.string().nullish(),
  created_at: z.string(),
  findings: z.array(FindingRecord),
});
export type ReviewRecord = z.infer<typeof ReviewRecord>;

/**
 * Response of `POST /pulls/:id/review`. Each requested agent produces a run that
 * streams over SSE at `/runs/:runId/events`; clients subscribe per run. The
 * persisted reviews are also returned once the (synchronous) run completes.
 */
export const ReviewRunTarget = z.object({
  run_id: z.string(),
  agent_id: z.string(),
  agent_name: z.string(),
});
export type ReviewRunTarget = z.infer<typeof ReviewRunTarget>;

export const ReviewRunResponse = z.object({
  pr_id: z.string(),
  runs: z.array(ReviewRunTarget),
  reviews: z.array(ReviewRecord),
});
export type ReviewRunResponse = z.infer<typeof ReviewRunResponse>;

/** Intent persisted for a PR (the Intent plus the pr_id it scopes). */
export const PrIntentRecord = Intent.extend({
  pr_id: z.string(),
  head_sha: z.string(),
  model: z.string().nullable(),
  cost_usd: z.number().nullable(),
  updated_at: z.string().nullable(),
});
export type PrIntentRecord = z.infer<typeof PrIntentRecord>;

/** `GET /pulls/:id/intent` — cached intent (or null) + whether it lags the PR head. */
export const PrIntentState = z.object({
  intent: PrIntentRecord.nullable(),
  stale: z.boolean(),
});
export type PrIntentState = z.infer<typeof PrIntentState>;

/** `POST /pulls/:id/intent` body. */
export const DeriveIntentBody = z.object({ force: z.boolean().optional() });
export type DeriveIntentBody = z.infer<typeof DeriveIntentBody>;

/** Smart-diff response for a PR (the SmartDiff). */
export const SmartDiffResponse = SmartDiff;
export type SmartDiffResponse = z.infer<typeof SmartDiffResponse>;

/** Degradation reason for blast radius computation. */
export const BlastDegradedReason = z.enum(['flag_off', 'index_failed', 'index_partial', 'repo_too_large', 'no_data']);
export type BlastDegradedReason = z.infer<typeof BlastDegradedReason>;

/** Statistics about blast radius impact. */
export const BlastStats = z.object({
  symbols: z.number().int().nonnegative(),
  callers: z.number().int().nonnegative(),
  endpoints: z.number().int().nonnegative(),
  crons: z.number().int().nonnegative(),
});
export type BlastStats = z.infer<typeof BlastStats>;

/** `GET /pulls/:id/blast-radius` — blast radius with PR context and degradation state. */
export const BlastRadiusResponse = BlastRadius.extend({
  pr_id: z.string(),
  index_sha: z.string().nullable(),
  stats: BlastStats,
  degraded: z.boolean(),
  degraded_reason: BlastDegradedReason.nullable(),
});
export type BlastRadiusResponse = z.infer<typeof BlastRadiusResponse>;
