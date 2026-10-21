import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrIntentState } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";

const state: { query: Record<string, unknown> } = { query: {} };
const mutate = vi.fn();
const refetch = vi.fn();

vi.mock("@/lib/hooks/intent", () => ({
  usePrIntent: () => state.query,
  useDeriveIntent: () => ({ mutate, isPending: false }),
}));

import { IntentCard } from "./IntentCard";

const INTENT: NonNullable<PrIntentState["intent"]> = {
  pr_id: "pr1",
  head_sha: "abc",
  model: "m",
  cost_usd: 0.01,
  updated_at: "2026-10-20T00:00:00Z",
  intent: "Add rate limiting to public endpoints.",
  in_scope: ["limiter middleware"],
  out_of_scope: ["auth rewrite"],
  risk_areas: [
    { label: "Token bypass", kind: "security" },
    { label: "New dep", kind: "dependency" },
  ],
  confidence: "high",
  basis: "spec",
  sources: [{ kind: "spec", ref: "specs/rate.md", truncated: false }],
  unresolved_refs: [{ ref: "#999", reason: "not found" }],
};

function ui(data: PrIntentState | undefined, extra: Record<string, unknown> = {}) {
  state.query = { data, isLoading: false, isError: false, refetch, ...extra };
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      <IntentCard prId="pr1" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("IntentCard", () => {
  it("renders the loaded intent", () => {
    ui({ intent: INTENT, stale: false });
    expect(screen.getByText("Add rate limiting to public endpoints.")).toBeInTheDocument();
    expect(screen.getByText("limiter middleware")).toBeInTheDocument();
    expect(screen.getByText("auth rewrite")).toBeInTheDocument();
    expect(screen.getByText("Token bypass")).toBeInTheDocument();
    expect(screen.getByText("New dep")).toBeInTheDocument();
    expect(screen.getByText("High confidence")).toBeInTheDocument();
    expect(screen.getByText(/Derived from/)).toBeInTheDocument();
    expect(screen.getByText(/specs\/rate\.md/)).toBeInTheDocument();
    expect(screen.getByText("#999 — not found")).toHaveStyle({ opacity: "0.5" });
    expect(screen.getByText(/^spec specs\/rate\.md/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Token bypass" })).toBeInTheDocument();
    expect(screen.queryByText("Outdated")).toBeNull();
    expect(screen.queryByText(/PR has no description/)).toBeNull();
  });

  it("shows a hint on low confidence", () => {
    ui({ intent: { ...INTENT, confidence: "low" }, stale: false });
    expect(
      screen.getByText("Inferred from branch, commits and changed files — PR has no description"),
    ).toBeInTheDocument();
  });

  it("labels ticket sources as issue", () => {
    ui({
      intent: { ...INTENT, sources: [{ kind: "ticket", ref: "#12", truncated: false }] },
      stale: false,
    });
    expect(screen.getByText("issue #12")).toBeInTheDocument();
  });

  it("empty state derives on click", () => {
    ui({ intent: null, stale: false });
    expect(screen.getByText("Intent not derived yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Derive intent/ }));
    expect(mutate).toHaveBeenCalledWith({});
  });

  it("stale shows Outdated and re-derives with force", () => {
    ui({ intent: INTENT, stale: true });
    expect(screen.getByText("Outdated")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Re-derive/ }));
    expect(mutate).toHaveBeenCalledWith({ force: true });
  });

  it("shows a skeleton while loading", () => {
    ui(undefined, { isLoading: true });
    expect(screen.getByTestId("intent-loading")).toBeInTheDocument();
  });

  it("shows an error state with retry", () => {
    ui(undefined, { isError: true });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(refetch).toHaveBeenCalled();
  });
});
