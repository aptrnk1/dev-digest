## T12 fix2 — DONE
Fixes (client/src/app/repos/[repoId]/tour/_components/TourView/TourView.tsx):
- G3 FIXED: with no tour, `!cloned` is now checked before `failedJob`, so an uncloned repo shows the not-cloned empty state with no Try again. The spec (AC36) does not define precedence against not-cloned. I dropped the failed banner in that case because the error is stale and not actionable.
- G7 FIXED: one local `LoadingSkeleton` component, used for both repos-loading and tour-loading.
Tests: new case "shows the not-cloned state without Try again when a failed run has no clone". It was red against the old code and is green now. Client typecheck and TourView.test.tsx pass.
