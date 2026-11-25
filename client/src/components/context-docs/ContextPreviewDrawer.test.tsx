import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/context.json";

const mocks = vi.hoisted(() => ({ file: {} as any }));
vi.mock("@/lib/hooks/context", () => ({ useContextFile: () => mocks.file }));

import { ContextPreviewDrawer } from "./ContextPreviewDrawer";

afterEach(cleanup);

function Host() {
  const [open, setOpen] = React.useState(false);
  return (
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <button onClick={() => setOpen(true)}>Preview</button>
      {open && <ContextPreviewDrawer repoId="r1" path="specs/a.md" onClose={() => setOpen(false)} />}
    </NextIntlClientProvider>
  );
}

describe("ContextPreviewDrawer", () => {
  it("shows path + markdown; Esc and Close return focus to Preview (AC48)", () => {
    mocks.file = { data: { path: "specs/a.md", content: "# Hello" }, isLoading: false, isError: false, refetch: vi.fn() };
    render(<Host />);
    const btn = screen.getByRole("button", { name: "Preview" });
    btn.focus();
    fireEvent.click(btn);
    expect(screen.getByRole("dialog")).toHaveTextContent("specs/a.md");
    expect(screen.getByRole("heading", { name: "Hello" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(btn).toHaveFocus();

    btn.focus();
    fireEvent.click(btn);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(btn).toHaveFocus();
  });

  it("error with Retry (AC49)", () => {
    const refetch = vi.fn();
    mocks.file = { data: undefined, isLoading: false, isError: true, refetch };
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByText("Couldn't load document")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("skeleton while loading (AC16)", () => {
    mocks.file = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() };
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByTestId("context-skeleton")).toBeInTheDocument();
  });
});
