/* hooks/intent.ts — React Query hooks for the PR Intent Layer: read the stored
   intent (+ stale flag) and derive / re-derive it on demand. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { DeriveIntentBody, PrIntentRecord, PrIntentState } from "@devdigest/shared";

export function usePrIntent(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["pr-intent", prId],
    queryFn: () => api.get<PrIntentState>(`/pulls/${prId}/intent`),
    enabled: !!prId,
  });
}

/** Derive the intent (or re-derive with `force`); refreshes the cached state. */
export function useDeriveIntent(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DeriveIntentBody = {}) =>
      api.post<PrIntentRecord>(`/pulls/${prId}/intent`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pr-intent", prId] }),
  });
}
