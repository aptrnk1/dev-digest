import { AppError, NotFoundError } from '../../platform/errors.js';
import { IntentDomainError } from './domain.js';

/** Map intent domain errors to the API error envelope (inbound side). */
export function toHttpError(err: unknown): unknown {
  if (err instanceof IntentDomainError) {
    if (err.code === 'pr_not_found') return new NotFoundError(err.message);
    return new AppError(err.code, err.message, 422);
  }
  return err;
}
