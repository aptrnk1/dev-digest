import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FindingRecord, PrFile } from "@devdigest/shared";
import prReview from "../../../../../../../../messages/en/prReview.json";
import brief from "../../../../../../../../messages/en/brief.json";
import shell from "../../../../../../../../messages/en/shell.json";
import { DiffTab } from "./DiffTab";

let searchFile: string | null = null;
const scroll = vi.fn();
Element.prototype.scrollIntoView = scroll;
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(searchFile ? { file: searchFile } : {}),
}));
vi.mock("@/lib/toast", () => ({ notify: { error: vi.fn() } }));

const PATCH = ["@@ -1,2 +1,3 @@", " keep", "+const key = 1;", " tail"].join("\n");
const FILES: PrFile[] = [
  { path: "src/a.ts", additions: 1, deletions: 0, patch: PATCH },
  { path: "src/a.test.ts", additions: 1, deletions: 0, patch: PATCH },
  { path: "dist/out.js", additions: 1, deletions: 0, patch: PATCH },
];

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded key",
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
} as FindingRecord;

const sf = (path: string, ids: string[] = []) => ({
  path,
  additions: 1,
  deletions: 0,
  finding_lines: ids.length ? [2] : [],
  finding_ids: ids,
  max_severity: ids.length ? ("CRITICAL" as const) : null,
  rank_percentile: null,
});

function smartDiff(boilerplateIds: string[] = []) {
  return {
    groups: [
      { role: "core", files_with_findings: 1, files: [sf("src/a.ts", ["f1"])] },
      { role: "tests", files_with_findings: 0, files: [sf("src/a.test.ts")] },
      {
        role: "boilerplate",
        files_with_findings: boilerplateIds.length ? 1 : 0,
        files: [sf("dist/out.js", boilerplateIds)],
      },
    ],
    split_suggestion: { too_big: false, total_lines: 3, proposed_splits: [] },
  };
}

const reviews = [{ id: "r1", findings: [FINDING] }];

type Handler = () => { status?: number; body: unknown };
let routes: Record<string, Handler>;
const calls: { url: string; method: string }[] = [];

beforeEach(() => {
  searchFile = null;
  scroll.mockClear();
  calls.length = 0;
  routes = {
    "/pulls/p1/smart-diff": () => ({ body: smartDiff() }),
    "/pulls/p1/reviews": () => ({ body: reviews }),
    "/pulls/p1/comments": () => ({ body: [] }),
    "/findings/f1/accept": () => ({ body: { finding: { ...FINDING, accepted_at: "now" } } }),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      calls.push({ url: path, method: init?.method ?? "GET" });
      const h = routes[path];
      const r = h ? h() : { status: 404, body: { message: "nope" } };
      const status = r.status ?? 200;
      return {
        ok: status < 400,
        status,
        statusText: "",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => r.body,
        text: async () => JSON.stringify(r.body),
      } as unknown as Response;
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function ui() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ prReview, shell, brief }}>
        <DiffTab prId="p1" filesCount={3} files={FILES} canComment={false} repoFullName="o/r" headSha="abc" />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("DiffTab ?file= deep link", () => {
  it("opens the collapsed Boilerplate group and the file, scrolls and focuses its header", async () => {
    searchFile = "dist/out.js";
    ui();
    await screen.findByText("Core");
    await waitFor(() =>
      expect(screen.getByText("dist/out.js").closest("[data-role]")?.getAttribute("data-role")).toBe("boilerplate"),
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText("dist/out.js").parentElement));
    expect(scroll).toHaveBeenCalled();
    expect(screen.getAllByText("const key = 1;").length).toBeGreaterThanOrEqual(3);
  });

  it("jumps in the flat list while Smart Diff is loading, then once more in the groups", async () => {
    searchFile = "src/a.test.ts";
    ui();
    expect(scroll).toHaveBeenCalledTimes(1);
    await screen.findByText("Core");
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(2));
    expect(document.activeElement).toBe(screen.getByText("src/a.test.ts").parentElement);
  });

  it("jumps in the flat list when Smart Diff fails", () => {
    routes["/pulls/p1/smart-diff"] = () => ({ status: 500, body: { message: "boom" } });
    searchFile = "dist/out.js";
    ui();
    expect(document.activeElement).toBe(screen.getByText("dist/out.js").parentElement);
  });

  it("shows an info line for an unknown file and leaves group state unchanged", async () => {
    searchFile = "nope.ts";
    ui();
    expect(screen.getByText("nope.ts is not in the current diff.")).toBeInTheDocument();
    await screen.findByText("Core");
    expect(screen.queryByText("dist/out.js")).toBeNull();
    expect(scroll).not.toHaveBeenCalled();
  });
});

describe("DiffTab smart diff", () => {
  it("renders groups in server order with label, file count and findings counter", async () => {
    ui();
    expect(await screen.findByText("Core")).toBeInTheDocument();
    const labels = ["Core", "Tests", "Boilerplate"].map((l) => screen.getByText(l));
    const roles = labels.map((l) => l.closest("[data-role]")!.getAttribute("data-role"));
    expect(roles).toEqual(["core", "tests", "boilerplate"]);
    expect(screen.getByText("Files changed · 3 files")).toBeInTheDocument();
    expect(screen.getAllByText("1 files")).toHaveLength(3);
    expect(screen.getByText("1 with findings")).toBeInTheDocument();
  });

  it("collapses Boilerplate unless it has findings", async () => {
    ui();
    await screen.findByText("Core");
    expect(screen.queryByText("dist/out.js")).toBeNull();
    fireEvent.click(screen.getByText("Boilerplate"));
    expect(screen.getByText("dist/out.js")).toBeInTheDocument();
  });

  it("expands Boilerplate when it has findings", async () => {
    routes["/pulls/p1/smart-diff"] = () => ({ body: smartDiff(["f1"]) });
    ui();
    expect(await screen.findByText("dist/out.js")).toBeInTheDocument();
  });

  it("renders the inline FindingCard and accept posts to /findings/:id/accept", async () => {
    ui();
    expect(await screen.findByText("Hardcoded key")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /accept/i }));
    await waitFor(() =>
      expect(calls).toContainEqual({ url: "/findings/f1/accept", method: "POST" }),
    );
  });

  it("falls back to the flat list while smart-diff fails, with no error state", async () => {
    routes["/pulls/p1/smart-diff"] = () => ({ status: 500, body: { message: "boom" } });
    ui();
    expect(await screen.findByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("dist/out.js")).toBeInTheDocument();
    expect(screen.queryByText("Core")).toBeNull();
    expect(screen.queryByText(/boom|couldn't|error/i)).toBeNull();
  });

  it("shows the flat list while smart-diff is loading", () => {
    ui();
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.queryByText("Core")).toBeNull();
  });
});
