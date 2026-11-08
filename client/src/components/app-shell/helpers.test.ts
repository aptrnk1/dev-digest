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

describe("Onboarding Tour nav", () => {
  it("sits between Pull Requests and Project Context without a g-key (AC1)", () => {
    const ws = NAV.find((g) => g.section === "WORKSPACE");
    expect(ws?.items.map((i) => i.key)).toEqual(["pulls", "onboarding-tour", "context"]);
    const item = ws?.items.find((i) => i.key === "onboarding-tour");
    expect(item).toMatchObject({ label: "Onboarding Tour", href: "/repos/:repoId/tour" });
    expect(item?.gKey).toBeUndefined();
  });

  it("is active on /repos/:id/tour only, not on /onboarding (AC1, AC2)", () => {
    expect(activeKeyFor("/repos/r/tour")).toBe("onboarding-tour");
    expect(activeKeyFor("/repos/r/tour/")).toBe("onboarding-tour");
    expect(activeKeyFor("/onboarding")).not.toBe("onboarding-tour");
    expect(activeKeyFor("/repos/r/tours")).not.toBe("onboarding-tour");
  });

  it("keeps the user on the tour when switching repos (AC3)", () => {
    expect(repoSwitchHref("/repos/r1/tour", "r2")).toBe("/repos/r2/tour");
    expect(repoSwitchHref("/repos/r1/tours", "r2")).toBe("/repos/r2/pulls");
  });
});
