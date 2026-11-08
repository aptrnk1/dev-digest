---
name: workflow-retro
description: Retrospective of a multi-agent run in this Claude Code session — spec-creator ⇄ spec-reviewer loops, /run-plan waves, implementer fan-outs, Workflow scripts. Collects hard numbers from the local transcripts (tokens per agent and orchestrator, agent count, spawn/resume order, active vs wall time, turn-limit hits, tool errors, files read by several agents) and turns them plus the agents' handback reports into findings — what each agent struggled with, what went smoothly, what information was duplicated, what was missed and by whom — and concrete, evidence-backed changes to agent prompts, skills and the orchestration. Use after a multi-agent workflow finishes, or when the user says "retro", "how did the workflow go", "token usage of the agents", "/workflow-retro".
---

# Workflow retro

Output: `.claude/retros/<YYYY-MM-DD>-<slug>.md`, written in the user's language. It is read
by the user and by future sessions editing `.claude/agents/*` and `.claude/skills/*`.
Never edit agent prompts or skills from this skill — propose, the user decides.

## 1. Scope the run
- Default: the current session (`$CLAUDE_CODE_SESSION_ID`). Another session → `--session <id>`.
- A long session holding unrelated work → bound it with `--since` / `--until` (ISO; take them from
  the first spawn and last handback of the workflow — run the script once unbounded to see the timeline).
- Name the workflow (slug) after its goal, e.g. `project-context-spec`.

## 2. Collect numbers (don't estimate — run the script)
```
node scripts/workflow-stats.mjs [--since <ISO>] [--until <ISO>] --reports <scratchpad>/retro-reports
```
Prints totals, an agents table, the timeline, duplicated reads and re-reads. `--json` for raw
data. `--reports` writes one file per agent with every orchestrator → agent message and every
handback, in order — read them all; they are the qualitative evidence.

Know what the numbers mean:
- `cache_r` (cache reads) dominates token totals and is cheap; `cache_w` + `in` + `out` drive cost.
  Report both the total and the non-cache part.
- `active / wall`: wall time includes waiting for the user or a resume; active counts only gaps ≤ 180 s.
- `turns` = API calls of that agent across all its resumes. `TURN-LIMIT` = the harness stopped it.
- `NO-REPORT` = the agent never called SubagentHandback (its work was lost or relayed some other way).

## 3. Analyse — answer each, citing evidence (numbers, report quotes, `file:line`)
1. **Cost & shape.** Total and non-cache tokens; orchestrator share; the most expensive agent and
   why (turns × context size, big files, images re-read). Order of agents; what ran sequentially
   that could have run in parallel; idle gaps and their cause (waiting on the user, on a resume).
2. **Per agent — difficulties.** Turn-limit hits, tool errors, re-reads of the same file, NEEDS_CONTEXT /
   needs-input round-trips, rounds of a fix loop, a report that had to be chased.
3. **Per agent — what went easily.** Steps done in one pass, facts it already had in its prompt,
   reports the orchestrator relayed without rework. Keep these — they show what to preserve.
4. **Duplicated information.** Files read by several agents (from the script); facts the
   orchestrator already knew but each agent re-discovered; the same context pasted into several
   prompts; review findings repeated across rounds. For each: could it be passed once (in the
   delegation, a shared notes file, the spec itself)?
5. **Missed.** Things found late — by a reviewer, a later round, the user — that an earlier agent
   should have caught. Classify each: missing rule in the agent prompt · missing skill/checklist item ·
   missing context in the delegation · genuinely new information. Count how many review findings each
   class produced per round (e.g. round 1: 19 → round 2: 6 → round 3: 1).
6. **Handoffs.** Were delegation prompts complete (did the agent ask for something it should have
   been given)? Were reports the right size for the orchestrator to relay? Did the orchestrator
   paraphrase a decision in a way that changed it?
7. **User load.** How many questions reached the user, how many were answerable from code, how many
   were really one decision split in two.

## 4. Recommendations
Each one: **change** (exact file + what to add/remove) · **evidence** (from §3) · **expected effect**
(tokens, rounds or turns saved — an estimate, labelled as one). Prefer, in this order:
1. Add the missed rule/check to the agent that should have caught it (`.claude/agents/<name>.md`,
   or a skill it loads) — e.g. a checklist line the reviewer flagged in round 1.
2. Pass known context in the delegation instead of letting each agent re-read it.
3. Adjust limits/shape: turn budget, splitting one agent into two, parallel vs sequential, fewer resume rounds.
4. Orchestrator habits worth keeping or dropping.
Mark each as `apply now` / `try next run` / `watch`. Then ask the user which to apply.

## 5. Write the report
```
# Retro · <workflow> · <date>
Session <id> · window <start → end> · <N> agents · <tokens total> (<non-cache>) · <active>/<wall>
## Numbers            (agents table from the script, trimmed; totals; timeline in 5–15 lines)
## What went well
## Difficulties       (per agent)
## Duplication
## Missed / late findings   (with class and round)
## Recommendations    (change · evidence · effect · apply now/try/watch)
## Open questions
```
Keep it under ~150 lines; link to the per-agent files only if the user wants them kept
(they live in the scratchpad by default). Tell the user in a few lines: totals, top 3 findings,
top 3 recommendations, the report path.

## 6. Durable lessons
A lesson about the code itself → `engineering-insights` skill (module `INSIGHTS.md`). A lesson
about how agents/workflows should run → it belongs in the recommendation list, not in INSIGHTS.md;
ask before promoting anything into CLAUDE.md.
