import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent } from "@devdigest/shared";
import messages from "../../../../../../messages/en/agents.json";
import { ToastProvider } from "../../../../../lib/toast";

// Mock the data hooks so the editor renders without a network/query client.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("../../../../../lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, data: undefined }),
  useDeleteAgent: () => ({ mutate: vi.fn(), isPending: false }),
  useProviderModels: () => ({ data: [{ id: "gpt-4.1", provider: "openai" }] }),
}));

import { AgentEditor } from "./AgentEditor";
import { TAB_KEYS } from "./constants";

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("A2 Agent Editor (smoke)", () => {
  it("renders the Config tab fields", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    expect(screen.getByText("Config")).toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Save agent")).toBeInTheDocument();
    expect(screen.getByText("~7 / 8,000 tokens")).toBeInTheDocument();
    // Provider / strategy / CI gate / repo intel live behind "Advanced".
    expect(screen.queryByText("Review strategy")).not.toBeInTheDocument();
  });

  it("has a Context tab between Skills and Evals, reachable via ?tab=context (AC31)", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="config" onTab={() => {}} />);
    const labels = screen.getAllByRole("button").map((el) => el.textContent);
    expect(labels.slice(0, 6)).toEqual(["Config", "Skills", "Context", "Evals", "Stats", "CI"]);
    expect(TAB_KEYS).toContain("context");
  });

  it("shows a later-lesson mount point on the Stats tab", () => {
    renderWithIntl(<AgentEditor agent={AGENT} tab="stats" onTab={() => {}} />);
    expect(screen.getByText(/Mount point for L07/)).toBeInTheDocument();
  });
});
