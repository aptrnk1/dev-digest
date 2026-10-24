import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Risk } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";
import { BriefRisks } from "./BriefRisks";

const RISKS: Risk[] = [
  { kind: "security", title: "Token bypass", explanation: "x", severity: "high", file_refs: ["src/a.ts", "src/b.ts"] },
  { kind: "dependency", title: "New dep", explanation: "y", severity: "medium", file_refs: ["package.json"] },
  { kind: "perf", title: "Slow loop", explanation: "z", severity: "low", file_refs: [] },
];

function ui(risks: Risk[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      <BriefRisks risks={risks} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("BriefRisks", () => {
  it("renders the block heading and title + first file ref as plain text", () => {
    ui(RISKS);
    expect(screen.getByText("Risks by file")).toBeInTheDocument();
    expect(screen.getByText("Token bypass")).toBeInTheDocument();
    const file = screen.getByText("src/a.ts");
    expect(file.closest("a")).toBeNull();
    expect(file.style.fontFamily).toContain("mono");
    expect(screen.queryByText("src/b.ts")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("uses one icon for every kind and colours + names by severity", () => {
    ui(RISKS);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    const svgs = items.map((li) => li.querySelector("svg")!);
    expect(new Set(svgs.map((s) => s.innerHTML)).size).toBe(1);
    expect(screen.getByLabelText("High severity")).toHaveStyle({ color: "var(--crit)" });
    expect(screen.getByLabelText("Medium severity")).toHaveStyle({ color: "var(--warn)" });
    expect(screen.getByLabelText("Low severity")).toHaveStyle({ color: "var(--text-secondary)" });
  });

  it("shows noRisks for an empty list", () => {
    ui([]);
    expect(screen.getByText("No notable risks flagged.")).toBeInTheDocument();
  });

  it("renders HTML in the title as text", () => {
    ui([{ ...RISKS[0]!, title: "<b>bold</b>" }]);
    expect(screen.getByText("<b>bold</b>")).toBeInTheDocument();
  });
});
