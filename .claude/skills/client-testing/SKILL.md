---
name: client-testing
description: >-
  How DevDigest's client (Next.js 15 + React 19) is tested — the short,
  project-specific replacement for a generic React Testing Library guide.
  Use when writing or fixing a test under client/src: a component test
  (<Name>.test.tsx next to the component), a TanStack Query hook test in
  src/lib/hooks, or a helper test. Covers the existing setup (vitest + jsdom,
  jest-dom), the two render patterns used in the repo (next-intl wrapper,
  QueryClient wrapper), what to mock (hook modules, @/lib/api, next/navigation),
  query priority, and the traps recorded in client/INSIGHTS.md.
---

# Client testing (DevDigest)

Setup already exists — never add config, providers files or dependencies.
`client/vitest.config.ts`: jsdom, `globals: true`, aliases `@` → `src`,
`@devdigest/shared` → `src/vendor/shared`, `@devdigest/ui` → `src/vendor/ui`;
`src/test/setup.ts` loads `@testing-library/jest-dom/vitest` and stubs
`ResizeObserver`. Tests: `src/**/*.test.{ts,tsx}`.

Available: `@testing-library/react` (`render`, `renderHook`, `screen`,
`within`, `fireEvent`, `waitFor`, `cleanup`) + jest-dom. **Not** available:
`@testing-library/user-event`, MSW → use `fireEvent`, mock modules.

Run: `scripts/check.sh client test <file>` (one file while iterating),
`scripts/check.sh client typecheck` once at the end.

## Component test

```tsx
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "<relative>/messages/en/<ns>.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/hooks/<x>", () => ({ useThing: () => ({ data: [/* fixture */], isLoading: false }) }));

import { Thing } from "./Thing"; // after vi.mock

afterEach(cleanup);

const renderWithIntl = (ui: React.ReactElement) =>
  render(<NextIntlClientProvider locale="en" messages={{ <ns>: messages }}>{ui}</NextIntlClientProvider>);
```

- Mock the **hook module** the component uses (`@/lib/hooks/<x>`), not
  `fetch`; return the shape the component reads (`data`, `isLoading`,
  `isError`, `mutateAsync`, `isPending`). One test per state that matters:
  ideal, empty, loading, error.
- Expected text comes from `messages/en/<ns>.json` (import the JSON or copy the
  exact string) — never invent copy.

## Hook test (`src/lib/hooks/*.test.tsx`)

Mock `@/lib/api` (`vi.mock("@/lib/api", () => ({ api: { get: (...a) => get(...a) }, API_BASE: "" }))`),
`renderHook` with a `QueryClientProvider` wrapper whose client has
`defaultOptions: { queries: { retry: false } }`, then
`await waitFor(() => expect(result.current.isSuccess).toBe(true))`. Assert the
URL passed to `api.*` and the query key (`qc.getQueryData([...])`).
Reference: `src/lib/hooks/blast.test.tsx`.

## Queries and assertions

- Priority: `getByRole(role, { name })` → `getByLabelText` → `getByText`;
  `data-testid` only when nothing semantic exists.
- Async: `findBy*` / `waitFor`; absence: `queryBy*` + `not.toBeInTheDocument()`.
- Assert what the user sees (text, role, ARIA state), never CSS classes,
  internal state or call order that is not part of the contract.

## Repo traps (client/INSIGHTS.md)

- Toggle chips: `getByRole("button", { name })` +
  `toHaveAttribute("aria-pressed", "true")`, not styles.
- Severities: iterate the zod contract (`CRITICAL | WARNING | SUGGESTION`),
  never `SEV` from vendor/ui (it has a phantom `INFO`).
- Only `import type` from `@devdigest/shared` in client code — a runtime
  import passes vitest and typecheck but 500s in Next.
- jsdom `File` has no `arrayBuffer` — code reads uploads via `FileReader`.
- Never put `<word>` in `messages/en/*.json` (ICU tag) — use `[word]`.
- A component that copies server data into local state needs `key={id}`;
  test switching the entity if the component does this.
