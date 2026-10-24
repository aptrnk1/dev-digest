## T12 fix1 — DONE (saved by orchestrator from hand-back)
F7 fixed `TourView.tsx:124`: new optional props `reposStatus?: "loading"|"error"|"ready"` (default ready), `onRetryRepos?`. No repo + loading → skeleton; + error → ErrorState (`states.loadError.title`) with Retry → refetch; empty "Add a repository" only when ready. page.tsx derives reposStatus from `useRepos()` (same query key as provider, no extra request).
Verify: client typecheck PASS; TourView.test.tsx PASS (loading + error tests added; not run red first).
Concerns: useActiveRepo has no error flag → page.tsx calls useRepos directly (repo-context.tsx outside Owns); reused loadError title wording.
