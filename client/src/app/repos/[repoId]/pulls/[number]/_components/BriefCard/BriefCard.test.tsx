import React from "react";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrBrief } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/api", async (orig) => {
  const actual = await orig<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
  };
});

import { ApiError } from "@/lib/api";
import { BriefCard } from "./BriefCard";

const BRIEF: PrBrief = {
  summary: "Adds a rate limiter to public endpoints.",
  intent: null,
  intent_stale: false,
  blast: null,
  risks: { risks: [] },
  review_focus: [],
  history: { history: [] },
  missing_inputs: [],
  head_sha: "abc",
  generated_at: "2026-10-24T10:00:00.000Z",
  model: "m",
  cost_usd: null,
};

function ui() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
        <BriefCard prId="pr1" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function withBrief(extra: Partial<PrBrief> = {}, stale = false) {
  get.mockResolvedValue({ brief: { ...BRIEF, ...extra }, stale });
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("BriefCard", () => {
  it("shows a skeleton while the GET is pending", () => {
    get.mockReturnValue(new Promise(() => {}));
    ui();
    expect(screen.getByTestId("brief-loading")).toBeInTheDocument();
  });

  it("shows ErrorState on GET failure and Retry refetches", async () => {
    get.mockRejectedValueOnce(new ApiError("boom", 500));
    get.mockResolvedValue({ brief: null, stale: false });
    ui();
    expect(await screen.findByText("Couldn't load the brief")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Brief not available yet.")).toBeInTheDocument();
  });

  it("empty state: text, hint, Generate button, and no POST until clicked", async () => {
    get.mockResolvedValue({ brief: null, stale: false });
    ui();
    expect(await screen.findByText("Brief not available yet.")).toBeInTheDocument();
    expect(
      screen.getByText("Generate a brief from the PR's intent, blast radius, diff stats and attached specs."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate brief" })).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("click disables the button as 'Generating brief…' and the summary appears after success", async () => {
    get.mockResolvedValue({ brief: null, stale: false });
    let resolve!: (b: PrBrief) => void;
    post.mockReturnValue(new Promise<PrBrief>((r) => (resolve = r)));
    ui();
    fireEvent.click(await screen.findByRole("button", { name: "Generate brief" }));
    const busy = await screen.findByRole("button", { name: "Generating brief…" });
    expect(busy).toBeDisabled();
    resolve(BRIEF);
    expect(await screen.findByText(BRIEF.summary)).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("regenerate keeps the previous summary visible and POSTs", async () => {
    withBrief();
    post.mockReturnValue(new Promise(() => {}));
    ui();
    expect(await screen.findByText(BRIEF.summary)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate brief" }));
    expect(await screen.findByRole("button", { name: "Generating brief…" })).toBeDisabled();
    expect(screen.getByText(BRIEF.summary)).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("stale shows the Outdated badge with its hint", async () => {
    withBrief({}, true);
    ui();
    const badge = await screen.findByText("Outdated");
    expect(badge).toBeInTheDocument();
    expect(screen.getByTitle("The PR changed since this brief was generated.")).toBeInTheDocument();
  });

  it("not stale: no Outdated badge", async () => {
    withBrief();
    ui();
    await screen.findByText(BRIEF.summary);
    expect(screen.queryByText("Outdated")).toBeNull();
  });

  it("lists missing inputs and puts the intent-stale line right after", async () => {
    withBrief({ missing_inputs: ["intent", "blast"], intent_stale: true });
    ui();
    const missing = await screen.findByText("Generated without: intent, blast radius");
    const stale = screen.getByText(messages.intentStale);
    expect(missing.compareDocumentPosition(stale) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(missing.nextElementSibling).toBe(stale);
  });

  it("no missing/intent-stale lines when nothing is missing", async () => {
    withBrief();
    ui();
    await screen.findByText(BRIEF.summary);
    expect(screen.queryByText(/Generated without/)).toBeNull();
    expect(screen.queryByText(messages.intentStale)).toBeNull();
  });

  it.each([
    [new ApiError("x", 422, "llm_not_configured"), messages.generateError.notConfigured],
    [new ApiError("x", 409, "brief_in_progress"), messages.generateError.inProgress],
    [new ApiError("x", 502, "brief_failed"), messages.generateError.generic],
    [new ApiError("x", 0, "network_error"), messages.generateError.generic],
  ])("generate failure %# shows the matching text and keeps the previous brief", async (err, text) => {
    withBrief();
    post.mockRejectedValue(err);
    ui();
    await screen.findByText(BRIEF.summary);
    fireEvent.click(screen.getByRole("button", { name: "Regenerate brief" }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByText(BRIEF.summary)).toBeInTheDocument();
  });

  it("409 refetches the brief, and keeps polling until it changes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      withBrief();
      post.mockRejectedValue(new ApiError("x", 409, "brief_in_progress"));
      ui();
      await screen.findByText(BRIEF.summary);
      get.mockResolvedValue({ brief: BRIEF, stale: false });
      fireEvent.click(screen.getByRole("button", { name: "Regenerate brief" }));
      expect(await screen.findByText(messages.generateError.inProgress)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Generating brief…" })).toBeDisabled();
      await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
      get.mockResolvedValue({
        brief: { ...BRIEF, summary: "Fresh summary", generated_at: "2026-10-24T10:05:00.000Z" },
        stale: false,
      });
      await vi.advanceTimersByTimeAsync(5_100);
      expect(await screen.findByText("Fresh summary")).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByText(messages.generateError.inProgress)).toBeNull());
      expect(screen.getByRole("button", { name: "Regenerate brief" })).toBeEnabled();
      const calls = get.mock.calls.length;
      await vi.advanceTimersByTimeAsync(11_000);
      expect(get.mock.calls.length).toBe(calls);
    } finally {
      vi.useRealTimers();
    }
  });

  it("empty-state failure shows the error text under the button", async () => {
    get.mockResolvedValue({ brief: null, stale: false });
    post.mockRejectedValue(new ApiError("x", 422, "llm_not_configured"));
    ui();
    fireEvent.click(await screen.findByRole("button", { name: "Generate brief" }));
    expect(await screen.findByText(messages.generateError.notConfigured)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate brief" })).toBeEnabled();
  });

  it("renders the summary as plain text", async () => {
    withBrief({ summary: "<b>bold</b> and **x**" });
    const { container } = ui();
    expect(await screen.findByText("<b>bold</b> and **x**")).toBeInTheDocument();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
  });

  it("renders no raw message keys", async () => {
    withBrief({ missing_inputs: ["specs", "review_findings"], intent_stale: true }, true);
    const { container } = ui();
    await screen.findByText(BRIEF.summary);
    expect(container.textContent).not.toMatch(/\bbrief\.[a-zA-Z]+/);
  });
});
