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
  useRefreshContext,
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
    get.mockResolvedValue(att("r1", ["a.md", "b.md"]));
    const { result } = renderHook(
      () => {
        useContextAttachments({ kind: "agent", id: "a1" }, "r1");
        return useSetContextAttachments({ kind: "agent", id: "a1" }, "r1");
      },
      { wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync(["b.md"]).catch(() => {});
    });
    await waitFor(() => expect(get).toHaveBeenCalled());
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

  it("serializes back-to-back toggles for one owner so none is lost (F4)", async () => {
    const { wrapper } = setup();
    let stored: string[] = [];
    const tick = () => new Promise((r) => setTimeout(r, 10));
    get.mockImplementation(async () => {
      const snap = [...stored];
      await tick();
      return att("r1", snap);
    });
    put.mockImplementation(async (_u: string, body: { paths: string[] }) => {
      await tick();
      stored = body.paths;
      return att("r1", stored);
    });
    const { result } = renderHook(() => useToggleDocAttachment("r1"), { wrapper });
    const owner = { kind: "agent", id: "a1" } as const;
    await act(async () => {
      await Promise.all([
        result.current.mutateAsync({ owner, path: "doc1.md", attach: true }),
        result.current.mutateAsync({ owner, path: "doc2.md", attach: true }),
      ]);
    });
    expect(stored).toEqual(["doc1.md", "doc2.md"]);
  });
});

describe("useSetContextAttachments queued saves (N2)", () => {
  it("an earlier save settling does not clobber a later optimistic state; failure rolls back to the last confirmed result", async () => {
    const { qc, wrapper } = setup();
    const owner = { kind: "agent", id: "a1" } as const;
    const key = ["context-attachments", "agent", "a1", "r1"];
    qc.setQueryData(key, att("r1", ["x.md"]));
    let resolveA!: (v: unknown) => void;
    let rejectB!: (e: Error) => void;
    put.mockImplementationOnce(() => new Promise((r) => (resolveA = r)));
    put.mockImplementationOnce(() => new Promise((_r, rej) => (rejectB = rej)));
    get.mockResolvedValue(att("r1", ["a.md"]));
    const { result } = renderHook(
      () => ({ q: useContextAttachments(owner, "r1"), m: useSetContextAttachments(owner, "r1") }),
      { wrapper },
    );
    const paths = () => qc.getQueryData<ReturnType<typeof att>>(key)?.attached.map((x) => x.path);
    await act(async () => {
      void result.current.m.mutateAsync(["a.md"]).catch(() => {});
    });
    await act(async () => {
      void result.current.m.mutateAsync(["a.md", "b.md"]).catch(() => {});
    });
    expect(paths()).toEqual(["a.md", "b.md"]);
    get.mockClear();
    await act(async () => {
      resolveA(att("r1", ["a.md"]));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(paths()).toEqual(["a.md", "b.md"]);
    expect(get).not.toHaveBeenCalled();
    await act(async () => {
      rejectB(new Error("boom"));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(paths()).toEqual(["a.md"]);
  });
});

describe("useRefreshContext (N8)", () => {
  it("invalidates the repo's context and only that repo's attachment queries", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(["context-attachments", "agent", "a1", "r1"], att("r1", []));
    qc.setQueryData(["context-attachments", "agent", "a1", "r2"], att("r2", []));
    const spy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useRefreshContext("r1"), { wrapper });
    result.current();
    expect(spy).toHaveBeenCalledWith({ queryKey: ["context", "r1"] });
    const pred = spy.mock.calls.map((c) => c[0]?.predicate).find(Boolean)!;
    const find = (r: string) => qc.getQueryCache().find({ queryKey: ["context-attachments", "agent", "a1", r] })!;
    expect(pred(find("r1"))).toBe(true);
    expect(pred(find("r2"))).toBe(false);
  });
});

describe("Refresh while a panel save is pending (R2)", () => {
  it("does not refetch attachments of an owner with an in-flight save", async () => {
    const { qc, wrapper } = setup();
    const owner = { kind: "agent", id: "a1" } as const;
    const key = ["context-attachments", "agent", "a1", "r1"];
    qc.setQueryData(key, att("r1", ["x.md"]));
    let release!: (v: unknown) => void;
    put.mockImplementation(() => new Promise((r) => (release = r)));
    get.mockResolvedValue(att("r1", ["x.md"]));
    const { result } = renderHook(
      () => ({
        q: useContextAttachments(owner, "r1"),
        m: useSetContextAttachments(owner, "r1"),
        refresh: useRefreshContext("r1"),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.q.isSuccess).toBe(true));
    await act(async () => {
      void result.current.m.mutateAsync(["x.md", "y.md"]);
    });
    get.mockClear();
    await act(async () => {
      result.current.refresh();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(get).not.toHaveBeenCalled();
    expect(qc.getQueryData<ReturnType<typeof att>>(key)?.attached.map((x) => x.path)).toEqual(["x.md", "y.md"]);
    release(att("r1", ["x.md", "y.md"])); // drain the module-level queue for other tests
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  });
});

describe("rollback when the API is down (AC38, AC27)", () => {
  const owner = { kind: "agent", id: "a1" } as const;
  const key = ["context-attachments", "agent", "a1", "r1"];
  const paths = (qc: QueryClient) =>
    qc.getQueryData<ReturnType<typeof att>>(key)?.attached.map((x) => x.path);

  it("panel save: PUT and the follow-up GET both fail -> rows show the pre-change list", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(key, att("r1", ["a.md", "b.md"]));
    put.mockRejectedValue(new Error("down"));
    get.mockRejectedValue(new Error("down"));
    const { result } = renderHook(
      () => ({ q: useContextAttachments(owner, "r1"), m: useSetContextAttachments(owner, "r1") }),
      { wrapper },
    );
    await act(async () => {
      await result.current.m.mutateAsync(["b.md"]).catch(() => {});
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(paths(qc)).toEqual(["a.md", "b.md"]);
  });

  it("toggle: PUT and GET fail -> attachments return to the pre-change list", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(key, att("r1", ["a.md"]));
    get.mockRejectedValue(new Error("down"));
    put.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useToggleDocAttachment("r1"), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ owner, path: "z.md", attach: true }).catch(() => {});
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(paths(qc)).toEqual(["a.md"]);
  });
});
