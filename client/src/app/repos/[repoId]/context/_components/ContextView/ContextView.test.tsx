import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/context.json";
import { ApiError } from "@/lib/api";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/repos/r1/context",
}));

const toastError = vi.fn();
vi.mock("@/lib/toast", () => ({ useToast: () => ({ error: toastError }) }));

const files = vi.fn();
const file = vi.fn();
const usage = vi.fn();
const mutate = vi.fn();
vi.mock("@/lib/hooks/core", () => ({ useContextFiles: (...a: unknown[]) => files(...a) }));
vi.mock("@/lib/hooks/context", () => ({
  useContextFile: (...a: unknown[]) => file(...a),
  useContextUsage: (...a: unknown[]) => usage(...a),
  useToggleDocAttachment: () => ({ mutate }),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: [{ id: "a1", name: "Security" }, { id: "a2", name: "Style" }] }),
}));
vi.mock("@/lib/hooks/skills", () => ({
  useSkills: () => ({ data: [{ id: "s1", name: "Conventions" }] }),
}));

import { ContextView } from "./ContextView";

afterEach(cleanup);
beforeEach(() => {
  search = "";
  [replace, toastError, files, file, usage, mutate].forEach((m) => m.mockReset());
  file.mockReturnValue({ data: { path: "a.md", content: "# Hello\n\n| x |\n|---|\n| 1 |" }, isLoading: false });
  usage.mockReturnValue({ data: { agents: [{ id: "a1", name: "Security" }], skills: [] } });
});

const doc = (path: string, status: "ok" | "too_large" = "ok") => ({
  path,
  folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "/",
  category: "docs",
  tokens: 10,
  status,
});
const list = (docs: ReturnType<typeof doc>[], truncated = false) => ({
  data: { docs, truncated },
  isLoading: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
});

const ui = (props: Partial<React.ComponentProps<typeof ContextView>> = {}) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <ContextView repoId="r1" {...props} />
    </NextIntlClientProvider>,
  );

describe("ContextView", () => {
  it("groups by folder with a plural header (AC13)", () => {
    files.mockReturnValue(list([doc("README.md"), doc("docs/a.md"), doc("docs/b.md")]));
    ui();
    expect(screen.getByText("PROJECT CONTEXT")).toBeInTheDocument();
    expect(screen.getByText("3 documents")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("/")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /a\.md/ })).toBeInTheDocument();
  });

  it("selects ?doc=, else first ok, else first (AC14)", () => {
    files.mockReturnValue(list([doc("big.md", "too_large"), doc("b.md"), doc("c.md")]));
    search = "doc=c.md";
    ui();
    expect(file).toHaveBeenLastCalledWith("r1", "c.md");
    cleanup();
    search = "";
    ui();
    expect(file).toHaveBeenLastCalledWith("r1", "b.md");
    expect(replace).toHaveBeenCalled();
    cleanup();
    files.mockReturnValue(list([doc("big.md", "too_large")]));
    ui();
    expect(screen.getByText(messages.page.tooLarge)).toBeInTheDocument();
  });

  it("renders GFM preview on click (AC15)", () => {
    files.mockReturnValue(list([doc("a.md"), doc("b.md")]));
    ui();
    fireEvent.click(screen.getByRole("button", { name: /b\.md/ }));
    expect(file).toHaveBeenLastCalledWith("r1", "b.md");
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(document.querySelector("table")).not.toBeNull();
  });

  it("too_large: message, no content request, muted label (AC81, AC20)", () => {
    files.mockReturnValue(list([doc("big.md", "too_large")]));
    search = "doc=big.md";
    ui();
    expect(screen.getByText(messages.page.tooLarge)).toBeInTheDocument();
    expect(file).toHaveBeenLastCalledWith("r1", null);
    expect(screen.getByText(messages.panel.tooLarge)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: messages.attach.button })).not.toBeInTheDocument();
  });

  it("shows skeletons while loading (AC16)", () => {
    files.mockReturnValue({ ...list([]), data: undefined, isLoading: true });
    ui();
    expect(screen.getAllByTestId("context-skeleton").length).toBeGreaterThan(0);
    cleanup();
    files.mockReturnValue(list([doc("a.md")]));
    file.mockReturnValue({ data: undefined, isLoading: true });
    ui();
    expect(screen.getAllByTestId("context-skeleton").length).toBeGreaterThan(0);
  });

  it("empty, not cloned, no repo states (AC17, AC18, AC19)", () => {
    files.mockReturnValue(list([]));
    ui();
    expect(screen.getByText(messages.page.empty.title)).toBeInTheDocument();
    expect(screen.getByText(messages.page.empty.body)).toBeInTheDocument();
    cleanup();
    files.mockReturnValue({ ...list([]), data: undefined, isError: true, error: new ApiError("x", 409, "repo_not_cloned") });
    ui();
    expect(screen.getByText(messages.page.notCloned)).toBeInTheDocument();
    cleanup();
    ui({ noRepo: true });
    expect(screen.getByText(messages.page.noRepo)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: messages.page.addRepo })).toHaveAttribute("href", "/onboarding");
  });

  it("truncated notice (AC21)", () => {
    files.mockReturnValue(list([doc("a.md")], true));
    ui();
    expect(screen.getByText(messages.page.truncated)).toBeInTheDocument();
  });

  it("list and preview errors have Retry (AC22, AC23)", () => {
    const refetch = vi.fn();
    files.mockReturnValue({ ...list([]), data: undefined, isError: true, error: new ApiError("boom", 500), refetch });
    ui();
    expect(screen.getByText(messages.page.loadError)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
    cleanup();
    const fileRefetch = vi.fn();
    files.mockReturnValue(list([doc("a.md"), doc("b.md")]));
    file.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: fileRefetch });
    ui();
    expect(screen.getByText(messages.page.previewError)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(fileRefetch).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /a\.md/ })).toBeInTheDocument();
  });

  it("Used by counts (AC24)", () => {
    files.mockReturnValue(list([doc("a.md")]));
    usage.mockReturnValue({ data: { agents: [], skills: [] } });
    ui();
    expect(screen.getByText("Used by 0 agents · 0 skills")).toBeInTheDocument();
  });

  it("Attach menu: sections, marks, toggle (AC25, AC26, AC83)", () => {
    files.mockReturnValue(list([doc("a.md")]));
    ui();
    fireEvent.click(screen.getByRole("button", { name: messages.attach.button }));
    expect(screen.getByText(messages.attach.agents)).toBeInTheDocument();
    expect(screen.getByText(messages.attach.skills)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Security" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Style" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Style" }));
    expect(mutate).toHaveBeenLastCalledWith(
      { owner: { kind: "agent", id: "a2" }, path: "a.md", attach: true },
      expect.any(Object),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Security" }));
    expect(mutate).toHaveBeenLastCalledWith(
      { owner: { kind: "agent", id: "a1" }, path: "a.md", attach: false },
      expect.any(Object),
    );
  });

  it("rolls the checkbox back and toasts on failure (AC27)", async () => {
    files.mockReturnValue(list([doc("a.md")]));
    mutate.mockImplementation((_v, opts) => opts.onError(new Error("nope")));
    ui();
    fireEvent.click(screen.getByRole("button", { name: messages.attach.button }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Style" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Couldn't update attachments: nope"));
    expect(screen.getByRole("checkbox", { name: "Style" })).not.toBeChecked();
  });

  it("toolbar has only Refresh; Refresh refetches with aria-busy (AC28, AC29)", () => {
    const refetch = vi.fn();
    files.mockReturnValue({ ...list([doc("a.md")]), isFetching: true, refetch });
    ui();
    const btn = screen.getByRole("button", { name: messages.page.refresh });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    for (const n of ["New", "Folder", "Upload", "Edit"]) {
      expect(screen.queryByRole("button", { name: n })).not.toBeInTheDocument();
    }
    expect(screen.queryByText(/Indexed/)).not.toBeInTheDocument();
    cleanup();
    files.mockReturnValue({ ...list([doc("a.md")]), refetch });
    ui();
    fireEvent.click(screen.getByRole("button", { name: messages.page.refresh }));
    expect(refetch).toHaveBeenCalled();
  });

  it("does not execute raw HTML or javascript: links (AC30)", () => {
    files.mockReturnValue(list([doc("a.md")]));
    file.mockReturnValue({
      data: { path: "a.md", content: "<script>window.__x=1</script><img src=x onerror=alert(1)>\n\n[go](javascript:alert(1))" },
      isLoading: false,
    });
    ui();
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
    const link = screen.queryByRole("link", { name: "go" });
    expect(link?.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
  });
});
