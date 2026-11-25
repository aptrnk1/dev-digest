// Local list — no runtime import from @devdigest/shared in client code (client/INSIGHTS).
export const SEVERITY_COLOR = {
  high: "var(--crit)",
  medium: "var(--warn)",
  low: "var(--text-secondary)",
} as const satisfies Record<"high" | "medium" | "low", string>;
