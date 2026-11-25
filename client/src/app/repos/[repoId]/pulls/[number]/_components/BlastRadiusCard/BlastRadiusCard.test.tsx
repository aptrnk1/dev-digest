import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadiusResponse } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/blast.json";

const state: { query: Record<string, unknown> } = { query: {} };
const refetch = vi.fn();
const mutate = vi.fn();

vi.mock("@/lib/hooks/blast", () => ({ useBlastRadius: () => state.query }));
vi.mock("@/lib/hooks/repo-intel", () => ({
  useResyncRepoIntel: () => ({ mutate, isPending: false }),
}));

import { BlastRadiusCard } from "./BlastRadiusCard";

const DATA: BlastRadiusResponse = {
  pr_id: "pr1",
  index_sha: "idx123",
  stats: { symbols: 2, callers: 5, endpoints: 1, crons: 1 },
  degraded: false,
  degraded_reason: null,
  summary: "",
  changed_symbols: [
    { name: "charge", file: "src/pay.ts", kind: "function" },
    { name: "refund", file: "src/pay.ts", kind: "function" },
  ],
  downstream: [
    {
      symbol: "charge",
      callers: [
        { name: "checkout", file: "src/checkout.ts", line: 23 },
        { name: "a", file: "src/a.ts", line: 1 },
        { name: "b", file: "src/b.ts", line: 2 },
        { name: "c", file: "src/c.ts", line: 3 },
      ],
      endpoints_affected: ["POST /checkout"],
      crons_affected: [],
    },
    {
      symbol: "refund",
      callers: [{ name: "nightly", file: "src/jobs.ts", line: 9 }],
      endpoints_affected: [],
      crons_affected: ["0 * * * *"],
    },
  ],
};

function ui(
  data: BlastRadiusResponse | undefined,
  extra: Record<string, unknown> = {},
  props: { repoFullName?: string | null; headSha?: string | null } = {},
) {
  state.query = { data, isLoading: false, isError: false, refetch, ...extra };
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <BlastRadiusCard
        prId="pr1"
        repoId="r1"
        repoFullName={props.repoFullName === undefined ? "acme/api" : props.repoFullName}
        headSha={props.headSha === undefined ? "head999" : props.headSha}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("BlastRadiusCard", () => {
  it("renders the stats row", () => {
    ui(DATA);
    expect(screen.getByText("Blast radius")).toBeInTheDocument();
    for (const [n, label] of [
      ["2", "symbols"],
      ["5", "callers"],
      ["1", "endpoints"],
      ["1", "cron/jobs"],
    ] as const) {
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getAllByText(n).length).toBeGreaterThan(0);
    }
  });

  it("lists symbols with caller counts", () => {
    ui(DATA);
    expect(screen.getByText("charge")).toBeInTheDocument();
    expect(screen.getByText("4 callers")).toBeInTheDocument();
    expect(screen.getByText("refund")).toBeInTheDocument();
  });

  it("links callers to the blob at the index sha, falling back to the head sha", () => {
    const { unmount } = ui(DATA);
    expect(screen.getByRole("link", { name: "src/checkout.ts:23" })).toHaveAttribute(
      "href",
      "https://github.com/acme/api/blob/idx123/src/checkout.ts#L23",
    );
    expect(screen.getByRole("link", { name: "src/checkout.ts:23" })).toHaveAttribute("target", "_blank");
    unmount();
    ui({ ...DATA, index_sha: null });
    expect(screen.getByRole("link", { name: "src/checkout.ts:23" })).toHaveAttribute(
      "href",
      "https://github.com/acme/api/blob/head999/src/checkout.ts#L23",
    );
  });

  it("renders plain text without a repo name", () => {
    ui(DATA, {}, { repoFullName: null });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("src/checkout.ts:23")).toBeInTheDocument();
  });

  it("shows endpoint and cron chips under their own symbol only", () => {
    ui(DATA);
    const charge = screen.getByText("charge").closest("div")!.parentElement!;
    const refund = screen.getByText("refund").closest("div")!.parentElement!;
    expect(within(charge).getByText("POST /checkout")).toBeInTheDocument();
    expect(within(charge).queryByText("0 * * * *")).toBeNull();
    expect(within(refund).getByText("0 * * * *")).toBeInTheDocument();
    expect(within(refund).queryByText("POST /checkout")).toBeNull();
  });

  it("explains symbols without downstream callers", () => {
    ui({ ...DATA, downstream: [], stats: { symbols: 2, callers: 0, endpoints: 0, crons: 0 } });
    expect(screen.getByText("2 changed symbol(s), no downstream callers found.")).toBeInTheDocument();
  });

  it("shows the empty state when no symbols changed", () => {
    ui({ ...DATA, changed_symbols: [], downstream: [], stats: { symbols: 0, callers: 0, endpoints: 0, crons: 0 } });
    expect(screen.getByText("No symbols are declared in the changed files.")).toBeInTheDocument();
  });

  it("index_partial: banner above the data, rebuild calls mutate then confirms", () => {
    ui({ ...DATA, degraded: true, degraded_reason: "index_partial" });
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("The repository index is incomplete");
    expect(screen.getByText("charge")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Rebuild index/ }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("shows rebuildStarted after a successful rebuild", async () => {
    mutate.mockImplementation((_v: unknown, o: { onSuccess: () => void }) => o.onSuccess());
    ui({ ...DATA, degraded: true, degraded_reason: "no_data" });
    fireEvent.click(screen.getByRole("button", { name: /Rebuild index/ }));
    expect(await screen.findByText("Re-index started. Reopen this PR in a minute.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Rebuild index/ })).toBeNull();
  });

  it.each(["flag_off", "repo_too_large"] as const)("%s shows no rebuild button", (reason) => {
    ui({ ...DATA, degraded: true, degraded_reason: reason });
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Rebuild index/ })).toBeNull();
  });

  it("shows a skeleton while loading", () => {
    ui(undefined, { isLoading: true });
    expect(screen.getByTestId("blast-loading")).toBeInTheDocument();
  });

  it("shows an error state with retry", () => {
    ui(undefined, { isError: true });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(refetch).toHaveBeenCalled();
  });

  it("tree is the default view with expandable symbol rows", () => {
    ui(DATA);
    expect(screen.getByRole("button", { name: "Tree" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Graph" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("img")).toBeNull();
    const row = screen.getByRole("button", { name: "Show or hide callers of charge" });
    expect(row).toHaveAttribute("aria-expanded", "true");
  });

  it("collapsing a symbol hides only its callers and chips", () => {
    ui(DATA);
    fireEvent.click(screen.getByRole("button", { name: "Show or hide callers of charge" }));
    expect(screen.getByRole("button", { name: "Show or hide callers of charge" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("src/checkout.ts:23")).toBeNull();
    expect(screen.queryByText("POST /checkout")).toBeNull();
    expect(screen.getByText("charge")).toBeInTheDocument();
    expect(screen.getByText("src/jobs.ts:9")).toBeInTheDocument();
    expect(screen.getByText("0 * * * *")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show or hide callers of charge" }));
    expect(screen.getByText("src/checkout.ts:23")).toBeInTheDocument();
  });

  it("Graph button swaps the tree for the graph and back", () => {
    ui(DATA);
    fireEvent.click(screen.getByRole("button", { name: "Graph" }));
    expect(screen.getByRole("button", { name: "Graph" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: "Blast radius graph" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show or hide callers of charge" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tree" }));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("src/checkout.ts:23")).toBeInTheDocument();
  });

  it("hides the toggle when there is no downstream", () => {
    ui({ ...DATA, downstream: [], stats: { symbols: 2, callers: 0, endpoints: 0, crons: 0 } });
    expect(screen.queryByRole("button", { name: "Graph" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Tree" })).toBeNull();
  });

  it("keeps the banner and stats in the graph view", () => {
    ui({ ...DATA, degraded: true, degraded_reason: "index_partial" });
    fireEvent.click(screen.getByRole("button", { name: "Graph" }));
    expect(screen.getByRole("status")).toHaveTextContent("The repository index is incomplete");
    expect(screen.getByText("symbols")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Blast radius graph" })).toBeInTheDocument();
  });
});
