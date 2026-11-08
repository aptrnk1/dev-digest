import type { SpecFile } from "@devdigest/shared";

export interface DocGroup {
  folder: string;
  docs: SpecFile[];
}

/** Group docs by `folder`, keeping first-appearance order (the API sorts by path). */
export function groupByFolder(docs: SpecFile[]): DocGroup[] {
  const groups = new Map<string, SpecFile[]>();
  for (const d of docs) {
    const bucket = groups.get(d.folder);
    if (bucket) bucket.push(d);
    else groups.set(d.folder, [d]);
  }
  return [...groups].map(([folder, items]) => ({ folder, docs: items }));
}

/** AC14: requested `?doc=` (any status) → first `ok` doc → first doc. */
export function pickSelected(docs: SpecFile[], requested: string | null): SpecFile | null {
  return (
    docs.find((d) => d.path === requested) ?? docs.find((d) => d.status === "ok") ?? docs[0] ?? null
  );
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
