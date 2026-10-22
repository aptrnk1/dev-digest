import { describe, it, expect } from "vitest";
import type { BlastRadiusResponse } from "@devdigest/shared";
import { layoutBlastGraph, MAX_GRAPH_CALLERS } from "./layout";

type Downstream = BlastRadiusResponse["downstream"];

const DS: Downstream = [
  {
    symbol: "charge",
    callers: [
      { name: "checkout", file: "src/checkout.ts", line: 23 },
      { name: "shared", file: "src/shared.ts", line: 5 },
    ],
    endpoints_affected: ["POST /checkout"],
    crons_affected: ["0 * * * *"],
  },
  {
    symbol: "refund",
    callers: [{ name: "shared", file: "src/shared.ts", line: 5 }],
    endpoints_affected: ["POST /checkout"],
    crons_affected: [],
  },
];

describe("layoutBlastGraph", () => {
  it("places symbols, callers and affected nodes in three columns", () => {
    const g = layoutBlastGraph(DS);
    const x = (k: string) => g.nodes.find((n) => n.kind === k)!.x;
    expect(x("symbol")).toBeLessThan(x("caller"));
    expect(x("caller")).toBeLessThan(x("endpoint"));
    expect(x("endpoint")).toBe(x("cron"));
  });

  it("dedupes callers by name+file with one edge per symbol", () => {
    const g = layoutBlastGraph(DS);
    expect(g.nodes.filter((n) => n.kind === "caller")).toHaveLength(2);
    const toShared = g.edges.filter((e) => e.to.includes("shared") && !e.dashed);
    expect(toShared.map((e) => e.from).sort()).toEqual(["s:charge", "s:refund"]);
  });

  it("dedupes endpoint and cron nodes; dashed edges are symbol to endpoint/cron only", () => {
    const g = layoutBlastGraph(DS);
    expect(g.nodes.filter((n) => n.kind === "endpoint")).toHaveLength(1);
    expect(g.nodes.filter((n) => n.kind === "cron")).toHaveLength(1);
    const dashed = g.edges.filter((e) => e.dashed);
    expect(dashed).toHaveLength(3);
    for (const e of dashed) expect(e.from.startsWith("s:")).toBe(true);
    for (const e of g.edges.filter((e) => !e.dashed)) expect(e.to.startsWith("c:")).toBe(true);
  });

  it("caps callers at MAX_GRAPH_CALLERS and reports the hidden count", () => {
    const callers = Array.from({ length: MAX_GRAPH_CALLERS + 5 }, (_, i) => ({
      name: `f${i}`,
      file: `src/f${i}.ts`,
      line: i + 1,
    }));
    const g = layoutBlastGraph([{ symbol: "s", callers, endpoints_affected: [], crons_affected: [] }]);
    expect(g.nodes.filter((n) => n.kind === "caller")).toHaveLength(MAX_GRAPH_CALLERS);
    expect(g.hiddenCallers).toBe(5);
  });

  it("returns no nodes for empty downstream", () => {
    const g = layoutBlastGraph([]);
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
    expect(g.hiddenCallers).toBe(0);
  });
});
