import type { OnboardingJob, OnboardingTourResponse } from '@devdigest/shared';

/** What `container.onboarding` exposes to the routes; `undefined` = repo not found. */
export interface OnboardingFacade {
  get(workspaceId: string, repoId: string): Promise<OnboardingTourResponse | undefined>;
  generate(workspaceId: string, repoId: string): Promise<OnboardingJob | undefined>;
}
