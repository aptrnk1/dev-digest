import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/api", () => ({ api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) }, API_BASE: "" }));
vi.mock("@/lib/toast", () => ({ notify: { error: vi.fn() } }));

import { usePrIntent, useDeriveIntent } from "@/lib/hooks/intent";
import { useRunReview } from "@/lib/hooks/reviews";

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

describe("intent hooks", () => {
  it("usePrIntent fetches under ['pr-intent', prId]; disabled without a prId", async () => {
    get.mockResolvedValue({ intent: null, stale: false });
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => usePrIntent("p1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith("/pulls/p1/intent");
    expect(qc.getQueryData(["pr-intent", "p1"])).toEqual({ intent: null, stale: false });

    get.mockClear();
    renderHook(() => usePrIntent(null), { wrapper });
    expect(get).not.toHaveBeenCalled();
  });

  it("useDeriveIntent posts the body and invalidates the intent query", async () => {
    post.mockResolvedValue({});
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useDeriveIntent("p1"), { wrapper });
    result.current.mutate({ force: true });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["pr-intent", "p1"] }));
    expect(post).toHaveBeenCalledWith("/pulls/p1/intent", { force: true });
  });

  it("useRunReview also invalidates the intent query", async () => {
    post.mockResolvedValue({});
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useRunReview(), { wrapper });
    result.current.mutate({ prId: "p1", all: true });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["pr-intent", "p1"] }));
  });
});
