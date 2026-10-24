import type { ContextAttachments, SpecFile } from "@devdigest/shared";

export type RowStatus = "ok" | "too_large" | "missing";

interface RowBase {
  path: string;
  folder: string;
  category: SpecFile["category"] | null;
  status: RowStatus;
  tokens: number | null;
}
export type Row =
  | (RowBase & { kind: "own" })
  | (RowBase & { kind: "inherited"; skillName: string })
  | (RowBase & { kind: "free" });

export const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const folderOf = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);

/** Own attachments (saved order) → inherited (merge order) → remaining docs by path. */
export function buildRows(docs: SpecFile[], att: ContextAttachments): Row[] {
  const byPath = new Map(docs.map((d) => [d.path, d]));
  const meta = (path: string) => {
    const d = byPath.get(path);
    return { folder: d?.folder ?? folderOf(path), category: d?.category ?? null };
  };
  const rows: Row[] = att.attached.map((a) => ({
    kind: "own",
    path: a.path,
    ...meta(a.path),
    status: a.status,
    tokens: a.tokens,
  }));
  const seen = new Set(att.attached.map((a) => a.path));
  for (const i of att.inherited) {
    if (seen.has(i.path)) continue;
    seen.add(i.path);
    rows.push({
      kind: "inherited",
      path: i.path,
      ...meta(i.path),
      status: i.status,
      tokens: i.tokens,
      skillName: i.skill_name,
    });
  }
  const rest = docs
    .filter((d) => !seen.has(d.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map(
      (d): Row => ({
        kind: "free",
        path: d.path,
        folder: d.folder,
        category: d.category,
        status: d.status,
        tokens: d.tokens,
      }),
    );
  return [...rows, ...rest];
}

export function filterRows(rows: Row[], query: string): Row[] {
  const q = query.trim().toLowerCase();
  return q ? rows.filter((r) => r.path.toLowerCase().includes(q)) : rows;
}

/** Move one item; out-of-range or no-op moves return the same array. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved as T);
  return next;
}

export function summarize(rows: Row[]) {
  const counted = rows.filter((r) => r.kind !== "free" && r.status === "ok");
  return {
    attachedPaths: rows.filter((r) => r.kind === "own").map((r) => r.path),
    okTokens: counted.reduce((n, r) => n + (r.tokens ?? 0), 0),
  };
}

export function isNotCloned(err: unknown): boolean {
  const e = err as { status?: number; code?: string } | null;
  return e?.status === 409 || e?.code === "repo_not_cloned";
}
