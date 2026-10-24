export const MAX_DOC_BYTES = 1_048_576;
export const MAX_DOCS = 500;
export const MAX_ATTACHMENTS = 50;
export const CONTEXT_TOKEN_BUDGET = 8000;

/** Directories never scanned; any dot-directory except `.devdigest` is skipped too. */
export const EXCLUDED_DIRS = ['node_modules', '.git', 'dist', 'build', 'vendor'] as const;
export const INCLUDED_DOT_DIR = '.devdigest';
export const DOC_EXTENSIONS = ['.md', '.mdx'] as const;
