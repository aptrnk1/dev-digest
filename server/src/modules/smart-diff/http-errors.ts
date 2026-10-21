import { NotFoundError } from '../../platform/errors.js';
import { SmartDiffDomainError } from './domain.js';

/** Map smart-diff domain errors to the API error envelope (inbound side). */
export function toHttpError(err: unknown): unknown {
  if (err instanceof SmartDiffDomainError) return new NotFoundError(err.message);
  return err;
}
