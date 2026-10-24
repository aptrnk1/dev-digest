import { describe, it, expect } from "vitest";
import { NAV } from "@devdigest/ui";
import { activeKeyFor, repoSwitchHref } from "./helpers";

describe("repoSwitchHref", () => {
  it("keeps the user on Conventions, otherwise lands on the PR list", () => {
    expect(repoSwitchHref("/repos/r1/conventions", "r2")).toBe("/repos/r2/conventions");
    expect(repoSwitchHref("/repos/r1/pulls/12", "r2")).toBe("/repos/r2/pulls");
    expect(repoSwitchHref("/skills", "r2")).toBe("/repos/r2/pulls");
    expect(repoSwitchHref("/repos/r1/conventions-x", "r2")).toBe("/repos/r2/pulls");
  });
});

describe("Project Context nav", () => {
  it("has a WORKSPACE item without a g-key and activates on /context (AC12)", () => {
    const ws = NAV.find((g) => g.section === "WORKSPACE");
    const item = ws?.items.find((i) => i.key === "context");
    expect(item).toMatchObject({ label: "Project Context", href: "/repos/:repoId/context" });
    expect(item?.gKey).toBeUndefined();
    expect(activeKeyFor("/repos/r/context")).toBe("context");
  });
});
