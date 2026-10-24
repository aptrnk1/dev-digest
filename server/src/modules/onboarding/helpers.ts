import type { OnboardingJob } from '@devdigest/shared';
import { ERROR_MESSAGES, STALE_RUN_MS } from './constants.js';
import { isStaleRunning } from './domain.js';
import type { JobRecord } from './ports.js';

/** Row → API job. A crashed `running` row is reported as `failed` (AC50). */
export function toJobDto(job: JobRecord, now: Date): OnboardingJob {
  if (isStaleRunning(job, now, STALE_RUN_MS)) {
    return {
      status: 'failed',
      error: ERROR_MESSAGES.stale,
      started_at: job.startedAt.toISOString(),
      finished_at: null,
    };
  }
  return {
    status: job.status,
    error: job.error,
    started_at: job.startedAt.toISOString(),
    finished_at: job.finishedAt ? job.finishedAt.toISOString() : null,
  };
}
