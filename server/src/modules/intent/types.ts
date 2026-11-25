import type { Intent, PrIntentRecord } from '@devdigest/shared';

/** Run-log sink (Live Log + trace). `RunLogger` satisfies it. */
export interface IntentLog {
  info(msg: string): void;
  error(msg: string): void;
}

export interface EnsureIntentOptions {
  /** Skip the input-hash cache and re-run the classifier. */
  force?: boolean;
  log?: IntentLog;
}

/**
 * What other modules (reviews) get from `container.intent` — the same pattern
 * as `container.repoIntel`. Reviews never import the intent module's internals.
 */
export interface IntentFacade {
  ensure(workspaceId: string, prId: string, opts?: EnsureIntentOptions): Promise<PrIntentRecord>;
  /** Plain-text rendering for `ReviewInput.intent` (reviewer-core wraps it as untrusted). */
  renderForPrompt(intent: Intent): string;
}
