import { describe, it, expect } from "vitest";
import type { FindingRecord, PrFile, ReviewRecord, SmartDiffResponse } from "@devdigest/shared";
import { indexFindings, resolveGroups } from "./helpers";

const fnd = (id: string) => ({ id, severity: "WARNING", file: "a.ts" }) as FindingRecord;
const review = (findings: FindingRecord[]) => ({ findings }) as unknown as ReviewRecord;

const sd = (groups: SmartDiffResponse["groups"]): SmartDiffResponse => ({
  groups,
  split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
});
const sfile = (path: string, ids: string[] = []) => ({
  path,
  additions: 1,
  deletions: 0,
  finding_lines: [],
  finding_ids: ids,
  max_severity: ids.length ? ("WARNING" as const) : null,
  rank_percentile: null,
});
const pf = (path: string): PrFile => ({ path, additions: 1, deletions: 0, patch: "@@ -1 +1 @@\n+x" });

describe("indexFindings", () => {
  it("indexes findings across reviews; tolerates undefined", () => {
    const idx = indexFindings([review([fnd("a")]), review([fnd("b")])]);
    expect([...idx.keys()]).toEqual(["a", "b"]);
    expect(indexFindings(undefined).size).toBe(0);
  });
});

describe("resolveGroups", () => {
  it("keeps server order, attaches patch and findings", () => {
    const g = resolveGroups(
      sd([
        { role: "core", files_with_findings: 1, files: [sfile("a.ts", ["f1"])] },
        { role: "tests", files_with_findings: 0, files: [sfile("a.test.ts")] },
      ]),
      [pf("a.test.ts"), pf("a.ts")],
      indexFindings([review([fnd("f1")])]),
    );
    expect(g.map((x) => x.role)).toEqual(["core", "tests"]);
    expect(g[0]!.files[0]!.file.patch).toContain("+x");
    expect(g[0]!.files[0]!.findings.map((f) => f.id)).toEqual(["f1"]);
    expect(g[0]!.files[0]!.maxSeverity).toBe("WARNING");
    expect(g[1]!.files[0]!.findings).toEqual([]);
  });

  it("drops finding ids that are not loaded", () => {
    const g = resolveGroups(
      sd([{ role: "core", files_with_findings: 1, files: [sfile("a.ts", ["gone"])] }]),
      [pf("a.ts")],
      new Map(),
    );
    expect(g[0]!.files[0]!.findings).toEqual([]);
    expect(g[0]!.files[0]!.maxSeverity).toBeNull();
  });

  it("appends PR files missing from the smart-diff to Core without overlay", () => {
    const g = resolveGroups(
      sd([{ role: "tests", files_with_findings: 0, files: [sfile("a.test.ts")] }]),
      [pf("a.test.ts"), pf("new.ts")],
      new Map(),
    );
    expect(g.map((x) => x.role)).toEqual(["core", "tests"]);
    expect(g[0]!.files.map((f) => f.file.path)).toEqual(["new.ts"]);
    const g2 = resolveGroups(
      sd([{ role: "core", files_with_findings: 0, files: [sfile("a.ts")] }]),
      [pf("a.ts"), pf("b.ts")],
      new Map(),
    );
    expect(g2[0]!.files.map((f) => f.file.path)).toEqual(["a.ts", "b.ts"]);
  });
});
