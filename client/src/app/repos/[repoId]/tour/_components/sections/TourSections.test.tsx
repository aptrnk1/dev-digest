import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingTour } from "@devdigest/shared";
import onboarding from "../../../../../../../messages/en/onboarding.json";

const success = vi.fn();
const error = vi.fn();
vi.mock("@/lib/toast", () => ({ useToast: () => ({ success, error, info: vi.fn(), toast: vi.fn() }) }));
vi.mock("@/components/mermaid-diagram", () => ({
  MermaidDiagram: ({ chart, fallback }: { chart: string; fallback?: React.ReactNode }) =>
    chart.includes("INVALID") ? <>{fallback}</> : <pre data-testid="mermaid">{chart}</pre>,
}));

import { TourSections } from "./TourSections";

const SHA = "a".repeat(40);
const REPO = { owner: "acme", name: "payments-api" };

const tour = (over: Partial<OnboardingTour> = {}): OnboardingTour => ({
  commit_sha: SHA,
  generated_at: "2026-10-24T10:00:00Z",
  files_indexed: 10,
  index_status: "full",
  architecture: {
    summary: "**payments-api** enters via `src/server.ts` ok",
    diagram: {
      nodes: [
        { id: "n1", label: "client", kind: "external", path: null },
        { id: "n2", label: "server.ts", kind: "entry", path: "src/server.ts" },
      ],
      edges: [{ from: "n1", to: "n2" }],
    },
  },
  critical_paths: [{ path: "src/my file.ts", description: "Bootstrap" }],
  run_steps: [
    { command: "pnpm install", source_path: "package.json" },
    { command: "cp .env.example .env", source_path: "README.md" },
  ],
  reading_path: [{ path: "src/a.ts", why: "Start here" }],
  first_tasks: [{ title: "Add test", description: "Cover it", size: "S", files: ["src/a.ts", "src/b.ts"] }],
  ...over,
});

const renderTour = (t: OnboardingTour) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ onboarding }}>
      <TourSections tour={t} repo={REPO} />
    </NextIntlClientProvider>,
  );

afterEach(cleanup);
beforeEach(() => {
  success.mockReset();
  error.mockReset();
});

describe("TourSections", () => {
  it("renders five cards with ids and expanded toggles", () => {
    const { container } = renderTour(tour());
    for (const id of ["architecture", "critical-paths", "run-locally", "reading-path", "first-tasks"]) {
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
    expect(screen.getAllByRole("button", { name: /Toggle section/ }).every((b) => b.getAttribute("aria-expanded") === "true")).toBe(true);
  });

  it("collapses a card and keeps its title", () => {
    renderTour(tour());
    const toggle = screen.getByRole("button", { name: "Toggle section: Critical paths" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Bootstrap", { exact: false })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Critical paths" })).toBeInTheDocument();
  });

  it("formats the summary and renders the diagram", () => {
    renderTour(tour());
    expect(screen.getByText("payments-api").tagName).toBe("STRONG");
    expect(screen.getByText("src/server.ts").tagName).toBe("CODE");
    expect(screen.getByTestId("mermaid").textContent).toContain("flowchart LR");
  });

  it("shows Diagram unavailable for empty nodes and invalid diagrams", () => {
    renderTour(tour({ architecture: { summary: "s", diagram: { nodes: [], edges: [] } } }));
    expect(screen.getByText("Diagram unavailable")).toBeInTheDocument();
    cleanup();
    renderTour(
      tour({
        architecture: { summary: "s", diagram: { nodes: [{ id: "n1", label: "INVALID", kind: "module", path: null }], edges: [] } },
      }),
    );
    expect(screen.getByText("Diagram unavailable")).toBeInTheDocument();
  });

  it("Open links point to GitHub with encoded path", () => {
    renderTour(tour());
    const a = screen.getByRole("link", { name: "Open src/my file.ts" });
    expect(a).toHaveAttribute("href", `https://github.com/acme/payments-api/blob/${SHA}/src/my%20file.ts`);
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("First tasks: size badge and an Open per file; reading path has no Open", () => {
    renderTour(tour());
    expect(screen.getByText("S")).toBeInTheDocument();
    // src/a.ts: first task file only (reading path has none)
    expect(screen.getAllByRole("link", { name: "Open src/a.ts" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Open src/b.ts" })).toBeInTheDocument();
    const reading = document.getElementById("reading-path") as HTMLElement;
    expect(within(reading).queryByRole("link")).not.toBeInTheDocument();
  });

  it("How to run: note, numbering, source and copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderTour(tour());
    expect(screen.getByText("Generated from repo files — review before running.")).toBeInTheDocument();
    expect(screen.getByText("from README.md")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy command 2" }));
    await waitFor(() => expect(success).toHaveBeenCalledWith("Copied"));
    expect(writeText).toHaveBeenCalledWith("cp .env.example .env");
  });

  it("reports a clipboard failure", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) } });
    renderTour(tour());
    fireEvent.click(screen.getByRole("button", { name: "Copy command 1" }));
    await waitFor(() => expect(error).toHaveBeenCalledWith("Couldn't copy to clipboard"));
  });

  it("empty sections show the not-enough text", () => {
    renderTour(tour({ critical_paths: [], run_steps: [], reading_path: [], first_tasks: [] }));
    expect(screen.getAllByText("Not enough grounded information for this section.")).toHaveLength(4);
  });

  it("renders tour text as text, not HTML", () => {
    const { container } = renderTour(
      tour({ critical_paths: [{ path: "src/x.ts", description: "<script>alert(1)</script>" }] }),
    );
    expect(screen.getByText("<script>alert(1)</script>", { exact: false })).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
  });
});
