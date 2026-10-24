import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, cleanup, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const get = vi.fn();
const put = vi.fn();
vi.mock("@/lib/api", () => ({
  api: { get: (...a: unknown[]) => get(...a), put: (...a: unknown[]) => put(...a) },
  API_BASE: "",
}));

import {
  useContextAttachments,
  useSetContextAttachments,
  useToggleDocAttachment,
} from "@/lib/hooks/context";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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

const att = (repo: string, paths: string[]) => ({
  repo_id: repo,
  attached: paths.map((path) => ({ path, status: "ok", tokens: 1 })),
  inherited: [],
});

describe("useContextAttachments", () => {
  it("keys by (owner, repo) and never shows the previous pair's data (AC43)", async () => {
    get.mockImplementation(async (url: string) =>
      url.includes("repo_id=r1") ? att("r1", ["a.md"]) : att("r2", ["b.md"]),
    );
    const { qc, wrapper } = setup();
    const { result, rerender } = renderHook(
      ({ repo }: { repo: string }) => useContextAttachments({ kind: "agent", id: "a1" }, repo),
      { wrapper, initialProps: { repo: "r1" } },
    );
    await waitFor(() => expect(result.current.data?.attached[0]?.path).toBe("a.md"));
    expect(get).toHaveBeenCalledWith("/agents/a1/context?repo_id=r1");
    expect(qc.getQueryData(["context-attachments", "agent", "a1", "r1"])).toBeTruthy();

    rerender({ repo: "r2" });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data?.attached[0]?.path).toBe("b.md"));

    get.mockClear();
    renderHook(() => useContextAttachments({ kind: "skill", id: "s1" }, null), { wrapper });
    expect(get).not.toHaveBeenCalled();
  });
});

describe("useSetContextAttachments", () => {
  it("rolls the cache back when saving fails (AC38)", async () => {
    const { qc, wrapper } = setup();
    const key = ["context-attachments", "agent", "a1", "r1"];
    qc.setQueryData(key, att("r1", ["a.md", "b.md"]));
    put.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useSetContextAttachments({ kind: "agent", id: "a1" }, "r1"), {
      wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync(["b.md"]).catch(() => {});
    });
    expect(put).toHaveBeenCalledWith("/agents/a1/context?repo_id=r1", { paths: ["b.md"] });
    const data = qc.getQueryData<ReturnType<typeof att>>(key);
    expect(data?.attached.map((x) => x.path)).toEqual(["a.md", "b.md"]);
  });
});

describe("useToggleDocAttachment", () => {
  it("appends a new path and detaches keeping the order of the rest (AC26, AC83)", async () => {
    const { wrapper } = setup();
    get.mockResolvedValue(att("r1", ["a.md", "b.md", "c.md"]));
    put.mockResolvedValue(att("r1", []));
    const { result } = renderHook(() => useToggleDocAttachment("r1"), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ owner: { kind: "skill", id: "s1" }, path: "d.md", attach: true });
    });
    expect(get).toHaveBeenCalledWith("/skills/s1/context?repo_id=r1");
    expect(put).toHaveBeenLastCalledWith("/skills/s1/context?repo_id=r1", {
      paths: ["a.md", "b.md", "c.md", "d.md"],
    });

    await act(async () => {
      await result.current.mutateAsync({ owner: { kind: "skill", id: "s1" }, path: "b.md", attach: false });
    });
    expect(put).toHaveBeenLastCalledWith("/skills/s1/context?repo_id=r1", {
      paths: ["a.md", "c.md"],
    });
  });
});
