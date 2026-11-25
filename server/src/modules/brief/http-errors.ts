import { AppError } from '../../platform/errors.js';
import { BriefDomainError } from './domain.js';

const STATUS: Record<BriefDomainError['code'], number> = {
  pr_not_found: 404,
  brief_in_progress: 409,
  llm_not_configured: 422,
  brief_failed: 502,
};

/** Map brief domain errors to the API error envelope (inbound side). */
export function toHttpError(err: unknown): unknown {
  if (err instanceof BriefDomainError) return new AppError(err.code, err.message, STATUS[err.code]);
  return err;
}
