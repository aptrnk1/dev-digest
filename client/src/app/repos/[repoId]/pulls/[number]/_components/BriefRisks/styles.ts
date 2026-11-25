import type { CSSProperties } from "react";

export const s = {
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
    fontSize: 14,
  } satisfies CSSProperties,
  title: { color: "var(--text-primary)", fontWeight: 500 } satisfies CSSProperties,
  file: {
    marginLeft: "auto",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 12,
    color: "var(--text-muted)",
    wordBreak: "break-all",
  } satisfies CSSProperties,
  empty: { fontSize: 14, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
