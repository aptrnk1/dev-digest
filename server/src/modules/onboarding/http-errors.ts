import { AppError } from '../../platform/errors.js';
import { OnboardingDomainError } from './domain.js';

const STATUS: Record<OnboardingDomainError['code'], number> = {
  repo_not_cloned: 409,
  onboarding_in_progress: 409,
  llm_not_configured: 422,
};

/** Map onboarding domain errors to the API error envelope (inbound side). */
export function toHttpError(err: unknown): unknown {
  if (err instanceof OnboardingDomainError) return new AppError(err.code, err.message, STATUS[err.code]);
  return err;
}
