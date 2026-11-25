import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/api", () => ({
  api: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) },
  API_BASE: "",
}));

import { usePrBrief, useGenerateBrief } from "@/lib/hooks/brief";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe("usePrBrief", () => {
  it("GETs /pulls/:id/brief under ['pr-brief', id] and never POSTs on mount", async () => {
    const data = { brief: null, stale: false };
    get.mockResolvedValue(data);
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => usePrBrief("p1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith("/pulls/p1/brief");
    expect(qc.getQueryData(["pr-brief", "p1"])).toEqual(data);
    expect(post).not.toHaveBeenCalled();
  });

  it("is disabled without a prId", () => {
    const { wrapper } = setup();
    renderHook(() => usePrBrief(null), { wrapper });
    expect(get).not.toHaveBeenCalled();
  });
});

describe("useGenerateBrief", () => {
  it("POSTs without a body or abort signal and caches { brief, stale: false }", async () => {
    const brief = { summary: "S" };
    post.mockResolvedValue(brief);
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useGenerateBrief("p1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]).toEqual(["/pulls/p1/brief"]);
    expect(qc.getQueryData(["pr-brief", "p1"])).toEqual({ brief, stale: false });
  });
});
