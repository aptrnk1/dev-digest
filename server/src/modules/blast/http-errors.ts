import { NotFoundError } from '../../platform/errors.js';
import { BlastDomainError } from './domain.js';

/** Map blast domain errors to the API error envelope (inbound side). */
export function toHttpError(err: unknown): unknown {
  if (err instanceof BlastDomainError) return new NotFoundError(err.message);
  return err;
}
