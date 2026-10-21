import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrIntentState } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";

const state: { query: Record<string, unknown>; derive: Record<string, unknown> } = {
  query: {},
  derive: {},
};
const mutate = vi.fn();
const refetch = vi.fn();

vi.mock("@/lib/hooks/intent", () => ({
  usePrIntent: () => state.query,
  useDeriveIntent: () => ({ mutate, isPending: false, isError: false, error: null, ...state.derive }),
}));

import { ApiError } from "@/lib/api";
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

function ui(
  data: PrIntentState | undefined,
  extra: Record<string, unknown> = {},
  derive: Record<string, unknown> = {},
) {
  state.query = { data, isLoading: false, isError: false, refetch, ...extra };
  state.derive = derive;
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

  it("auto-derives once when no intent is stored", () => {
    const { rerender } = ui({ intent: null, stale: false });
    expect(screen.getByTestId("intent-deriving")).toBeInTheDocument();
    expect(screen.getByText("Deriving intent…")).toBeInTheDocument();
    rerender(
      <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
        <IntentCard prId="pr1" />
      </NextIntlClientProvider>,
    );
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({});
  });

  it("does not auto-derive a stored or stale intent", () => {
    ui({ intent: INTENT, stale: true });
    expect(mutate).not.toHaveBeenCalled();
  });

  it("failed auto-derive falls back to the empty state with a manual retry", () => {
    ui({ intent: null, stale: false }, {}, { isError: true, error: new ApiError("x", 422, "llm_not_configured") });
    expect(screen.getByText("Intent not derived yet")).toBeInTheDocument();
    expect(screen.getByText(/No LLM key for the intent model/)).toBeInTheDocument();
    mutate.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Derive intent/ }));
    expect(mutate).toHaveBeenCalledWith({});
  });

  it("other derive errors show a generic hint", () => {
    ui({ intent: null, stale: false }, {}, { isError: true, error: new ApiError("boom", 500) });
    expect(screen.getByText("Could not derive the intent. Try again.")).toBeInTheDocument();
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
