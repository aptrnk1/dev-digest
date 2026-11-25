import type { CSSProperties } from "react";

export const s = {
  wrap: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  svg: { width: "100%", height: "auto", display: "block" } satisfies CSSProperties,
  label: { fontSize: 12, fill: "var(--text-primary)" } satisfies CSSProperties,
  edge: { fill: "none", stroke: "var(--border)", strokeWidth: 1.5 } satisfies CSSProperties,
  edgeDashed: { strokeDasharray: "4 4", stroke: "var(--blue, #3b82f6)", opacity: 0.6 } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  legend: {
    display: "flex",
    flexWrap: "wrap",
    gap: 16,
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  legendItem: { display: "inline-flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  swatch: { width: 12, height: 12, borderRadius: 3, display: "inline-block" } satisfies CSSProperties,
} as const;

export const NODE_STYLE = {
  symbol: { fill: "var(--accent-bg, rgba(99,102,241,0.12))", stroke: "var(--accent)" },
  caller: { fill: "var(--bg-elevated)", stroke: "var(--border)" },
  endpoint: { fill: "var(--blue-bg, rgba(59,130,246,0.12))", stroke: "var(--blue, #3b82f6)" },
  cron: { fill: "var(--orange-bg, rgba(249,115,22,0.12))", stroke: "var(--orange, #f97316)" },
} as const;
