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

/** Replace the (owner, repo) attachment list; optimistic, rolled back on error. */
export function useSetContextAttachments(owner: ContextOwner, repoId: string | null) {
  const qc = useQueryClient();
  const key = attachKey(owner, repoId);
  return useMutation({
    mutationFn: (paths: string[]) =>
      enqueue(owner, repoId!, () =>
        api.put<ContextAttachments>(attachUrl(owner, repoId!), { paths }),
      ),
    onMutate: async (paths) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ContextAttachments>(key);
      if (previous) {
        const byPath = new Map(previous.attached.map((a) => [a.path, a]));
        qc.setQueryData<ContextAttachments>(key, {
          ...previous,
          attached: paths.map((p) => byPath.get(p) ?? { path: p, status: "ok", tokens: null }),
        });
      }
      return { previous };
    },
    onError: (_e, _paths, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["context", repoId, "usage"] });
    },
  });
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
