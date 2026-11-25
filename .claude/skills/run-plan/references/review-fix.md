# Phases 5–6 — final review and the fix loop

## Phase 5 — review round 1 (parallel, one message)

| Reviewer | Delegation | Finds |
|---|---|---|
| `plan-verifier` | `plan: <path>` · `base: <Base sha>` · `evidence: …/verify-<sha>.md` | MISSING / PARTIAL / DEVIATION, AC test in the wrong lane, unplanned files |
| `architecture-reviewer` | `scope: diff <Base>..HEAD` · `plan: <path>` | layer / boundary / contract-twin violations |
| `/code-review high` | Skill tool, args: `high <paths>` — the files of `git diff --name-only <Base>..HEAD` (the branch starts from the user's HEAD, not `main`, so a branch target would drag in unrelated commits) | correctness bugs |

Then write the ledger.

## The ledger — `specs/plans/reports/<feature>/review-<round>.md`

One table, every finding from every reviewer, deduplicated (same
`file:line` + same problem → one row, all sources listed):

| id | source | sev | location | owner | action | status |
|---|---|---|---|---|---|---|
| F1 | arch A2 | critical | `server/…/service.ts:41` | T2 | fix | open |
| F2 | verifier AC5 | MISSING | — | T3 | reopen | open |
| F3 | code-review | major | `client/…/Panel.tsx:88` | T4 | fix | open |
| F4 | verifier AC7 lane | PARTIAL | `server/test/x.test.ts` | T3 | add test | open |

**Severity → action** (verifier statuses map: MISSING/DEVIATION on an AC =
critical, PARTIAL = major, UNVERIFIABLE = env, not a fix):

| sev | action |
|---|---|
| critical, major | **fix** (must) |
| minor | fix only if the owner edits that file this round anyway; else **defer** |
| nit, info | **skip** |
| UNVERIFIABLE | **env** — list for the user (Docker, manual check) |

**Owner** = the task whose `Owns` contains the file. A finding spanning two
tasks' files → one owner + `extra-owns: <the other files>`. No owner (file
outside every Owns, or a design-level problem) → **plan change** (below).
A missing test only (or a test in the wrong lane) → the owning task's
`implementer`, action **add test** (lane = the AC's verification hint).

## Phase 6 — fix round (repeat ≤3 times)

1. **Dispatch fixes**, grouped by owner, in parallel when the groups' files
   are disjoint (main checkout, feature branch — fixes are small; no
   worktrees):
   - the original implementer if it is still alive: `SendMessage` with
     `fixes:` (id, location, problem, expected, source quote);
   - otherwise a new `implementer`: `plan`, `task: T<n>`, `fixes: …`,
     `extra-owns: …` (if any), `report: …/T<n>-fix<round>.md`;
   - test-only rows go to the same implementer as a `fixes:` item with
     `lane: <the AC's hint lane>` and the verifier's gap text.
2. **Disputes.** An implementer may answer `DISPUTED` with evidence
   (`file:line`, a rule that allows it). Decide yourself when the evidence is
   a quote of a project rule / INSIGHTS entry; otherwise ask the user
   (accept finding / accept dispute). Record the decision in the ledger.
3. **Gate + commit.** `scripts/check.sh <pkg> gate` for touched packages;
   red → back to the owner once. Then commit
   `<feature>: review fixes round <n>` and set `Fix base` in flow.md to the
   sha **before** this commit (the delta reviewers diff from it).
4. **Delta review** (parallel, one message):
   - `architecture-reviewer`: `previous: <ledger path, arch rows>` +
     `scope: diff <fix-base>..HEAD`;
   - `plan-verifier`: `previous: <last verifier report>` + `since: <fix-base>`;
   - `/code-review high` with the changed paths (`git diff --name-only
     <fix-base>..HEAD`) as the target.
5. **New ledger** `review-<n+1>.md`: previous rows with status
   `fixed | open | disputed-accepted | deferred`, plus new findings.

### Exit criteria

Leave the loop (→ Phase 7) when **all** hold:
- no `open` critical/major row;
- `plan-verifier` verdict `COMPLETE`, or `BLOCKED_UNVERIFIABLE` where every
  blocker is `env`;
- the last gate run is green.

### Escalate to the user (`AskUserQuestion`) when any holds

- 3 fix rounds done and an exit criterion still fails;
- the same finding is `open` after 2 rounds (not converging);
- a round produced more new critical/major findings than it fixed;
- a fix needs a plan change.

Show the open rows (≤10) and offer: **Fix manually** (stop, print resume
command) · **Accept and finish** (rows become `accepted-by-user`, listed in
the PR summary) · **Change the plan** (below) · **One more round**.

### Plan change

You do not re-plan. Stop and tell the user which ledger rows need new or
changed tasks; they amend the plan manually (or re-run
`implementation-planner` with `amend: <ledger rows>` — keep task ids,
Progress and done tasks). Record `Open escalations` in flow.md. On
`/run-plan plan: <path>` again: plan-lint, execute only the new or reopened
tasks (`references/execute.md`), then continue with step 3.
