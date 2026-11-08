import { describe, it, expect } from "vitest";
import { githubBlobUrl, parseSummary, toMermaid, truncateMiddle, SECTION_IDS } from "./helpers";

describe("parseSummary", () => {
  it("splits text, code chips and bold", () => {
    expect(parseSummary("**api** uses `src/a.ts` now")).toEqual([
      { type: "bold", value: "api" },
      { type: "text", value: " uses " },
      { type: "code", value: "src/a.ts" },
      { type: "text", value: " now" },
    ]);
  });
  it("keeps ** inside a chip literally", () => {
    expect(parseSummary("see `a**b**c` ok")).toEqual([
      { type: "text", value: "see " },
      { type: "code", value: "a**b**c" },
      { type: "text", value: " ok" },
    ]);
  });
  it("leaves unpaired markers as text", () => {
    expect(parseSummary("a ** b ` c")).toEqual([{ type: "text", value: "a ** b ` c" }]);
  });
  it("does not interpret html", () => {
    expect(parseSummary("<script>x</script>")).toEqual([{ type: "text", value: "<script>x</script>" }]);
  });
});

describe("githubBlobUrl", () => {
  it("encodes each segment", () => {
    expect(githubBlobUrl("acme", "pay", "abc", "src/my file/#a.ts")).toBe(
      "https://github.com/acme/pay/blob/abc/src/my%20file/%23a.ts",
    );
  });
});

describe("truncateMiddle", () => {
  it("keeps short paths", () => expect(truncateMiddle("src/a.ts")).toBe("src/a.ts"));
  it("shortens in the middle to max chars", () => {
    const p = "src/" + "x".repeat(80) + "/file.ts";
    const out = truncateMiddle(p, 60);
    expect(out).toHaveLength(60);
    expect(out).toContain("…");
    expect(out.startsWith("src/")).toBe(true);
    expect(out.endsWith("/file.ts")).toBe(true);
  });
});

describe("toMermaid", () => {
  const diagram = {
    nodes: [
      { id: "n1", label: "client", kind: "external" as const, path: null },
      { id: "n2", label: 'server"]<script>', kind: "entry" as const, path: "src/server.ts" },
      { id: "n3", label: "pg", kind: "datastore" as const, path: null },
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
      { from: "n2", to: "nope" },
    ],
  };
  it("builds a flowchart LR with kind classes and sanitised labels", () => {
    const out = toMermaid(diagram);
    expect(out.startsWith("flowchart LR")).toBe(true);
    expect(out).toContain('n1["client"]:::external');
    expect(out).toContain('n2["server___script_"]:::entry');
    expect(out).toContain("n1 --> n2");
    expect(out).toContain("n2 --> n3");
    expect(out).not.toContain("nope");
    expect(out).toContain("classDef datastore");
    expect(out).not.toContain("<");
  });
});

it("SECTION_IDS order", () => {
  expect(SECTION_IDS).toEqual(["architecture", "critical-paths", "run-locally", "reading-path", "first-tasks"]);
});
