import type { IntentBasis, IntentConfidence } from '@devdigest/shared';
import { MIN_MEANINGFUL_CHARS } from './constants.js';

/**
 * Intent rules that hold regardless of storage, transport or model: the
 * strongest evidence tier sets a confidence CEILING and the classifier may
 * only lower it. Pure: no I/O, no zod, no framework.
 */

export class IntentDomainError extends Error {
  constructor(
    readonly code: 'llm_not_configured' | 'pr_not_found',
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export interface EvidenceSignals {
  /** At least one spec/plan document was read at head. */
  specRead: boolean;
  /** A fetched issue with a non-empty body. */
  ticketWithBody: boolean;
  /** A fetched issue that has only a title. */
  ticketTitleOnly: boolean;
  /** Length of the PR description after removing template noise. */
  descriptionChars: number;
}

const RANK: Record<IntentConfidence, number> = { low: 0, medium: 1, high: 2 };

/** PR body without HTML comments, headings, checkbox lines and blank space. */
export function meaningfulText(body: string | null | undefined): string {
  if (!body) return '';
  return body
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !/^#{1,6}(\s|$)/.test(l) && !/^[-*+]\s*\[[ xX]\]/.test(l))
    .join(' ')
    .trim();
}

/** Strongest tier present → ceiling + basis (spec §4). */
export function evidenceTier(s: EvidenceSignals): { ceiling: IntentConfidence; basis: IntentBasis } {
  if (s.specRead) return { ceiling: 'high', basis: 'spec' };
  if (s.ticketWithBody) return { ceiling: 'high', basis: 'ticket' };
  if (s.ticketTitleOnly) return { ceiling: 'medium', basis: 'ticket' };
  if (s.descriptionChars >= MIN_MEANINGFUL_CHARS) return { ceiling: 'medium', basis: 'description' };
  return { ceiling: 'low', basis: 'inferred' };
}

/** `confidence = min(ceiling, llm)`. */
export function applyCeiling(ceiling: IntentConfidence, llm: IntentConfidence): IntentConfidence {
  return RANK[llm] < RANK[ceiling] ? llm : ceiling;
}
