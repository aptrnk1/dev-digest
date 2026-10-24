import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { ContextDomainError } from './domain.js';

/** Map context domain errors to the API error envelope (inbound side). */
export function toHttpError(err: unknown): unknown {
  if (!(err instanceof ContextDomainError)) return err;
  switch (err.code) {
    case 'repo_not_cloned':
      return new AppError('repo_not_cloned', err.message, 409);
    case 'invalid_path':
      return new ValidationError(err.message);
    default:
      return new NotFoundError(err.message);
  }
}
