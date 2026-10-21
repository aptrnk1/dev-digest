/** Intent Layer — module literals (limits are spec §3, LLM call is spec §5). */

export const MAX_SPEC_DOCS = 3;
export const MAX_SPEC_CHARS = 6000;
export const MAX_ISSUES = 3;
export const MAX_ISSUE_CHARS = 4000;
/** Same cap as reviewer-core's MAX_PR_DESCRIPTION_CHARS. */
export const MAX_BODY_CHARS = 4000;
export const MAX_COMMITS = 30;
export const MAX_PATHS = 100;
/** Server-side cap for every array the classifier returns. */
export const MAX_LIST_ITEMS = 6;
export const MAX_COMMIT_LINE_CHARS = 200;

export const TRUNCATION_MARK = '…[truncated]';
/** Description needs at least this much non-template text to count as evidence. */
export const MIN_MEANINGFUL_CHARS = 80;

/** Spec/plan links are read only when they end in one of these. */
export const SPEC_EXTENSIONS: readonly string[] = ['.md', '.mdx', '.txt'];

/** Upper-case prefixes that look like a Jira key (`UTF-8`) but are not. */
export const NOT_JIRA_PREFIXES: ReadonlySet<string> = new Set([
  'UTF', 'SHA', 'ISO', 'MD', 'CVE', 'RFC', 'HTTP', 'TLS', 'AES', 'RSA', 'GPT', 'PEP', 'CRC', 'BASE', 'IPV',
]);

export const ISSUE_TIMEOUT_MS = 5_000;
export const LLM_TIMEOUT_MS = 20_000;
export const LLM_MAX_RETRIES = 1;
export const INTENT_SCHEMA_NAME = 'pr_intent';
