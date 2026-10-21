import type { CSSProperties } from "react";

export const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
  quote: {
    margin: 0,
    paddingLeft: 12,
    borderLeft: "3px solid var(--accent)",
    fontSize: 15,
    lineHeight: 1.55,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  scopeGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
  } satisfies CSSProperties,
  scopeLabel: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,
  list: {
    margin: 0,
    paddingLeft: 18,
    fontSize: 14,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  chips: { display: "flex", flexWrap: "wrap", gap: 8 } satisfies CSSProperties,
  hint: { fontSize: 13, color: "var(--warn)" } satisfies CSSProperties,
  footer: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  unresolved: {
    opacity: 0.5,
  } satisfies CSSProperties,
  right: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
} as const;
