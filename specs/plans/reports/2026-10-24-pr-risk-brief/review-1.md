# Review round 1 — PR Risk Brief (diff db9e7b4..af6862b)

Sources: plan-verifier (BLOCKED_UNVERIFIABLE — 59 DONE, 3 env), architecture-reviewer (APPROVE, minor 1, info 1), /code-review high (10 unverified candidates).

| id | source | sev | location | owner | action | status |
|---|---|---|---|---|---|---|
| F1 | code-review | major | `server/src/modules/brief/facts.ts:122` | T6 | fix — blast callers/symbols uncapped; budget can only drop changed files → cap callers and trim them before files | fixed |
| F2 | code-review | major | `server/src/modules/brief/service.ts:127` | T10 | fix — sanitize/upsert inside LLM retry `try` → 2nd paid call on DB error, misreported as brief_failed | fixed |
| F3 | code-review | major | `client/…/BriefCard/BriefCard.tsx:44` | T7 | fix — on 409 brief_in_progress refetch brief query so the other request's result appears | fixed |
| F4 | code-review | minor | `server/src/modules/brief/facts.ts:100` | T6 | fix (owner edits file) — sanitize ctx built from capped files/ranges; validate against all PR files/ranges | fixed |
| F5 | code-review | minor | `server/src/modules/brief/service.ts:100` | T10 | fix (owner edits file) — resolveModel after fact gathering; fail fast, drop dead llm_not_configured branch | fixed |
| F6 | code-review | minor | `server/src/modules/brief/service.ts:125` | T10 | fix (owner edits file) — cost_usd counts only successful attempt; sum attempts | fixed |
| F7 | code-review | minor | `server/src/modules/brief/prompt.ts:114` | T6 | fix if trivial — reuse reviewer-core `wrapSpec`; drop duplicated missing/intentStale in BriefFacts. SEVERITY_RANK stays local (importing smart-diff/constants would break module boundary) | fixed |
| F8 | code-review | minor | `client/…/OverviewTab/styles.ts:6` | T11 | defer — `minmax(472px,1fr)` overflows < 472px; use `min(472px,100%)` | deferred |
| F9 | code-review | minor | `client/…/ReviewFocus/ReviewFocus.tsx:33` | T8 | defer — preventDefault breaks Cmd/Ctrl/middle-click | deferred |
| F10 | code-review | minor | `server/src/modules/context/run-context.service.ts:43` | T4 | defer — sequential loadForRun per agent | deferred |
| F11 | arch A1 | minor | `server/src/modules/brief/repository.ts:23` | T10 | defer — reads pulls/repos/pr_files tables directly; no PR read facade exists | deferred |
| F12 | arch A2 | info | `server/src/modules/brief/service.ts:46` | T10 | skip — in-memory lock, by design (D-f) | skipped |
| F13 | verifier | DEVIATION (non-AC) | `server/src/modules/context/ports.ts` | T4 | accepted — EnabledAgentStore port instead of AttachmentStore method | accepted |
| F14 | verifier | DEVIATION (non-AC) | `server/test/brief-routes.test.ts:9` | T10 | accepted — vi.mock(compose); real wiring covered by brief.it.test.ts | accepted |
| F15 | verifier AC10 [e2e] | UNVERIFIABLE | `e2e/specs/12-pr-brief.flow.json` | T13 | env — macOS 12 host; run in CI e2e-web.yml | env |
| F16 | verifier AC19 [manual] | UNVERIFIABLE | `client/…/OverviewTab/styles.ts` | — | env — manual layout check 1440/900 px vs D1 | env |
| F17 | verifier NFR6 [manual] | UNVERIFIABLE | — | — | env — manual keyboard walk-through | env |
