import type { CSSProperties } from "react";

/** Co-located styles for SmartDiffGroup. */
export const s = {
  group: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "4px 2px",
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--text-primary)",
    font: "inherit",
    textAlign: "left",
  } satisfies CSSProperties,
  label: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  meta: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  findings: { fontSize: 12, fontWeight: 600, color: "var(--warn)" } satisfies CSSProperties,
  body: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  chevron: (open: boolean): CSSProperties => ({
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  }),
} as const;
