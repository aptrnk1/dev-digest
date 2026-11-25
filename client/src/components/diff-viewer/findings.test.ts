import { describe, it, expect } from "vitest";
import type { FindingRecord } from "@devdigest/shared";
import { parsePatch } from "./helpers";
import { anchorFindings } from "./findings";

const PATCH = ["@@ -1,3 +10,4 @@", " ctx", "+added a", "+added b", " ctx2"].join("\n");
// visible newNos: 10 (ctx), 11, 12 (adds), 13 (ctx)

function f(id: string, start: number, end: number, severity: FindingRecord["severity"] = "WARNING"): FindingRecord {
  return {
    id,
    severity,
    category: "security",
    title: id,
    file: "a.ts",
    start_line: start,
    end_line: end,
    rationale: "r",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  } as FindingRecord;
}

describe("anchorFindings", () => {
  const lines = parsePatch(PATCH);

  it("anchors on end_line when it is a visible new line", () => {
    const r = anchorFindings(lines, [f("a", 11, 12)]);
    expect(r.byNewLine.get(12)?.map((x) => x.id)).toEqual(["a"]);
    expect(r.fileLevel).toEqual([]);
  });

  it("falls back to the largest visible newNo within the range", () => {
    const r = anchorFindings(lines, [f("a", 11, 40)]);
    expect(r.byNewLine.get(13)?.map((x) => x.id)).toEqual(["a"]);
  });

  it("puts findings with no visible line in range at file level", () => {
    const r = anchorFindings(lines, [f("a", 50, 60)]);
    expect(r.byNewLine.size).toBe(0);
    expect(r.fileLevel.map((x) => x.id)).toEqual(["a"]);
  });

  it("without a patch every finding is file-level", () => {
    const r = anchorFindings([], [f("a", 11, 12), f("b", 1, 1)]);
    expect(r.byNewLine.size).toBe(0);
    expect(r.fileLevel).toHaveLength(2);
  });

  it("stacks CRITICAL before WARNING before SUGGESTION", () => {
    const r = anchorFindings(lines, [
      f("s", 12, 12, "SUGGESTION"),
      f("c", 12, 12, "CRITICAL"),
      f("w", 12, 12, "WARNING"),
    ]);
    expect(r.byNewLine.get(12)?.map((x) => x.id)).toEqual(["c", "w", "s"]);
    const g = anchorFindings([], [f("s", 1, 1, "SUGGESTION"), f("c", 1, 1, "CRITICAL")]);
    expect(g.fileLevel.map((x) => x.id)).toEqual(["c", "s"]);
  });
});
