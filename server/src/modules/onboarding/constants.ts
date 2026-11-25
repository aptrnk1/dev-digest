/** Onboarding Tour — module literals (limits come from the spec, AC56/AC74/AC79). */

/** Wall-clock budget of one generation, from the `running` row (AC74). */
export const DEADLINE_MS = 180_000;
/** A `running` row older than this is a crashed run (AC50). */
export const STALE_RUN_MS = 600_000;
/** HTTP requests to the provider per generation: one call + at most one retry. */
export const MAX_HTTP_REQUESTS = 2;

/** Model input (AC56). */
export const MAX_TREE_PATHS = 500;
export const MAX_README_CHARS = 20_000;
export const MAX_MANIFEST_LINES = 400;
export const MAX_MANIFEST_CHARS = 20_000;
export const MAX_TOP_FILES = 15;
export const MAX_TOP_FILE_LINES = 200;
export const MAX_TOP_FILE_CHARS = 20_000;
/** cl100k tokens (`container.tokenizer`). */
export const MAX_INPUT_TOKENS = 60_000;

/** Model output caps (contract limits). */
export const MAX_SUMMARY = 800;
export const MAX_NODE_LABEL = 40;
export const MAX_NODES = 12;
export const MAX_EDGES = 20;
export const MAX_CRITICAL_PATHS = 8;
export const MAX_RUN_STEPS = 10;
export const MAX_READING_PATH = 8;
export const MAX_FIRST_TASKS = 5;
export const MAX_FIRST_TASK_FILES = 3;
export const MAX_DESCRIPTION = 140;
export const MAX_TASK_TITLE = 80;
export const MAX_COMMAND = 500;
export const MAX_ERROR = 200;

export const TREE_EXCLUDED_DIRS = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
  'vendor',
  '.git',
] as const;

/** Manifests read from the clone root, by exact name — exactly the AC56 pt.3 list. */
export const MANIFEST_FILES = [
  'package.json',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'Makefile',
  'Dockerfile',
  '.env.example',
] as const;

/** Only the NAMES of these are given to the model, never their content — exactly AC56 pt.4. */
export const LOCK_FILES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'] as const;

/** The only texts that may reach `job.error` (AC79). */
export const ERROR_MESSAGES = {
  deadline: 'The model did not respond within 180 s',
  schema: "The model returned a tour that doesn't match the expected format",
  network: "Couldn't reach the model provider",
  contextTooLarge: 'Repository context is too large for the model (over 60,000 tokens)',
  stale: 'Generation did not finish (the server stopped mid-run)',
  unexpected: 'Generation failed unexpectedly',
} as const;

export function httpError(status: number): string {
  return `The model provider returned an error (HTTP ${status})`;
}

/** Name of the structured-output schema sent to the provider. */
export const SCHEMA_NAME = 'OnboardingTourDraft';
