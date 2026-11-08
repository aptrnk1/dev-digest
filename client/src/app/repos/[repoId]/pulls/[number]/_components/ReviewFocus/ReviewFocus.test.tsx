import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReviewFocusItem } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/repos/r1/pulls/482",
}));

import { ReviewFocus } from "./ReviewFocus";

const ITEMS: ReviewFocusItem[] = [
  { file: "src/a b.ts", line: 12, reason: "Unchecked input" },
  { file: "src/c.ts", line: 3, reason: "<i>raw</i>" },
];

function ui(items: ReviewFocusItem[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      <ReviewFocus items={items} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("ReviewFocus", () => {
  it("renders title with count and items in order as file:line — reason", () => {
    ui(ITEMS);
    expect(screen.getByText(/Review focus — read these first/)).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent("src/a b.ts:12 — Unchecked input");
    expect(links[1]).toHaveTextContent("src/c.ts:3 — <i>raw</i>");
  });

  it("click navigates with router.replace to the diff tab", () => {
    ui(ITEMS);
    const notPrevented = fireEvent.click(screen.getAllByRole("link")[0]!);
    expect(notPrevented).toBe(false);
    expect(replace).toHaveBeenCalledWith(
      `/repos/r1/pulls/482?tab=diff&file=${encodeURIComponent("src/a b.ts")}&line=12`,
    );
  });

  it("is a real focusable anchor (Enter activates it natively)", () => {
    ui(ITEMS);
    const link = screen.getAllByRole("link")[1]!;
    link.focus();
    expect(document.activeElement).toBe(link);
    expect(link).toHaveAttribute("href", "/repos/r1/pulls/482?tab=diff&file=src%2Fc.ts&line=3");
  });

  it("shows noFocus for an empty list", () => {
    ui([]);
    expect(screen.getByText("No specific lines to start with.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
