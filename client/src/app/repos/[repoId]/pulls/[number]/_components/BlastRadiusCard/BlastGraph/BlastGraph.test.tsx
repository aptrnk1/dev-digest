import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadiusResponse } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/blast.json";
import { BlastGraph } from "./BlastGraph";
import { MAX_GRAPH_CALLERS } from "./layout";

type Downstream = BlastRadiusResponse["downstream"];

const LONG = "aVeryLongFunctionNameThatExceedsTheLimit";
const DS: Downstream = [
  {
    symbol: "charge",
    callers: [
      { name: "checkout", file: "src/checkout.ts", line: 23 },
      { name: LONG, file: "src/long.ts", line: 4 },
    ],
    endpoints_affected: ["POST /checkout"],
    crons_affected: ["0 * * * *"],
  },
];

function ui(downstream: Downstream, repo: string | null = "acme/shop", sha: string | null = "abc123") {
  return (
    <NextIntlClientProvider locale="en" messages={{ blast: messages }}>
      <BlastGraph downstream={downstream} repoFullName={repo} sha={sha} />
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

describe("BlastGraph", () => {
  it("renders an accessible svg with node labels and legend", () => {
    render(ui(DS));
    expect(screen.getByRole("img", { name: messages.graph.ariaLabel })).toBeTruthy();
    // each label appears as <text> and inside its <title>
    expect(screen.getAllByText("charge").length).toBeGreaterThan(0);
    expect(screen.getAllByText("POST /checkout").length).toBeGreaterThan(0);
    expect(screen.getByText(messages.graph.legend.symbol)).toBeTruthy();
    expect(screen.getByText(messages.graph.legend.callers)).toBeTruthy();
    expect(screen.getByText(messages.graph.legend.affected)).toBeTruthy();
  });

  it("truncates long labels with an ellipsis and keeps the full text in a title", () => {
    const { container } = render(ui(DS));
    expect(screen.queryByText(LONG)).toBeNull();
    expect(screen.getByText(/^aVeryLongFunctionName.*…$/)).toBeTruthy();
    const titles = Array.from(container.querySelectorAll("title")).map((x) => x.textContent ?? "");
    expect(titles.some((x) => x.startsWith(LONG))).toBe(true);
  });

  it("links callers to the GitHub blob when repo and sha exist", () => {
    const { container } = render(ui(DS));
    const a = container.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://github.com/acme/shop/blob/abc123/src/checkout.ts#L23");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders no links without repo or sha", () => {
    const { container } = render(ui(DS, null, null));
    expect(container.querySelector("a")).toBeNull();
  });

  it("shows the capped-callers note", () => {
    const callers = Array.from({ length: MAX_GRAPH_CALLERS + 2 }, (_, i) => ({
      name: `f${i}`,
      file: `src/f${i}.ts`,
      line: 1,
    }));
    render(ui([{ symbol: "s", callers, endpoints_affected: [], crons_affected: [] }]));
    expect(screen.getByText("+2 more callers not shown")).toBeTruthy();
  });

  it("shows the empty state for empty downstream", () => {
    render(ui([]));
    expect(screen.getByText(messages.graph.empty)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
