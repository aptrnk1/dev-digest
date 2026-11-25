/** PR Brief rules independent of storage, transport or model. Pure: no I/O, no zod, no framework. */

export type BriefErrorCode = 'pr_not_found' | 'brief_in_progress' | 'llm_not_configured' | 'brief_failed';

export class BriefDomainError extends Error {
  constructor(
    readonly code: BriefErrorCode,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
