import type { CSSProperties } from "react";

/** Co-located styles for the agent editor's Context tab. */
export const s = {
  h2: { fontSize: 18, fontWeight: 700, margin: 0 } satisfies CSSProperties,
  badge: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  footer: { display: "flex", flexDirection: "column", gap: 4, fontSize: 12 } satisfies CSSProperties,
  sum: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" } satisfies CSSProperties,
  total: { fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  warn: { color: "var(--warning)" } satisfies CSSProperties,
  note: { color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
