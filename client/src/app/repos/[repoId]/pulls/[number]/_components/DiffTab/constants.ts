/** Constants for DiffTab. */
import type { SmartDiffRole } from "@devdigest/shared";

/** Role → `prReview.smartDiff.*` label key. Enum order = display order. */
export const ROLE_LABEL_KEY = {
  core: "coreLabel",
  tests: "testsLabel",
  wiring: "wiringLabel",
  docs: "docsLabel",
  boilerplate: "boilerplateLabel",
} as const satisfies Record<SmartDiffRole, string>;
