import React from "react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const usePrBrief = vi.fn();
vi.mock("@/lib/hooks", () => ({ usePrBrief: (...a: unknown[]) => usePrBrief(...a) }));
vi.mock("../BriefCard", () => ({ BriefCard: () => <div data-testid="brief-card" /> }));
vi.mock("../IntentCard", () => ({ IntentCard: () => <div data-testid="intent-card" /> }));
vi.mock("../BlastRadiusCard", () => ({ BlastRadiusCard: () => <div data-testid="blast-card" /> }));
vi.mock("../BriefRisks", () => ({ BriefRisks: () => <div data-testid="brief-risks" /> }));
vi.mock("../ReviewFocus", () => ({ ReviewFocus: () => <div data-testid="review-focus" /> }));

import { OverviewTab } from "./OverviewTab";

const BRIEF = { risks: { risks: [] }, review_focus: [] };

function ui() {
  return render(
    <OverviewTab prId="pr1" prBody="Body text" repoId="r1" repoFullName="o/n" headSha="abc" />,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("OverviewTab", () => {
  it("orders blocks: brief, intent+blast row, risks, focus, description", () => {
    usePrBrief.mockReturnValue({ data: { brief: BRIEF, stale: false } });
    ui();
    const all = [
      ...["brief-card", "intent-card", "blast-card", "brief-risks", "review-focus"].map((id) =>
        screen.getByTestId(id),
      ),
      screen.getByText("Body text"),
    ];
    for (let i = 0; i < all.length - 1; i++) {
      expect(
        all[i]!.compareDocumentPosition(all[i + 1]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(screen.getByTestId("intent-card").parentElement).toBe(
      screen.getByTestId("blast-card").parentElement,
    );
  });

  it.each([
    ["loading", { data: undefined, isLoading: true }],
    ["no brief", { data: { brief: null, stale: false } }],
  ])("does not render risks/focus when %s", (_n, ret) => {
    usePrBrief.mockReturnValue(ret);
    ui();
    expect(screen.getByTestId("brief-card")).toBeInTheDocument();
    expect(screen.queryByTestId("brief-risks")).toBeNull();
    expect(screen.queryByTestId("review-focus")).toBeNull();
  });
});
