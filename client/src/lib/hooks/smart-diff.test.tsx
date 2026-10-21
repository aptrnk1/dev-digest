import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();
vi.mock("@/lib/api", () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    del: (...a: unknown[]) => del(...a),
  },
  API_BASE: "",
}));
vi.mock("@/lib/toast", () => ({ notify: { error: vi.fn() } }));

import { useSmartDiff } from "@/lib/hooks/smart-diff";
import { useRunReview, useDeleteRun, useDeleteReview, useFindingAction } from "@/lib/hooks/reviews";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, spy, wrapper };
}

describe("smart-diff hooks", () => {
  it("useSmartDiff fetches under ['smart-diff', prId]; disabled without a prId", async () => {
    const data = { groups: [], split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] } };
    get.mockResolvedValue(data);
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useSmartDiff("p1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith("/pulls/p1/smart-diff");
    expect(qc.getQueryData(["smart-diff", "p1"])).toEqual(data);

    get.mockClear();
    renderHook(() => useSmartDiff(null), { wrapper });
    expect(get).not.toHaveBeenCalled();
  });

  async function expectBoth(spy: { mock: { calls: unknown[][] } }) {
    await waitFor(() => expect(spy.mock.calls).toContainEqual([{ queryKey: ["smart-diff", "p1"] }]));
    expect(spy.mock.calls).toContainEqual([{ queryKey: ["reviews", "p1"] }]);
  }

  it("useFindingAction invalidates smart-diff with reviews", async () => {
    post.mockResolvedValue({});
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useFindingAction(), { wrapper });
    result.current.mutate({ findingId: "f1", action: "accept", prId: "p1" });
    await expectBoth(spy);
  });

  it("useRunReview invalidates smart-diff with reviews", async () => {
    post.mockResolvedValue({});
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useRunReview(), { wrapper });
    result.current.mutate({ prId: "p1", all: true });
    await expectBoth(spy);
  });

  it("useDeleteRun invalidates smart-diff with reviews", async () => {
    del.mockResolvedValue({ ok: true });
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useDeleteRun("p1"), { wrapper });
    result.current.mutate("run1");
    await expectBoth(spy);
  });

  it("useDeleteReview invalidates smart-diff with reviews", async () => {
    del.mockResolvedValue({ ok: true });
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useDeleteReview("p1"), { wrapper });
    result.current.mutate("rev1");
    await expectBoth(spy);
  });
});
