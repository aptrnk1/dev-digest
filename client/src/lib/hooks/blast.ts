/* hooks/blast.ts — React Query hook for a PR's blast radius (callers + the
   endpoints/crons that depend on the changed symbols). */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { BlastRadiusResponse } from "@devdigest/shared";

export function useBlastRadius(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["blast", prId],
    queryFn: () => api.get<BlastRadiusResponse>(`/pulls/${prId}/blast-radius`),
    enabled: !!prId,
  });
}
