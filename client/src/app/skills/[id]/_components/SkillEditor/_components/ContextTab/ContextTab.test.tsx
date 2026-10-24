import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import skills from "../../../../../../../../messages/en/skills.json";
import context from "../../../../../../../../messages/en/context.json";
import { ToastProvider } from "../../../../../../../lib/toast";

const mocks = vi.hoisted(() => ({
  repo: { id: "r1", full_name: "acme/api" } as { id: string; full_name: string } | null,
  paths: ["specs/a.md", "docs/b.md"] as string[],
}));

vi.mock("@/lib/repo-context", () => ({ useActiveRepo: () => ({ activeRepo: mocks.repo }) }));
vi.mock("@/components/context-docs", () => ({
  ContextDocsPanel: (p: any) => {
    const summary = { attachedCount: mocks.paths.length, totalDocs: 5, okTokens: 100, attachedPaths: mocks.paths };
    return (
      <div data-testid="panel" data-owner={`${p.owner.kind}:${p.owner.id}`} data-repo={p.repo?.id ?? ""}>
        {p.header(summary)}
        {p.footer?.(summary)}
      </div>
    );
  },
}));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  mocks.repo = { id: "r1", full_name: "acme/api" };
  mocks.paths = ["specs/a.md", "docs/b.md"];
});

const SKILL = { id: "s1", name: "rubric", description: "d", type: "rubric", source: "manual", body: "b", enabled: true, version: 1 } as Skill;

const renderTab = (skill = SKILL) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ skills, context: { ...context, ...{} } }}>
      <ToastProvider>
        <ContextTab skill={skill} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );

describe("skill ContextTab", () => {
  it("AC78: title carries the repo full name; AC46: hint", () => {
    renderTab();
    expect(screen.getByText("Project context to use · acme/api")).toBeTruthy();
    expect(screen.getByText("Any agent using this skill inherits these documents.")).toBeTruthy();
  });

  it("AC37: badge shows the attached count", () => {
    renderTab();
    expect(screen.getByText("2 attached")).toBeTruthy();
  });

  it("AC47: SERIALIZES AS lists the heading and paths in order", () => {
    const { container } = renderTab();
    expect(screen.getByText("SERIALIZES AS")).toBeTruthy();
    expect(container.querySelector("pre")?.textContent).toBe("## Project context\n- specs/a.md\n- docs/b.md");
  });

  it("AC47: nothing attached", () => {
    mocks.paths = [];
    renderTab();
    expect(screen.getByText("Nothing attached")).toBeTruthy();
  });

  it("AC43: the panel is owned by the (skill, repo) pair", () => {
    renderTab();
    expect(screen.getByTestId("panel").dataset.owner).toBe("skill:s1");
    expect(screen.getByTestId("panel").dataset.repo).toBe("r1");
  });

  it("no repo: passes repo=null to the panel", () => {
    mocks.repo = null;
    renderTab();
    expect(screen.getByTestId("panel").dataset.repo).toBe("");
  });
});
