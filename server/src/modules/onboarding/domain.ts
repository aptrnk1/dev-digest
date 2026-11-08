/**
 * Onboarding Tour rules independent of storage, transport or model.
 * Pure: no I/O, no zod, no framework.
 */

export class OnboardingDomainError extends Error {
  constructor(
    readonly code: 'repo_not_cloned' | 'onboarding_in_progress' | 'llm_not_configured',
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Aborts a generation without a provider error; the service maps `kind` to a fixed message. */
export class GenerationAbort extends Error {
  constructor(readonly kind: 'deadline' | 'context_too_large') {
    super(kind);
    this.name = new.target.name;
  }
}

/** A `running` job older than `staleMs` is a crashed run. */
export function isStaleRunning(
  job: { status: string; startedAt: Date },
  now: Date,
  staleMs: number,
): boolean {
  return job.status === 'running' && now.getTime() - job.startedAt.getTime() > staleMs;
}

/**
 * Syntactic check of a repo-relative path the model cites: not absolute, no
 * `..` segment, no backslash, no NUL, no empty segment. `..notes.md` is fine.
 * Existence inside the clone is checked separately (RepoFiles).
 */
export function isSafeRelativePath(p: string): boolean {
  if (!p || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return false;
  if (p.includes('\\') || p.includes('\0')) return false;
  return !p.split('/').some((seg) => seg === '..' || seg === '');
}
