import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/context.json";
import { ToastProvider } from "../../lib/toast";

const mocks = vi.hoisted(() => ({
  files: {} as any,
  atts: {} as any,
  mutate: vi.fn(),
}));

vi.mock("@/lib/hooks/core", () => ({ useContextFiles: () => mocks.files }));
vi.mock("@/lib/hooks/context", () => ({
  useContextAttachments: () => mocks.atts,
  useSetContextAttachments: () => ({ mutate: mocks.mutate }),
  useContextFile: () => ({ data: undefined, isLoading: true, isError: false, refetch: vi.fn() }),
}));

import { ContextDocsPanel } from "./ContextDocsPanel";
import type { PanelSummary } from "./types";

const doc = (path: string, extra: Record<string, unknown> = {}) => {
  const i = path.lastIndexOf("/");
  return {
    path,
    folder: i < 0 ? "" : path.slice(0, i + 1),
    category: "specs",
    tokens: 10,
    status: "ok",
    ...extra,
  };
};
const ok = (data: unknown) => ({ data, isLoading: false, isError: false, error: null, refetch: vi.fn() });
const repo = { id: "r1", full_name: "acme/api" };
const owner = { kind: "agent" as const, id: "a1" };
let summary: PanelSummary | undefined;

function setup(opts: { docs?: any[]; attached?: any[]; inherited?: any[]; truncated?: boolean } = {}) {
  mocks.files = ok({
    docs: opts.docs ?? [doc("specs/a.md"), doc("specs/b.md"), doc("docs/c.md"), doc("docs/big.md", { status: "too_large", tokens: null })],
    truncated: opts.truncated ?? false,
  });
  mocks.atts = ok({ repo_id: "r1", attached: opts.attached ?? [], inherited: opts.inherited ?? [] });
}

const renderPanel = (r: typeof repo | null = repo) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ToastProvider>
        <ContextDocsPanel
          owner={owner}
          repo={r}
          header={(s) => {
            summary = s;
            return <h2>head</h2>;
          }}
        />
      </ToastProvider>
    </NextIntlClientProvider>,
  );

beforeEach(() => {
  mocks.mutate.mockReset();
  summary = undefined;
});
afterEach(cleanup);

describe("ContextDocsPanel", () => {
  it("orders own, inherited, then rest by path; row shows grip/checkbox/folder/tag/tokens/Preview (AC32, AC41)", () => {
    setup({
      attached: [{ path: "specs/b.md", status: "ok", tokens: 20 }],
      inherited: [{ path: "docs/c.md", skill_id: "s1", skill_name: "rubric", status: "ok", tokens: 7 }],
    });
    renderPanel();
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("b.md");
    expect(items[0]).toHaveTextContent("20 tok");
    expect(items[0]).toHaveTextContent("specs/");
    expect(within(items[0]!).getByRole("button", { name: "Reorder specs/b.md" })).toBeEnabled();
    expect(within(items[0]!).getByRole("button", { name: "Preview" })).toBeInTheDocument();
    expect(items[1]).toHaveTextContent("c.md");
    expect(items[1]).toHaveTextContent("via rubric");
    expect(within(items[1]!).queryByRole("checkbox")).toBeNull();
    expect(within(items[1]!).queryByRole("button", { name: /Reorder/ })).toBeNull();
    expect(items[2]).toHaveTextContent("big.md"); // rest sorted by path
    expect(items[3]).toHaveTextContent("a.md");
    // inherited path is not repeated among the rest
    expect(screen.getAllByText("c.md")).toHaveLength(1);
  });

  it("attach appends, detach keeps order of the rest (AC33, AC84)", () => {
    setup({ attached: [{ path: "specs/b.md", status: "ok", tokens: 20 }] });
    renderPanel();
    fireEvent.click(screen.getByRole("checkbox", { name: /a\.md/ }));
    expect(mocks.mutate.mock.calls[0]![0]).toEqual(["specs/b.md", "specs/a.md"]);
    mocks.mutate.mockReset();
    fireEvent.click(screen.getByRole("checkbox", { name: /b\.md/ }));
    expect(mocks.mutate.mock.calls[0]![0]).toEqual([]);
  });

  it("drag reorders attached rows (AC34)", () => {
    setup({
      attached: [
        { path: "specs/a.md", status: "ok", tokens: 1 },
        { path: "specs/b.md", status: "ok", tokens: 1 },
      ],
    });
    renderPanel();
    const [first, second] = screen.getAllByRole("listitem");
    fireEvent.dragStart(first!);
    fireEvent.dragOver(second!);
    fireEvent.drop(second!);
    expect(mocks.mutate.mock.calls[0]![0]).toEqual(["specs/b.md", "specs/a.md"]);
  });

  it("ArrowUp/ArrowDown on grip moves one step, nothing at the edges (AC35, AC80)", () => {
    setup({
      attached: [
        { path: "specs/a.md", status: "ok", tokens: 1 },
        { path: "specs/b.md", status: "ok", tokens: 1 },
      ],
    });
    renderPanel();
    const gripA = screen.getByRole("button", { name: "Reorder specs/a.md" });
    fireEvent.keyDown(gripA, { key: "ArrowUp" });
    expect(mocks.mutate).not.toHaveBeenCalled();
    fireEvent.keyDown(gripA, { key: "ArrowDown" });
    expect(mocks.mutate.mock.calls[0]![0]).toEqual(["specs/b.md", "specs/a.md"]);
    // unattached grip is disabled
    expect(screen.getByRole("button", { name: "Reorder docs/c.md" })).toBeDisabled();
  });

  it("filter narrows rows, disables grips and shows no-match (AC36)", () => {
    setup({ attached: [{ path: "specs/a.md", status: "ok", tokens: 1 }] });
    renderPanel();
    const input = screen.getByPlaceholderText("Filter documents…");
    fireEvent.change(input, { target: { value: "SPECS/A" } });
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Reorder specs/a.md" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.getByText('No documents match "zzz"')).toBeInTheDocument();
  });

  it("unattached too_large row is muted with no checkbox or Preview (AC20)", () => {
    setup();
    renderPanel();
    const row = screen.getByText("big.md").closest("li")!;
    expect(row).toHaveTextContent("too large (> 1 MB)");
    expect(within(row).queryByRole("checkbox")).toBeNull();
    expect(within(row).queryByRole("button", { name: "Preview" })).toBeNull();
  });

  it("own missing / too_large rows: label, Detach, no tokens (AC42, AC89)", () => {
    setup({
      attached: [
        { path: "gone.md", status: "missing", tokens: null },
        { path: "docs/big.md", status: "too_large", tokens: null },
      ],
    });
    renderPanel();
    const gone = screen.getByText("gone.md").closest("li")!;
    expect(gone).toHaveTextContent("missing");
    expect(gone).not.toHaveTextContent("tok");
    const big = screen.getByText("big.md").closest("li")!;
    expect(big).toHaveTextContent("too large (> 1 MB)");
    fireEvent.click(within(gone).getByRole("button", { name: "Detach" }));
    expect(mocks.mutate.mock.calls[0]![0]).toEqual(["docs/big.md"]);
    expect(summary!.okTokens).toBe(0);
  });

  it("own ok attachment outside the listed docs is a normal row (AC90)", () => {
    setup({ truncated: true, attached: [{ path: "far/x.md", status: "ok", tokens: 33 }] });
    renderPanel();
    const row = screen.getByText("x.md").closest("li")!;
    expect(row).toHaveTextContent("33 tok");
    expect(within(row).getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  });

  it("rolls back via toast on save error (AC38)", () => {
    setup();
    mocks.mutate.mockImplementation((_p, o) => o.onError(new Error("boom")));
    renderPanel();
    fireEvent.click(screen.getByRole("checkbox", { name: /a\.md/ }));
    expect(screen.getByText("Couldn't save context: boom")).toBeInTheDocument();
  });

  it("states: 409, empty, no repo, error+retry, skeleton (AC44, AC85-88)", () => {
    setup();
    mocks.files = { ...ok(undefined), isError: true, error: { status: 409, code: "repo_not_cloned" } };
    renderPanel();
    expect(screen.getByText(messages.panel.notCloned)).toBeInTheDocument();
    cleanup();

    mocks.files = { ...ok(undefined), isError: true, error: new Error("x") };
    renderPanel();
    expect(screen.getByText("Couldn't load documents")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.files.refetch).toHaveBeenCalled();
    cleanup();

    setup({ docs: [] });
    renderPanel();
    expect(screen.getByText("No Markdown documents found")).toBeInTheDocument();
    cleanup();

    renderPanel(null);
    expect(screen.getByText("Add a repository to attach its documents.")).toBeInTheDocument();
    cleanup();

    mocks.files = { ...ok(undefined), isLoading: true };
    renderPanel();
    expect(screen.getByTestId("context-skeleton")).toBeInTheDocument();
  });

  it("Preview opens the drawer (AC45); summary counts ok tokens of own + inherited", () => {
    setup({
      attached: [{ path: "specs/a.md", status: "ok", tokens: 5 }],
      inherited: [{ path: "docs/c.md", skill_id: "s1", skill_name: "r", status: "ok", tokens: 7 }],
    });
    renderPanel();
    expect(summary).toMatchObject({ attachedCount: 1, totalDocs: 4, okTokens: 12, attachedPaths: ["specs/a.md"] });
    fireEvent.click(within(screen.getAllByRole("listitem")[0]!).getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("specs/a.md");
  });
});
