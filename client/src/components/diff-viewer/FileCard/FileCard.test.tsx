import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile } from "@devdigest/shared";
import prReview from "../../../../messages/en/prReview.json";
import shell from "../../../../messages/en/shell.json";
import { FileCard } from "./FileCard";
import { AUTO_EXPAND_MAX_LINES } from "../constants";

afterEach(cleanup);

const PATCH = ["@@ -1,2 +1,3 @@", " keep", "+const key = 1;", " tail"].join("\n");
// visible new lines: 1 (ctx), 2 (add), 3 (ctx)

const FILE: PrFile = { path: "src/a.ts", additions: 1, deletions: 0, patch: PATCH };

function finding(id: string, over: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id,
    severity: "CRITICAL",
    category: "security",
    title: `title ${id}`,
    file: "src/a.ts",
    start_line: 2,
    end_line: 2,
    rationale: "r",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  } as FindingRecord;
}

function wrap(ui: React.ReactElement) {
  return (
    <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
      {ui}
    </NextIntlClientProvider>
  );
}

const renderFinding = (f: FindingRecord) => <div data-testid={`fc-${f.id}`}>{f.title}</div>;

describe("FileCard findings overlay", () => {
  it("shows the findings badge with count and max severity colour", () => {
    render(wrap(<FileCard file={FILE} findings={[finding("a"), finding("b")]} maxSeverity="CRITICAL" renderFinding={renderFinding} />));
    const badge = screen.getByText("2 findings");
    expect(badge).toHaveStyle({ color: "var(--crit)" });
  });

  it("uses the singular form and warning colour", () => {
    render(wrap(<FileCard file={FILE} findings={[finding("a", { severity: "WARNING" })]} maxSeverity="WARNING" renderFinding={renderFinding} />));
    expect(screen.getByText("1 finding")).toHaveStyle({ color: "var(--warn)" });
  });

  it("renders the finding under the anchored line", () => {
    render(wrap(<FileCard file={FILE} findings={[finding("a")]} maxSeverity="CRITICAL" renderFinding={renderFinding} />));
    const row = screen.getByText("const key = 1;").closest("div")!.parentElement!;
    expect(row).toContainElement(screen.getByTestId("fc-a"));
    expect(screen.queryByText("Findings outside the visible diff")).toBeNull();
  });

  it("renders findings outside the visible diff in a file-level block", () => {
    render(wrap(<FileCard file={FILE} findings={[finding("z", { start_line: 90, end_line: 91 })]} maxSeverity="CRITICAL" renderFinding={renderFinding} />));
    expect(screen.getByText("Findings outside the visible diff")).toBeInTheDocument();
    expect(screen.getByTestId("fc-z")).toBeInTheDocument();
  });

  it("with no patch every finding is file-level", () => {
    render(wrap(<FileCard file={{ ...FILE, patch: null }} findings={[finding("a")]} maxSeverity="CRITICAL" renderFinding={renderFinding} />));
    expect(screen.getByText("Findings outside the visible diff")).toBeInTheDocument();
    expect(screen.getByTestId("fc-a")).toBeInTheDocument();
  });

  it("starts open above the auto-expand limit when it has findings", () => {
    const big = { ...FILE, additions: AUTO_EXPAND_MAX_LINES + 50 };
    render(wrap(<FileCard file={big} findings={[finding("a")]} maxSeverity="CRITICAL" renderFinding={renderFinding} />));
    expect(screen.getByTestId("fc-a")).toBeInTheDocument();
  });

  it("stays closed above the limit without findings", () => {
    const big = { ...FILE, additions: AUTO_EXPAND_MAX_LINES + 50 };
    render(wrap(<FileCard file={big} />));
    expect(screen.queryByText("const key = 1;")).toBeNull();
  });

  it("opens when findings arrive after mount, unless the user toggled it", () => {
    const big = { ...FILE, additions: AUTO_EXPAND_MAX_LINES + 50 };
    const { rerender } = render(wrap(<FileCard file={big} findings={[]} />));
    expect(screen.queryByText("const key = 1;")).toBeNull();
    rerender(wrap(<FileCard file={big} findings={[finding("a")]} maxSeverity="CRITICAL" renderFinding={renderFinding} />));
    expect(screen.getByTestId("fc-a")).toBeInTheDocument();

    cleanup();
    const second = render(wrap(<FileCard file={big} findings={[]} />));
    fireEvent.click(screen.getByText("src/a.ts")); // user opens
    fireEvent.click(screen.getByText("src/a.ts")); // user closes
    second.rerender(wrap(<FileCard file={big} findings={[finding("a")]} maxSeverity="CRITICAL" renderFinding={renderFinding} />));
    expect(screen.queryByTestId("fc-a")).toBeNull();
  });

  it("renders findings independently of the comments toggle", () => {
    const commenting = { comments: [], canComment: false, showComments: false, posting: false, onSubmit: async () => ({}) as never };
    render(wrap(<FileCard file={FILE} commenting={commenting} findings={[finding("a")]} maxSeverity="CRITICAL" renderFinding={renderFinding} />));
    expect(screen.getByTestId("fc-a")).toBeInTheDocument();
  });
});
