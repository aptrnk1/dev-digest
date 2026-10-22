import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const get = vi.fn();
vi.mock("@/lib/api", () => ({ api: { get: (...a: unknown[]) => get(...a) }, API_BASE: "" }));

import { useBlastRadius } from "@/lib/hooks/blast";

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

describe("useBlastRadius", () => {
  it("fetches under ['blast', prId]; disabled without a prId", async () => {
    const data = { changed_symbols: [], downstream: [], summary: "" };
    get.mockResolvedValue(data);
    const { qc, wrapper } = setup();
    const { result } = renderHook(() => useBlastRadius("p1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(get).toHaveBeenCalledWith("/pulls/p1/blast-radius");
    expect(qc.getQueryData(["blast", "p1"])).toEqual(data);

    get.mockClear();
    renderHook(() => useBlastRadius(null), { wrapper });
    expect(get).not.toHaveBeenCalled();
  });
});
