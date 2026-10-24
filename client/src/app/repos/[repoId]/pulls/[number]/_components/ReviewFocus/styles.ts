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
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
    fontSize: 14,
  } satisfies CSSProperties,
  link: {
    color: "var(--text-primary)",
    textDecoration: "none",
    wordBreak: "break-word",
  } satisfies CSSProperties,
  empty: { fontSize: 14, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
