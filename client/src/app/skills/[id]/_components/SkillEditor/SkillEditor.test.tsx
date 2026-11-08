import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import skills from "../../../../../../messages/en/skills.json";

vi.mock("./_components/ContextTab", () => ({ ContextTab: () => <div data-testid="context-tab" /> }));
vi.mock("./_components/ConfigTab", () => ({ ConfigTab: () => <div data-testid="config-tab" /> }));

import { SkillEditor } from "./SkillEditor";
import { TAB_KEYS } from "./constants";

afterEach(cleanup);

const SKILL = { id: "s1", name: "r", description: "d", type: "rubric", source: "manual", body: "b", enabled: true, version: 1 } as Skill;

// Mirrors how skills/[id]/page.tsx resolves ?tab= (unknown values fall back to config).
const resolveTab = (param: string | null) => (TAB_KEYS.includes(param ?? "") ? param! : "config");

const renderEditor = (tab: string) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ skills }}>
      <SkillEditor skill={SKILL} tab={tab} onTab={() => {}} />
    </NextIntlClientProvider>,
  );

describe("SkillEditor tabs (AC46)", () => {
  it("orders tabs Config, Context, Preview, Evals, Stats, Versions", () => {
    renderEditor("config");
    const labels = screen.getAllByRole("button").map((el) => el.textContent);
    expect(labels.slice(0, 6)).toEqual(["Config", "Context", "Preview", "Evals", "Stats", "Versions"]);
  });

  it("?tab=context resolves to the Context tab and renders its screen", () => {
    renderEditor(resolveTab("context"));
    expect(screen.getByTestId("context-tab")).toBeTruthy();
    expect(screen.queryByTestId("config-tab")).toBeNull();
  });

  it("an unknown ?tab= falls back to Config", () => {
    renderEditor(resolveTab("nope"));
    expect(screen.getByTestId("config-tab")).toBeTruthy();
  });
});
