import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import agentsMessages from "../../../../../../../../messages/en/agents.json";
import contextMessages from "../../../../../../../../messages/en/context.json";
import { ToastProvider } from "../../../../../../../lib/toast";

const mocks = vi.hoisted(() => ({
  repo: { id: "r1", full_name: "acme/api" } as { id: string; full_name: string } | null,
  total: 3,
  byKey: {} as Record<string, { attached: any[]; inherited: any[] }>,
}));

vi.mock("@/lib/repo-context", () => ({ useActiveRepo: () => ({ activeRepo: mocks.repo }) }));
vi.mock("@/lib/hooks/core", () => ({
  useContextFiles: () => ({
    data: {
      docs: Array.from({ length: mocks.total }, (_, i) => ({
        path: `docs/d${i}.md`,
        folder: "docs/",
        category: "docs",
        tokens: 10,
        status: "ok",
      })),
      truncated: false,
    },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/hooks/context", () => ({
  useContextAttachments: (owner: { id: string }, repoId: string | null) => ({
    data: { repo_id: repoId, ...(mocks.byKey[`${owner.id}:${repoId}`] ?? { attached: [], inherited: [] }) },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSetContextAttachments: () => ({ mutate: vi.fn() }),
  useContextFile: () => ({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() }),
}));

import { ContextTab } from "./ContextTab";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Sec",
  description: "",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "x",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

const att = (path: string, status = "ok", tokens: number | null = 10) => ({ path, status, tokens });

const wrap = (agent: Agent) => (
  <NextIntlClientProvider locale="en" messages={{ agents: agentsMessages, context: contextMessages }}>
    <ToastProvider>
      <ContextTab agent={agent} />
    </ToastProvider>
  </NextIntlClientProvider>
);
const renderTab = (agent: Agent = AGENT) => render(wrap(agent));

describe("ContextTab", () => {
  it("shows the repo in the heading and the attached badge counting own of any status (AC78, AC37)", () => {
    mocks.repo = { id: "r1", full_name: "acme/api" };
    mocks.total = 500;
    mocks.byKey = {
      "ag1:r1": {
        attached: [att("docs/d0.md"), att("docs/gone.md", "missing", null), att("docs/d1.md", "too_large", null)],
        inherited: [{ ...att("docs/d2.md"), skill_id: "s1", skill_name: "rubric" }],
      },
    };
    renderTab();
    expect(screen.getByText("Project context · acme/api")).toBeInTheDocument();
    expect(screen.getByText("3 of 500 attached")).toBeInTheDocument();
  });

  it("footer sums ok tokens of own and inherited, with the untrusted note (AC39)", () => {
    mocks.total = 3;
    mocks.byKey = {
      "ag1:r1": {
        attached: [att("docs/d0.md", "ok", 100), att("docs/d1.md", "too_large", null)],
        inherited: [{ ...att("docs/d2.md", "ok", 50), skill_id: "s1", skill_name: "rubric" }],
      },
    };
    renderTab();
    expect(screen.getByText("≈ 150 tokens / 8,000")).toBeInTheDocument();
    expect(
      screen.getByText("Injected as an untrusted block (## Project context) into every run."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Over the 8,000-token budget/)).toBeNull();
    expect(screen.queryByText(/With map-reduce/)).toBeNull();
  });

  it("warns over budget (AC40)", () => {
    mocks.byKey = {
      "ag1:r1": { attached: [att("docs/d0.md", "ok", 5000), att("docs/d1.md", "ok", 3001)], inherited: [] },
    };
    renderTab();
    expect(screen.getByText("≈ 8,001 tokens / 8,000")).toBeInTheDocument();
    expect(
      screen.getByText("Over the 8,000-token budget — documents past the limit are skipped at run time."),
    ).toBeInTheDocument();
  });

  it("does not warn at exactly 8,000 (AC40)", () => {
    mocks.byKey = { "ag1:r1": { attached: [att("docs/d0.md", "ok", 8000)], inherited: [] } };
    renderTab();
    expect(screen.queryByText(/Over the 8,000-token budget/)).toBeNull();
  });

  it.each(["map-reduce", "auto"] as const)("shows the multiplication hint for %s (AC77)", (strategy) => {
    mocks.byKey = {};
    renderTab({ ...AGENT, strategy });
    expect(
      screen.getByText(
        "With map-reduce this block is sent with every per-file call — its cost multiplies by the number of changed files.",
      ),
    ).toBeInTheDocument();
  });

  it("shows rows of the new agent/repo pair after a switch (AC43)", () => {
    mocks.byKey = {
      "ag1:r1": { attached: [att("docs/d0.md")], inherited: [] },
      "ag2:r1": { attached: [att("docs/d1.md"), att("docs/d2.md")], inherited: [] },
      "ag1:r2": { attached: [], inherited: [] },
    };
    mocks.total = 3;
    const { rerender } = render(wrap(AGENT));
    expect(screen.getByText("1 of 3 attached")).toBeInTheDocument();
    rerender(wrap({ ...AGENT, id: "ag2" }));
    expect(screen.getByText("2 of 3 attached")).toBeInTheDocument();
    rerender(wrap(AGENT));
    mocks.repo = { id: "r2", full_name: "acme/web" };
    rerender(wrap({ ...AGENT }));
    expect(screen.getByText("Project context · acme/web")).toBeInTheDocument();
    expect(screen.getByText("0 of 3 attached")).toBeInTheDocument();
    mocks.repo = { id: "r1", full_name: "acme/api" };
  });

  it("renders the no-repo state without crashing (AC86)", () => {
    mocks.repo = null;
    renderTab();
    expect(screen.getByText("Add a repository to attach its documents.")).toBeInTheDocument();
    mocks.repo = { id: "r1", full_name: "acme/api" };
  });
});
