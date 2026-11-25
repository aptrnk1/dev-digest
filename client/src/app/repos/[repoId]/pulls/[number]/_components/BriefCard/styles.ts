import type { CSSProperties } from "react";

export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
  summary: {
    margin: 0,
    fontSize: 15,
    lineHeight: 1.55,
    color: "var(--text-primary)",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  note: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  warn: { fontSize: 13, color: "var(--warn)" } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)" } satisfies CSSProperties,
  right: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: 10,
    padding: "20px 12px",
  } satisfies CSSProperties,
  emptyTitle: { fontSize: 15, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
} as const;
