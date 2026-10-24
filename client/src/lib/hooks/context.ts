/* hooks/context.ts — Project Context hooks: repo documents, preview, usage and
   per-(agent|skill, repo) attachments. `useContextFiles` lives in core.ts. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { SpecFile, ContextDocUsage, ContextAttachments } from "../types";

export interface ContextOwner {
  kind: "agent" | "skill";
  id: string;
}

const enc = encodeURIComponent;
const attachUrl = (o: ContextOwner, repoId: string) =>
  `/${o.kind}s/${o.id}/context?repo_id=${enc(repoId)}`;
const attachKey = (o: ContextOwner, repoId: string | null) =>
  ["context-attachments", o.kind, o.id, repoId] as const;

/* Per-(owner, repo) promise chain: read-modify-write toggles and panel saves
   for one owner run strictly one after another. */
const queues = new Map<string, Promise<unknown>>();
function enqueue<T>(o: ContextOwner, repoId: string, task: () => Promise<T>): Promise<T> {
  const k = `${o.kind}:${o.id}:${repoId}`;
  const run = (queues.get(k) ?? Promise.resolve()).catch(() => undefined).then(task);
  const tail = run.catch(() => undefined);
  queues.set(k, tail);
  void tail.then(() => {
    if (queues.get(k) === tail) queues.delete(k);
  });
  return run;
}

export function useContextFile(repoId: string | null | undefined, path: string | null) {
  return useQuery({
    queryKey: ["context", repoId, "file", path],
    queryFn: () => api.get<SpecFile>(`/repos/${repoId}/context/file?path=${enc(path!)}`),
    enabled: !!repoId && !!path,
  });
}

export function useContextUsage(repoId: string | null | undefined, path: string | null) {
  return useQuery({
    queryKey: ["context", repoId, "usage", path],
    queryFn: () => api.get<ContextDocUsage>(`/repos/${repoId}/context/usage?path=${enc(path!)}`),
    enabled: !!repoId && !!path,
  });
}

export function useContextAttachments(owner: ContextOwner, repoId: string | null) {
  return useQuery({
    queryKey: attachKey(owner, repoId),
    queryFn: () => api.get<ContextAttachments>(attachUrl(owner, repoId!)),
    enabled: !!repoId,
  });
}

/* Per-key bookkeeping for queued saves: how many are in flight and the last
   server-confirmed list (the rollback target). */
const saves = new Map<string, { pending: number; confirmed?: ContextAttachments }>();

/** Replace the (owner, repo) attachment list; optimistic, rolled back to the last
    confirmed state when the last queued save fails; refetch only once drained. */
export function useSetContextAttachments(owner: ContextOwner, repoId: string | null) {
  const qc = useQueryClient();
  const key = attachKey(owner, repoId);
  const sk = key.join(":");
  return useMutation({
    mutationFn: (paths: string[]) =>
      enqueue(owner, repoId!, async () => {
        const res = await api.put<ContextAttachments>(attachUrl(owner, repoId!), { paths });
        const st = saves.get(sk);
        if (st) st.confirmed = res;
        return res;
      }),
    onMutate: async (paths) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ContextAttachments>(key);
      const st = saves.get(sk) ?? { pending: 0 };
      if (st.pending === 0) st.confirmed = previous;
      st.pending++;
      saves.set(sk, st);
      if (previous) {
        const byPath = new Map(previous.attached.map((a) => [a.path, a]));
        qc.setQueryData<ContextAttachments>(key, {
          ...previous,
          attached: paths.map((p) => byPath.get(p) ?? { path: p, status: "ok", tokens: null }),
        });
      }
    },
    onSettled: (_d, error) => {
      const st = saves.get(sk);
      if (!st) return;
      st.pending--;
      if (st.pending > 0) return;
      saves.delete(sk);
      if (error && st.confirmed) qc.setQueryData(key, st.confirmed);
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["context", repoId, "usage"] });
    },
  });
}

/** Refresh everything Project Context shows for a repo (list, preview, usage, attachment statuses). */
export function useRefreshContext(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["context", repoId] });
    qc.invalidateQueries({ queryKey: ["context-attachments"] });
  };
}

/** Attach (append) or detach (keep order of the rest) one doc for an owner. */
export function useToggleDocAttachment(repoId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ owner, path, attach }: { owner: ContextOwner; path: string; attach: boolean }) =>
      enqueue(owner, repoId, async () => {
        const cur = await api.get<ContextAttachments>(attachUrl(owner, repoId));
        const rest = cur.attached.map((a) => a.path).filter((p) => p !== path);
        return api.put<ContextAttachments>(attachUrl(owner, repoId), {
          paths: attach ? [...rest, path] : rest,
        });
      }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["context-attachments"] });
      qc.invalidateQueries({ queryKey: ["context", repoId, "usage"] });
    },
  });
}
