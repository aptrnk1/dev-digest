import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/runs.json"; // apps/web/messages/en/runs.json

// Mock the trace hooks so the drawer renders without a query client / SSE.
const TRACE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, cost_usd: 0.06, findings: 2, grounding: "2/2 passed" },
  prompt_assembly: {
    system: "You are a reviewer.",
    skills: "### skill",
    memory: null,
    specs: null,
    user: "Review PR #482",
    block_tokens: { system: 100, skills: 150, user: 200 },
  },
  tool_calls: [{ tool: "review_file", args: "src/config.ts", meta: "single-pass", ms: 1200 }],
  raw_output: '{"verdict":"request_changes"}',
  memory_pulled: [{ pr: 471, text: "rate-limit public endpoints" }],
  specs_read: [],
  log: [
    { t: "00.10", kind: "info", msg: "Starting review with agent Security" },
    { t: "00.90", kind: "result", msg: "Citation grounding: 2/2 passed" },
  ],
};

vi.mock("../../../../../../../lib/hooks/trace", () => ({
  useRunTrace: () => ({ data: TRACE, isLoading: false }),
}));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: false }),
}));

import RunTraceDrawer from "./RunTraceDrawer";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">{ui}</div>
    </NextIntlClientProvider>,
  );
}

describe("A5 Run Trace drawer (smoke)", () => {
  it("renders the trace tabs and stats", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(screen.getByText("2/2 passed")).toBeInTheDocument();
    expect(screen.getByText("Tool calls")).toBeInTheDocument();
    expect(screen.getByText("COST")).toBeInTheDocument();
    expect(screen.getByText("$0.06")).toBeInTheDocument();
  });

  it("shows the PR intent prompt block only when prompt_assembly.intent is set", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.queryByText("PR intent (dynamic)")).toBeNull();
    cleanup();
    TRACE.prompt_assembly.intent = "## PR intent\nAdd rate limiting";
    try {
      renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
      fireEvent.click(screen.getByText("Prompt assembly"));
      expect(screen.getByText("PR intent (dynamic)")).toBeInTheDocument();
    } finally {
      TRACE.prompt_assembly.intent = null;
    }
  });

  it("switches to the live log tab", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    fireEvent.click(screen.getByText("log"));
    // LiveLogStream renders its filter input
    expect(screen.getByPlaceholderText("Filter log…")).toBeInTheDocument();
  });
});

describe("AC70-AC74 Project context specs in trace", () => {
  it("AC70: shows specs read as space-separated paths or none", () => {
    TRACE.specs_read = ["specs/security-baseline.md", "specs/public-api.md"];
    try {
      renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
      expect(screen.getByText("specs/security-baseline.md")).toBeInTheDocument();
      expect(screen.getByText("specs/public-api.md")).toBeInTheDocument();
    } finally {
      TRACE.specs_read = [];
    }
  });

  it("AC70: shows none when specs_read is empty", () => {
    TRACE.specs_read = [];
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("none")).toBeInTheDocument();
  });

  it("AC71: shows Project context label with token count in prompt assembly", () => {
    const specsText = "## Project context\n- specs/security-baseline.md\n- specs/public-api.md";
    TRACE.prompt_assembly.specs = specsText;
    TRACE.prompt_assembly.block_tokens!.specs = 450;
    TRACE.specs_read = ["specs/security-baseline.md", "specs/public-api.md"];
    try {
      renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
      fireEvent.click(screen.getByText("Prompt assembly"));
      expect(screen.getByText("Project context — attached specs (untrusted)")).toBeInTheDocument();
      // Should show token count
      expect(screen.getByText("450 tok")).toBeInTheDocument();
    } finally {
      TRACE.prompt_assembly.specs = null;
      delete TRACE.prompt_assembly.block_tokens!.specs;
    }
  });

  it("AC72: expand shows full specs text", () => {
    const specsText = "## Project context\n- specs/security-baseline.md\n- specs/public-api.md";
    TRACE.prompt_assembly.specs = specsText;
    try {
      renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
      fireEvent.click(screen.getByText("Prompt assembly"));
      const label = screen.getByText("Project context — attached specs (untrusted)");
      fireEvent.click(label);
      // The text is inside a <pre> element, so we need to check if it contains the text
      const preElement = screen.getByText((content, element) => {
        return element?.tagName === "PRE" && element?.textContent === specsText;
      });
      expect(preElement).toBeInTheDocument();
    } finally {
      TRACE.prompt_assembly.specs = null;
    }
  });

  it("AC73: copy button copies specs text to clipboard", async () => {
    const specsText = "## Project context\n- specs/security-baseline.md";
    TRACE.prompt_assembly.specs = specsText;
    // Mock navigator.clipboard for this test
    const mockClipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    const originalClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      value: mockClipboard,
      configurable: true,
    });
    try {
      renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
      fireEvent.click(screen.getByText("Prompt assembly"));
      // Find the specs label and then the copy button within its row
      const specsLabel = screen.getByText("Project context — attached specs (untrusted)");
      const specsRow = specsLabel.closest("div");
      expect(specsRow).toBeDefined();
      if (specsRow) {
        const copyButton = specsRow.querySelector('button[title="Copy"]') as HTMLButtonElement;
        expect(copyButton).toBeDefined();
        if (copyButton) {
          fireEvent.click(copyButton);
          expect(mockClipboard.writeText).toHaveBeenCalledWith(specsText);
        }
      }
    } finally {
      TRACE.prompt_assembly.specs = null;
      Object.defineProperty(navigator, "clipboard", {
        value: originalClipboard,
        configurable: true,
      });
    }
  });

  it("AC74: does not render Project context row when specs is null/missing/empty string", () => {
    // Test with specs = null
    TRACE.prompt_assembly.specs = null;
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Prompt assembly"));
    expect(screen.queryByText("Project context — attached specs (untrusted)")).toBeNull();
    cleanup();

    // Test with specs = empty string
    TRACE.prompt_assembly.specs = "";
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Prompt assembly"));
    expect(screen.queryByText("Project context — attached specs (untrusted)")).toBeNull();

    // Reset to null
    TRACE.prompt_assembly.specs = null;
  });
});
