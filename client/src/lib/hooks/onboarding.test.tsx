import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/api", async () => {
  class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return {
    ApiError,
    api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
    API_BASE: "",
  };
});

import { ApiError } from "@/lib/api";
import { useOnboardingTour, useGenerateOnboarding } from "@/lib/hooks/onboarding";

const job = (status: "running" | "done" | "failed") => ({
  status,
  error: status === "failed" ? "Generation failed unexpectedly" : null,
  started_at: "2026-10-24T10:00:00.000Z",
  finished_at: status === "running" ? null : "2026-10-24T10:01:00.000Z",
});

function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useOnboardingTour", () => {
  it("polls every 2s while running and stops on done (AC33)", async () => {
    get.mockResolvedValueOnce({ job: job("running"), tour: null }).mockResolvedValue({ job: job("done"), tour: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useOnboardingTour("r1"), { wrapper });
    await waitFor(() => expect(result.current.data?.job?.status).toBe("running"));
    expect(get).toHaveBeenCalledWith("/repos/r1/onboarding");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    await waitFor(() => expect(result.current.data?.job?.status).toBe("done"));
    const calls = get.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(get.mock.calls.length).toBe(calls);
  });

  it("does not poll when the job is failed or absent", async () => {
    get.mockResolvedValue({ job: job("failed"), tour: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useOnboardingTour("r1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("keeps the last data and keeps polling after a failed refetch (AC77)", async () => {
    const running = { job: job("running"), tour: null };
    get
      .mockResolvedValueOnce(running)
      .mockRejectedValueOnce(new ApiError("down", 0, "network_error"))
      .mockResolvedValue(running);
    const { wrapper } = setup();
    const { result } = renderHook(() => useOnboardingTour("r1"), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(running));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(result.current.data).toEqual(running);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(result.current.data).toEqual(running);
  });

  it("is disabled without a repoId", () => {
    const { wrapper } = setup();
    renderHook(() => useOnboardingTour(""), { wrapper });
    expect(get).not.toHaveBeenCalled();
  });
});

describe("useGenerateOnboarding", () => {
  it("POSTs, caches the job and invalidates the tour query", async () => {
    post.mockResolvedValue({ job: job("running") });
    get.mockResolvedValue({ job: job("running"), tour: null });
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useGenerateOnboarding("r1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(post).toHaveBeenCalledWith("/repos/r1/onboarding/generate");
    expect((qc.getQueryData(["onboarding", "r1"]) as { job: { status: string } }).job.status).toBe("running");
  });

  it("409 onboarding_in_progress is not an error and invalidates the query (AC39)", async () => {
    post.mockRejectedValue(new ApiError("busy", 409, "onboarding_in_progress"));
    get.mockResolvedValue({ job: job("running"), tour: null });
    const { qc, wrapper } = setup();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useGenerateOnboarding("r1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(result.current.isError).toBe(false);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["onboarding", "r1"] });
  });

  it("surfaces other errors as ApiError with status and code", async () => {
    post.mockRejectedValue(new ApiError("no key", 422, "llm_not_configured"));
    const { wrapper } = setup();
    const { result } = renderHook(() => useGenerateOnboarding("r1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.code).toBe("llm_not_configured");
    expect(result.current.error?.status).toBe(422);
  });
});
