import type React from "react";

type S = Record<string, React.CSSProperties>;

export const s = {
  page: { display: "flex", flexDirection: "column", gap: 16, padding: 24 },
  layout: { display: "flex", gap: 32, padding: "24px 28px", alignItems: "flex-start" },
  toc: { position: "sticky", top: 24, width: 220, flexShrink: 0, display: "flex", flexDirection: "column" },
  tocTitle: {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 12,
  },
  tocLink: {
    padding: "8px 14px",
    fontSize: 14,
    color: "var(--text-secondary)",
    borderLeft: "2px solid transparent",
    textDecoration: "none",
  },
  tocLinkActive: { color: "var(--text-primary)", borderLeftColor: "var(--accent)" },
  main: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 16 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 },
  headerText: { minWidth: 0 },
  title: { margin: 0, fontSize: 28, fontWeight: 600 },
  accent: { color: "var(--accent-text)" },
  subtitle: { margin: "6px 0 0", color: "var(--text-muted)", fontSize: 14 },
  actions: { display: "flex", gap: 8, flexShrink: 0 },
  banner: {
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    fontSize: 13,
  },
  link: { color: "var(--accent-text)" },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clip: "rect(0 0 0 0)",
    whiteSpace: "nowrap",
  },
} satisfies S;
