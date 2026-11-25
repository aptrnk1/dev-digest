/* hooks/onboarding.ts — React Query hooks for the Onboarding Tour (generate a
   tour of a repo, read it back). The tour query polls while a generation is
   `running`; a failed refetch keeps the last data on screen. */
"use client";

import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../api";
import type {
  OnboardingGenerateResponse,
  OnboardingJob,
  OnboardingTourResponse,
} from "@devdigest/shared";

/** Poll cadence while the latest generation is `running`. */
const GENERATE_POLL_MS = 2000;

export const onboardingQueries = {
  tour: (repoId: string) =>
    queryOptions<OnboardingTourResponse, ApiError>({
      queryKey: ["onboarding", repoId],
      queryFn: () => api.get<OnboardingTourResponse>(`/repos/${repoId}/onboarding`),
    }),
};

export function useOnboardingTour(repoId: string) {
  return useQuery<OnboardingTourResponse, ApiError>({
    ...onboardingQueries.tour(repoId),
    enabled: !!repoId,
    retry: false,
    // `state.data` is the last successful payload, so a failed poll neither
    // clears it nor stops the interval.
    refetchInterval: (query) => (query.state.data?.job?.status === "running" ? GENERATE_POLL_MS : false),
  });
}

/** Start a generation (202). A 409 `onboarding_in_progress` is not an error for
 *  the UI: the run is already going, so we just refetch and poll. */
export function useGenerateOnboarding(repoId: string) {
  const qc = useQueryClient();
  const key = onboardingQueries.tour(repoId).queryKey;
  return useMutation<OnboardingGenerateResponse, ApiError, void>({
    mutationFn: async () => {
      try {
        return await api.post<OnboardingGenerateResponse>(`/repos/${repoId}/onboarding/generate`);
      } catch (e) {
        if (e instanceof ApiError && e.code === "onboarding_in_progress") {
          const cached = qc.getQueryData<OnboardingTourResponse>(key)?.job;
          const job: OnboardingJob = cached ?? {
            status: "running",
            error: null,
            started_at: new Date().toISOString(),
            finished_at: null,
          };
          return { job: job.status === "running" ? job : { ...job, status: "running", error: null, finished_at: null } };
        }
        throw e;
      }
    },
    onSuccess: ({ job }) => {
      qc.setQueryData<OnboardingTourResponse>(key, (prev) => ({ tour: prev?.tour ?? null, job }));
      return qc.invalidateQueries({ queryKey: key });
    },
    onError: () => qc.invalidateQueries({ queryKey: key }),
  });
}
