/* hooks/brief.ts — React Query hooks for the PR Risk Brief: read the stored
   brief (+ stale flag) and generate / regenerate it on demand. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiError } from "../api";
import type { PrBrief, PrBriefState } from "@devdigest/shared";

export function usePrBrief(prId: string | null | undefined) {
  return useQuery<PrBriefState, ApiError>({
    queryKey: ["pr-brief", prId],
    queryFn: () => api.get<PrBriefState>(`/pulls/${prId}/brief`),
    enabled: !!prId,
  });
}

/** Generate (or regenerate) the brief. The POST carries no body, signal or
 *  timeout — the LLM call can take ~100 s and the client must not cut it. */
export function useGenerateBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation<PrBrief, ApiError, void>({
    mutationFn: () => api.post<PrBrief>(`/pulls/${prId}/brief`),
    onSuccess: (brief) =>
      qc.setQueryData<PrBriefState>(["pr-brief", prId], { brief, stale: false }),
  });
}
