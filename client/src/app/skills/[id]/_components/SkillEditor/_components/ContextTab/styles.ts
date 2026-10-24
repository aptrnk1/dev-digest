import type { CSSProperties } from "react";

export const s = {
  head: { display: "flex", flexDirection: "column", gap: 4 } satisfies CSSProperties,
  titleRow: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  title: { fontSize: 17, fontWeight: 700 } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  serializes: { marginTop: 16, maxWidth: 960 } satisfies CSSProperties,
  label: { fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: "var(--text-muted)", marginBottom: 8 } satisfies CSSProperties,
  pre: {
    margin: 0,
    padding: "14px 16px",
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 13,
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
  } satisfies CSSProperties,
} as const;
