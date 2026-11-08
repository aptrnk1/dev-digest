import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Skill } from "@devdigest/shared";
import skills from "../../../../../../../../messages/en/skills.json";
import context from "../../../../../../../../messages/en/context.json";
import { ToastProvider } from "../../../../../../../lib/toast";

type Gate = { promise: Promise<void>; open: () => void };
const gate = (): Gate => {
  let open!: () => void;
  const promise = new Promise<void>((r) => (open = r));
  return { promise, open };
};

const mocks = vi.hoisted(() => ({
  repo: { id: "r1", full_name: "acme/api" } as { id: string; full_name: string },
  gates: {} as Record<string, Promise<void>>,
}));

const doc = (path: string) => ({ path, folder: "specs/", category: "specs", tokens: 5, status: "ok" });
const DOCS: Record<string, string[]> = { r1: ["specs/r1-doc.md"], r2: ["specs/r2-doc.md"] };
const ATT: Record<string, string[]> = { "s1:r1": ["specs/r1-doc.md"], "s2:r1": [], "s1:r2": ["specs/r2-doc.md"] };

vi.mock("@/lib/repo-context", () => ({ useActiveRepo: () => ({ activeRepo: mocks.repo }) }));
vi.mock("@/lib/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/api")>()),
  api: {
    get: async (url: string) => {
      await mocks.gates[url];
      let m = url.match(/^\/repos\/([^/]+)\/context$/);
      if (m) return { docs: DOCS[m[1]!]!.map(doc), truncated: false };
      m = url.match(/^\/skills\/([^/]+)\/context\?repo_id=(.+)$/);
      if (m) {
        const paths = ATT[`${m[1]}:${m[2]}`] ?? [];
        return {
          repo_id: m[2],
          attached: paths.map((path) => ({ path, status: "ok", tokens: 5 })),
          inherited: [],
        };
      }
      throw new Error(`unexpected ${url}`);
    },
  },
}));

import { ContextTab } from "./ContextTab";

afterEach(() => {
  cleanup();
  mocks.repo = { id: "r1", full_name: "acme/api" };
  mocks.gates = {};
});

const skill = (id: string) => ({ id, name: id, description: "d", type: "rubric", source: "manual", body: "b", enabled: true, version: 1 }) as Skill;

const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
function tree(client: QueryClient, s: Skill) {
  return (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={{ skills, context }}>
        <ToastProvider>
          <ContextTab skill={s} />
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
}

describe("skill ContextTab with the real panel (AC43)", () => {
  it("switching the repo shows the new repo's rows and never the previous repo's", async () => {
    const client = qc();
    const view = render(tree(client, skill("s1")));
    expect(await screen.findByText("r1-doc.md")).toBeTruthy();
    expect(screen.getByText("Project context to use · acme/api")).toBeTruthy();

    const g = gate();
    mocks.gates["/repos/r2/context"] = g.promise;
    mocks.repo = { id: "r2", full_name: "acme/web" };
    view.rerender(tree(client, skill("s1")));

    // while the new pair loads: no stale rows from r1
    expect(screen.queryByText("r1-doc.md")).toBeNull();
    expect(screen.getByText("Project context to use · acme/web")).toBeTruthy();
    g.open();
    expect(await screen.findByText("r2-doc.md")).toBeTruthy();
    expect(screen.queryByText("r1-doc.md")).toBeNull();
  });

  it("switching the skill shows the new skill's attachments, not the previous skill's", async () => {
    const client = qc();
    const view = render(tree(client, skill("s1")));
    await screen.findByText("r1-doc.md");
    await waitFor(() => expect(screen.getByRole("checkbox", { checked: true })).toBeTruthy());
    expect(screen.getByText("1 attached")).toBeTruthy();

    const g = gate();
    mocks.gates["/skills/s2/context?repo_id=r1"] = g.promise;
    view.rerender(tree(client, skill("s2")));

    // pending: the previous skill's attachment must not be shown
    expect(screen.queryByRole("checkbox", { checked: true })).toBeNull();
    g.open();
    await waitFor(() => expect(screen.getByText("Nothing attached")).toBeTruthy());
    expect(screen.queryByRole("checkbox", { checked: true })).toBeNull();
    expect(screen.getByText("0 attached")).toBeTruthy();
  });
});
