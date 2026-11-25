/** Blast-radius domain errors. The mapping itself is pure and lives in `helpers.ts`. */
export class BlastDomainError extends Error {
  constructor(
    readonly code: 'pr_not_found',
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
