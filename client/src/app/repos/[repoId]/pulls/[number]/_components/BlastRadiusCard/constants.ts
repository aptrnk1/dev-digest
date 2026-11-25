import type { BlastDegradedReason } from "@devdigest/shared";

/* Degraded reason → i18n key under `blast`. Mirrors the shared enum locally
   (type-only imports: a runtime import of @devdigest/shared breaks the Next build). */
export const DEGRADED_MESSAGE_KEY = {
  flag_off: "degraded.flag_off",
  index_failed: "degraded.index_failed",
  index_partial: "degraded.index_partial",
  repo_too_large: "degraded.repo_too_large",
  no_data: "degraded.no_data",
} satisfies Record<BlastDegradedReason, string>;

/* Whether a rebuild (resync) can fix the reason. */
export const REBUILD_HELPS = {
  flag_off: false,
  index_failed: true,
  index_partial: true,
  repo_too_large: false,
  no_data: true,
} satisfies Record<BlastDegradedReason, boolean>;

/* Card views; the value doubles as the `blast.view.*` i18n key suffix. */
export const VIEWS = ["tree", "graph"] as const;
export type BlastView = (typeof VIEWS)[number];
