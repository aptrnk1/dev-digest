import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingTourResponse, Repo } from "@devdigest/shared";
import { ApiError } from "@/lib/api";
import { ToastProvider } from "@/lib/toast";
import onboarding from "../../../../../../../messages/en/onboarding.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

type TourState = {
  data?: OnboardingTourResponse;
  isLoading?: boolean;
  isError?: boolean;
};
let tourState: TourState = {};
const refetch = vi.fn();
const mutate = vi.fn();
let genState: { isPending: boolean; error: unknown } = { isPending: false, error: null };

vi.mock("@/lib/hooks", () => ({
  useOnboardingTour: () => ({ isLoading: false, isError: false, refetch, ...tourState }),
  useGenerateOnboarding: () => ({ mutate, ...genState }),
}));
vi.mock("../sections", () => ({
  TourSections: () => (
    <div>
      {["architecture", "critical-paths", "run-locally", "reading-path", "first-tasks"].map((id) => (
        <section key={id} id={id} />
      ))}
    </div>
  ),
}));

import { TourView } from "./TourView";

const REPO = {
  id: "r1",
  owner: "acme",
  name: "payments-api",
  full_name: "acme/payments-api",
  clone_path: "/tmp/x",
} as Repo;

const tourOf = (over: Record<string, unknown> = {}) =>
  ({
    commit_sha: "a".repeat(40),
    generated_at: new Date(Date.now() - 2 * 3_600_000 - 5000).toISOString(),
    files_indexed: 12450,
    index_status: "full",
    architecture: { summary: "s", diagram: { nodes: [], edges: [] } },
    critical_paths: [],
    run_steps: [],
    reading_path: [],
    first_tasks: [],
    ...over,
  }) as unknown as NonNullable<OnboardingTourResponse["tour"]>;

const job = (status: "running" | "done" | "failed", error: string | null = null) => ({
  status,
  error,
  started_at: new Date().toISOString(),
  finished_at: status === "running" ? null : new Date().toISOString(),
});

function renderView(repo: Repo | null = REPO, extra: Record<string, unknown> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding }}>
      <ToastProvider>
        <TourView repoId="r1" repo={repo} {...extra} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

const writeText = vi.fn();
beforeEach(() => {
  tourState = {};
  genState = { isPending: false, error: null };
  mutate.mockReset();
  refetch.mockReset();
  push.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  window.history.replaceState(null, "", "/repos/r1/tour");
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

const withTour = (over: Record<string, unknown> = {}, j = job("done")) => {
  tourState = { data: { tour: tourOf(over), job: j } };
};

describe("TourView header", () => {
  it("shows the title, buttons and indexed subtitle with ago", () => {
    withTour();
    renderView();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Onboarding for payments-api");
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Share link" })).toBeInTheDocument();
    expect(
      screen.getByText("Generated from index of 12,450 files · last refreshed 2h ago"),
    ).toBeInTheDocument();
  });

  it.each([
    [10_000, "just now"],
    [5 * 60_000, "5m ago"],
    [3 * 86_400_000, "3d ago"],
  ])("formats %i ms as %s", (ms, text) => {
    withTour({ generated_at: new Date(Date.now() - ms).toISOString() });
    renderView();
    expect(screen.getByText(new RegExp(`last refreshed ${text}$`))).toBeInTheDocument();
  });

  it("uses the files subtitle when nothing was indexed", () => {
    withTour({ files_indexed: 0, index_status: "none" });
    renderView();
    expect(screen.getByText(/^Generated from repository files · last refreshed/)).toBeInTheDocument();
  });

  it("shows the partial-index banner unless the index is full", () => {
    withTour({ index_status: "partial" });
    renderView();
    expect(screen.getByText(onboarding.states.partialIndex)).toBeInTheDocument();
    cleanup();
    withTour();
    renderView();
    expect(screen.queryByText(onboarding.states.partialIndex)).not.toBeInTheDocument();
  });
});

describe("TourView navigation", () => {
  it("lists five links, highlights the first by default and follows a click", () => {
    withTour();
    renderView();
    const nav = screen.getByRole("navigation", { name: "On this page" });
    const links = nav.querySelectorAll("a");
    expect(links).toHaveLength(5);
    expect(screen.getByRole("link", { name: "Architecture overview" })).toHaveAttribute("aria-current", "location");
    fireEvent.click(screen.getByRole("link", { name: "How to run locally" }));
    expect(screen.getByRole("link", { name: "How to run locally" })).toHaveAttribute("aria-current", "location");
    expect(screen.getByRole("link", { name: "Architecture overview" })).not.toHaveAttribute("aria-current");
    expect(window.location.hash).toBe("#run-locally");
    expect(document.getElementById("run-locally")!.scrollIntoView).toHaveBeenCalled();
  });

  it("scrolls to and highlights the hash section on a deep link", () => {
    window.history.replaceState(null, "", "/repos/r1/tour#first-tasks");
    withTour();
    renderView();
    expect(screen.getByRole("link", { name: "First tasks" })).toHaveAttribute("aria-current", "location");
    expect(document.getElementById("first-tasks")!.scrollIntoView).toHaveBeenCalled();
  });
});

describe("TourView share link", () => {
  it("copies the full URL with the hash and toasts", async () => {
    withTour();
    renderView();
    fireEvent.click(screen.getByRole("link", { name: "Critical paths" }));
    fireEvent.click(screen.getByRole("button", { name: "Share link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href));
    expect(writeText.mock.calls[0]![0]).toContain("#critical-paths");
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
  });

  it("toasts when copying fails", async () => {
    writeText.mockRejectedValue(new Error("no"));
    withTour();
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Share link" }));
    expect(await screen.findByText("Couldn't copy to clipboard")).toBeInTheDocument();
  });
});

describe("TourView states", () => {
  it("shows skeletons while loading", () => {
    tourState = { isLoading: true };
    const { container } = renderView();
    expect(container.querySelector("[aria-busy='true']")).toBeInTheDocument();
  });

  it("shows an error with Retry when the first load fails", () => {
    tourState = { isError: true };
    renderView();
    expect(screen.getByText(onboarding.states.loadError.title)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("shows a loading state, not the empty state, while repos load", () => {
    const { container } = renderView(null, { reposStatus: "loading" });
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    expect(screen.queryByText(onboarding.states.noRepo)).not.toBeInTheDocument();
  });

  it("shows an error with Retry when the repos fetch fails", () => {
    const retry = vi.fn();
    renderView(null, { reposStatus: "error", onRetryRepos: retry });
    expect(screen.getByText(onboarding.states.loadError.title)).toBeInTheDocument();
    expect(screen.queryByText(onboarding.states.noRepo)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalled();
  });

  it("prompts to add a repository when there is none", () => {
    renderView(null);
    expect(screen.getByText(onboarding.states.noRepo)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add repository" }));
    expect(push).toHaveBeenCalledWith("/onboarding");
  });

  it("explains an uncloned repo without a generate button", () => {
    tourState = { data: { tour: null, job: null } };
    renderView({ ...REPO, clone_path: null } as Repo);
    expect(screen.getByText(onboarding.states.notCloned)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate tour" })).not.toBeInTheDocument();
  });

  it("shows the empty state and starts generation", () => {
    tourState = { data: { tour: null, job: null } };
    renderView();
    expect(screen.getByText(onboarding.states.empty.title)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate tour" }));
    expect(mutate).toHaveBeenCalled();
  });

  it("shows the generating state in a live region while a first run is running", () => {
    tourState = { data: { tour: null, job: job("running") } };
    renderView();
    const title = screen.getByText(onboarding.states.generating.title);
    expect(title.closest("[aria-live='polite']")).not.toBeNull();
  });

  it("treats a 409 in-progress result as running without an error banner", () => {
    tourState = { data: { tour: null, job: job("running") } };
    genState = { isPending: false, error: null };
    renderView();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the failure and Try again when a first run failed", () => {
    tourState = { data: { tour: null, job: job("failed", "Generation timed out") } };
    renderView();
    expect(screen.getByText("Couldn't generate the tour: Generation timed out")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(mutate).toHaveBeenCalled();
  });

  it("keeps the tour with a Regenerating banner and a disabled busy button", () => {
    withTour({}, job("running"));
    renderView();
    expect(screen.getByText(onboarding.states.regenerating)).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: "Regenerate" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(document.getElementById("architecture")).toBeInTheDocument();
  });

  it("keeps the tour and shows a failed regeneration", () => {
    withTour({}, job("failed", "Generation timed out"));
    renderView();
    expect(screen.getByText("Couldn't regenerate the tour: Generation timed out")).toBeInTheDocument();
    expect(document.getElementById("architecture")).toBeInTheDocument();
  });

  it("maps start errors to banners", () => {
    withTour();
    genState = { isPending: false, error: new ApiError("x", 422, "llm_not_configured") };
    renderView();
    expect(screen.getByRole("link", { name: "Settings → API Keys" })).toHaveAttribute("href", "/settings/api-keys");
    cleanup();
    genState = { isPending: false, error: new ApiError("x", 409, "repo_not_cloned") };
    renderView();
    expect(screen.getByText(onboarding.errors.notCloned)).toBeInTheDocument();
    cleanup();
    genState = { isPending: false, error: new ApiError("Server exploded", 500, "boom") };
    renderView();
    expect(screen.getByText("Couldn't start generation: Server exploded")).toBeInTheDocument();
  });

  it("shows Connection lost on a failed refetch and hides it after success", () => {
    tourState = { data: { tour: tourOf(), job: job("done") }, isError: true };
    const { rerender } = renderView();
    const banner = screen.getByText(onboarding.states.connectionLost);
    expect(banner.closest("[aria-live='polite']")).not.toBeNull();
    expect(document.getElementById("architecture")).toBeInTheDocument();
    tourState = { data: { tour: tourOf(), job: job("done") }, isError: false };
    rerender(
      <NextIntlClientProvider locale="en" messages={{ onboarding }}>
        <ToastProvider>
          <TourView repoId="r1" repo={REPO} />
        </ToastProvider>
      </NextIntlClientProvider>,
    );
    expect(screen.queryByText(onboarding.states.connectionLost)).not.toBeInTheDocument();
  });

  it("disables Regenerate with a hint when the repo is not cloned but still shows the tour", () => {
    withTour();
    renderView({ ...REPO, clone_path: null } as Repo);
    const btn = screen.getByRole("button", { name: "Regenerate" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", onboarding.page.regenerateDisabledHint);
    const hintId = btn.getAttribute("aria-describedby")!;
    expect(document.getElementById(hintId)).toHaveTextContent(onboarding.page.regenerateDisabledHint);
    expect(screen.getByRole("button", { name: "Share link" })).toBeEnabled();
  });
});
