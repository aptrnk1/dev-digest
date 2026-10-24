/** PR Brief — module literals (limits are spec §3 / plan Constraints). */

export const LLM_TIMEOUT_MS = 45_000;
/** Attempts in the service's own retry loop (maxRetries 0 on the provider). */
export const LLM_MAX_ATTEMPTS = 2;
export const BRIEF_SCHEMA_NAME = 'pr_brief';

// ---- input limits ----
export const MAX_FILES = 100;
export const MAX_RANGES_PER_FILE = 20;
export const MAX_ANCHORS = 30;
export const MAX_BLAST_CALLERS = 50;
export const MAX_BLAST_SYMBOLS = 30;
export const MAX_DESCRIPTION_CHARS = 4000;
export const MAX_PROMPT_TOKENS = 20_000;
/** Spec token budget is enforced by `resolveForRepo`; kept here for the record. */
export const MAX_SPEC_TOKENS = 8000;

// ---- output limits ----
export const MAX_RISKS = 6;
export const MAX_FOCUS = 6;
export const MAX_SUMMARY = 600;
export const MAX_REASON = 200;
export const MAX_RISK_TITLE = 120;
export const MAX_EXPLANATION = 500;
export const MAX_KIND = 40;
