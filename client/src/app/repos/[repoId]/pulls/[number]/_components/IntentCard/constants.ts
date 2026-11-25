import type { IconName } from "@devdigest/ui";
import type { IntentRiskKind } from "@devdigest/shared";

/* Risk-kind → icon. Mirrors the shared enum locally (type-only imports: a
   runtime import of @devdigest/shared breaks the Next build). */
export const RISK_ICON = {
  security: "Shield",
  dependency: "Boxes",
  performance: "Gauge",
  data: "Database",
  api: "Link",
  other: "Info",
} satisfies Record<IntentRiskKind, IconName>;
