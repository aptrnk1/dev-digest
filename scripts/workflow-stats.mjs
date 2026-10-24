#!/usr/bin/env node
// Collect hard numbers about a multi-agent run in a Claude Code session, for
// the `workflow-retro` skill. Reads only local transcripts:
//   ~/.claude/projects/<project>/<session>.jsonl                 orchestrator
//   ~/.claude/projects/<project>/<session>/subagents/agent-<id>.jsonl (+ .meta.json)
//
//   node scripts/workflow-stats.mjs [--session <id>] [--since <ISO>] [--until <ISO>] [--json] [--reports <dir>]
//
//   --session  transcript to read (default: $CLAUDE_CODE_SESSION_ID)
//   --since    ignore records before this timestamp (scope one workflow in a long session)
//   --until    ignore records after this timestamp
//   --json     print raw JSON instead of Markdown
//   --reports  also write each agent's conversation (orchestrator prompts + handbacks) to <dir>/<agentId>.md
//
// Tokens: an API response can be split over several transcript records with the
// same message.id — usage is counted once per id (max over its records). "in" = uncached input,
// "cache_r"/"cache_w" = cache read/write, "out" = output. Costs are not computed
// (pricing varies by model/plan) — multiply yourself if needed.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const args = process.argv.slice(2);
let session = process.env.CLAUDE_CODE_SESSION_ID;
let since = null;
let until = null;
let asJson = false;
let reportsDir = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--session") session = args[++i];
  else if (args[i] === "--since") since = args[++i];
  else if (args[i] === "--until") until = args[++i];
  else if (args[i] === "--json") asJson = true;
  else if (args[i] === "--reports") reportsDir = args[++i];
  else { console.error(`workflow-stats: unknown argument ${args[i]}`); process.exit(2); }
}
if (!session) { console.error("workflow-stats: no --session and $CLAUDE_CODE_SESSION_ID is unset"); process.exit(2); }

const projects = join(homedir(), ".claude", "projects");
const projectDir = existsSync(projects)
  ? readdirSync(projects).map((d) => join(projects, d)).find((d) => existsSync(join(d, `${session}.jsonl`)))
  : undefined;
if (!projectDir) { console.error(`workflow-stats: transcript for session ${session} not found under ${projects}`); process.exit(1); }

const readJsonl = (file) =>
  readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
const inScope = (o) => !o.timestamp || ((!since || o.timestamp >= since) && (!until || o.timestamp <= until));
const blocks = (o) => (Array.isArray(o.message?.content) ? o.message.content : []);

const ACTIVE_GAP_S = 180;

/** Aggregate one transcript: tokens, turns, tools, errors, reads, handbacks. */
function analyse(records) {
  const usageById = new Map();
  const tools = {};
  const reads = [];
  const handbacks = [];
  let errors = 0, first = null, last = null, activeS = 0;
  for (const o of records) {
    if (!inScope(o)) continue;
    if (o.timestamp) {
      // active time: gaps > ACTIVE_GAP_S are idle (waiting for a resume / the user)
      if (last) { const g = (Date.parse(o.timestamp) - Date.parse(last)) / 1000; if (g > 0 && g <= ACTIVE_GAP_S) activeS += g; }
      first ??= o.timestamp; last = o.timestamp;
    }
    if (o.type === "assistant") {
      // Split records of one response repeat usage; output_tokens grows, the
      // last record holds the final value — keep the max per message id.
      const id = o.message?.id ?? o.uuid;
      const u = o.message?.usage ?? {};
      const prev = usageById.get(id);
      usageById.set(id, {
        in: Math.max(prev?.in ?? 0, u.input_tokens ?? 0),
        cache_r: Math.max(prev?.cache_r ?? 0, u.cache_read_input_tokens ?? 0),
        cache_w: Math.max(prev?.cache_w ?? 0, u.cache_creation_input_tokens ?? 0),
        out: Math.max(prev?.out ?? 0, u.output_tokens ?? 0),
      });
      for (const b of blocks(o)) {
        if (b.type !== "tool_use") continue;
        tools[b.name] = (tools[b.name] ?? 0) + 1;
        if (b.name === "Read" && b.input?.file_path) reads.push(b.input.file_path);
        if (b.name === "SubagentHandback") handbacks.push({ at: o.timestamp, text: String(b.input?.message ?? "") });
      }
    } else if (o.type === "user") {
      for (const b of blocks(o)) if (b.type === "tool_result" && b.is_error) errors++;
    }
  }
  const tok = { in: 0, cache_r: 0, cache_w: 0, out: 0 };
  for (const u of usageById.values()) for (const key of Object.keys(tok)) tok[key] += u[key];
  const turns = usageById.size;
  return { tok, turns, tools, errors, reads, handbacks, first, last, activeS: Math.round(activeS) };
}

const durationS = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 1000) : null);
const total = (t) => t.in + t.cache_r + t.cache_w + t.out;

// ---- orchestrator ----
const mainRecords = readJsonl(join(projectDir, `${session}.jsonl`));
const main = analyse(mainRecords);

// Timeline of delegations: Agent spawns, SendMessage resumes, Workflow runs, user turns.
const timeline = [];
const spawnByToolUse = {};
for (const o of mainRecords) {
  if (!inScope(o)) continue;
  if (o.type === "assistant") {
    for (const b of blocks(o)) {
      if (b.type !== "tool_use") continue;
      if (b.name === "Agent")
        spawnByToolUse[b.id] = timeline.push({ at: o.timestamp, kind: "spawn", type: b.input?.subagent_type ?? "general-purpose", desc: b.input?.description ?? "", promptChars: (b.input?.prompt ?? "").length, prompt: b.input?.prompt ?? "", toolUseId: b.id }) - 1;
      else if (b.name === "SendMessage")
        timeline.push({ at: o.timestamp, kind: "resume", to: b.input?.to, desc: b.input?.summary ?? "", promptChars: (b.input?.message ?? "").length, prompt: String(b.input?.message ?? "") });
      else if (b.name === "Workflow")
        timeline.push({ at: o.timestamp, kind: "workflow", desc: b.input?.name ?? "inline script" });
      else if (b.name === "AskUserQuestion")
        timeline.push({ at: o.timestamp, kind: "ask-user", desc: `${b.input?.questions?.length ?? 0} question(s)` });
    }
  } else if (o.type === "user" && !o.isMeta && typeof o.message?.content === "string" && !o.message.content.startsWith("<")) {
    timeline.push({ at: o.timestamp, kind: "user", desc: o.message.content.slice(0, 80).replace(/\s+/g, " ") });
  }
}
// Turn-limit / failure notifications in the orchestrator transcript.
const raw = readFileSync(join(projectDir, `${session}.jsonl`), "utf8");
const notes = {};
for (const m of raw.matchAll(/<task-id>([a-z0-9]+)<\/task-id>[\s\S]{0,400}?<summary>([^<]*)<\/summary>/g)) {
  (notes[m[1]] ??= []).push(m[2]);
}

// ---- subagents ----
const subDir = join(projectDir, session, "subagents");
const agents = [];
if (existsSync(subDir)) {
  for (const f of readdirSync(subDir).filter((f) => /^agent-.*\.jsonl$/.test(f))) {
    const id = basename(f, ".jsonl").replace(/^agent-/, "");
    const metaPath = join(subDir, `agent-${id}.meta.json`);
    const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {};
    const a = analyse(readJsonl(join(subDir, f)));
    if (!a.first) continue; // nothing in scope
    const resumes = timeline.filter((e) => e.kind === "resume" && e.to && (e.to === id || id.startsWith(e.to))).length;
    const summaries = notes[id] ?? [];
    agents.push({
      id, type: meta.agentType ?? "?", desc: meta.description ?? "", depth: meta.spawnDepth ?? 1,
      spawnIdx: meta.toolUseId != null ? spawnByToolUse[meta.toolUseId] ?? null : null,
      start: a.first, end: a.last, durationS: durationS(a.first, a.last), activeS: a.activeS,
      turns: a.turns, tok: a.tok, tools: a.tools, errors: a.errors,
      reads: a.reads.length, uniqueReads: new Set(a.reads).size, readPaths: a.reads,
      resumes, handbacks: a.handbacks.length,
      hitTurnLimit: summaries.some((s) => /turn limit/i.test(s)),
      failed: summaries.some((s) => /failed|error|killed/i.test(s)),
      reports: a.handbacks,
    });
    for (const e of timeline) if (e.kind === "spawn" && e.toolUseId === meta.toolUseId) e.agentId = id;
  }
}
agents.sort((x, y) => x.start.localeCompare(y.start));

// Files read by more than one agent (incl. orchestrator) and re-reads within one agent.
const readers = {};
const addReads = (who, paths) => { for (const p of new Set(paths)) (readers[p] ??= []).push(who); };
addReads("orchestrator", main.reads);
for (const a of agents) addReads(`${a.type}#${a.id.slice(0, 6)}`, a.readPaths);
const sharedReads = Object.entries(readers).filter(([, w]) => w.length > 1).sort((a, b) => b[1].length - a[1].length);
const reReads = agents.flatMap((a) => {
  const c = {};
  for (const p of a.readPaths) c[p] = (c[p] ?? 0) + 1;
  return Object.entries(c).filter(([, n]) => n > 2).map(([p, n]) => ({ agent: `${a.type}#${a.id.slice(0, 6)}`, path: p, n }));
});

const sumTok = agents.reduce((s, a) => ({ in: s.in + a.tok.in, cache_r: s.cache_r + a.tok.cache_r, cache_w: s.cache_w + a.tok.cache_w, out: s.out + a.tok.out }), { in: 0, cache_r: 0, cache_w: 0, out: 0 });
const result = {
  session, since, until, projectDir,
  window: { start: main.first, end: main.last, durationS: durationS(main.first, main.last) },
  orchestrator: { turns: main.turns, tok: main.tok, tools: main.tools, errors: main.errors },
  agents: agents.map(({ readPaths, reports, ...a }) => a),
  totals: { agents: agents.length, spawns: timeline.filter((e) => e.kind === "spawn").length, resumes: timeline.filter((e) => e.kind === "resume").length, userTurns: timeline.filter((e) => e.kind === "user").length, askUser: timeline.filter((e) => e.kind === "ask-user").length, tokSubagents: sumTok, tokAll: { ...sumTok, in: sumTok.in + main.tok.in, cache_r: sumTok.cache_r + main.tok.cache_r, cache_w: sumTok.cache_w + main.tok.cache_w, out: sumTok.out + main.tok.out } },
  timeline: timeline.map(({ toolUseId, prompt, ...e }) => e),
  sharedReads: sharedReads.map(([path, who]) => ({ path, who })),
  reReads,
};

if (reportsDir) {
  mkdirSync(reportsDir, { recursive: true });
  // One file per agent: every orchestrator → agent message and every handback, in time order.
  for (const a of agents) {
    const inbound = timeline
      .filter((e) => (e.kind === "spawn" && e.agentId === a.id) || (e.kind === "resume" && e.to && (e.to === a.id || a.id.startsWith(e.to))))
      .map((e) => ({ at: e.at, head: e.kind === "spawn" ? "Orchestrator → spawn prompt" : `Orchestrator → resume: ${e.desc}`, text: e.prompt }));
    const outbound = a.reports.map((r) => ({ at: r.at, head: "Agent → handback", text: r.text }));
    const items = [...inbound, ...outbound].sort((x, y) => String(x.at).localeCompare(String(y.at)));
    writeFileSync(join(reportsDir, `${a.id}.md`), `# ${a.type} — ${a.desc}\n\n` + items.map((m) => `## ${m.head} · ${m.at}\n\n${m.text}\n`).join("\n"));
  }
}

if (asJson) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }

// ---- Markdown ----
const k = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const tk = (t) => `${k(total(t))} (in ${k(t.in)} · cache_r ${k(t.cache_r)} · cache_w ${k(t.cache_w)} · out ${k(t.out)})`;
const dur = (s) => (s == null ? "?" : s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`);
const hm = (iso) => (iso ? iso.slice(11, 19) : "?");
const out = [];
out.push(`# Workflow stats · session ${session}${since ? ` · since ${since}` : ""}${until ? ` · until ${until}` : ""}`);
out.push(`Window: ${main.first} → ${main.last} (${dur(result.window.durationS)} wall, ${dur(main.activeS)} orchestrator active; gaps > ${ACTIVE_GAP_S}s count as idle)`);
out.push("");
out.push(`## Totals`);
out.push(`- Agents: ${agents.length} · spawns ${result.totals.spawns} · resumes (SendMessage) ${result.totals.resumes} · user turns ${result.totals.userTurns} · AskUserQuestion ${result.totals.askUser}`);
out.push(`- Tokens, all: ${tk(result.totals.tokAll)}`);
out.push(`- Tokens, orchestrator: ${tk(main.tok)} · turns ${main.turns}`);
out.push(`- Tokens, subagents: ${tk(sumTok)}`);
out.push("");
out.push(`## Agents (by start)`);
out.push(`| # | agent | type | task | active / wall | turns | tokens | out | tools | err | reads (uniq) | resumes | handbacks | flags |`);
out.push(`|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
agents.forEach((a, i) => {
  const tools = Object.entries(a.tools).sort((x, y) => y[1] - x[1]).map(([n, c]) => `${n}:${c}`).join(" ");
  const flags = [a.hitTurnLimit && "TURN-LIMIT", a.failed && "FAILED", a.depth > 1 && `depth ${a.depth}`, a.handbacks === 0 && "NO-REPORT"].filter(Boolean).join(" ");
  out.push(`| ${i + 1} | ${a.id.slice(0, 8)} | ${a.type} | ${a.desc} | ${dur(a.activeS)} / ${dur(a.durationS)} | ${a.turns} | ${k(total(a.tok))} | ${k(a.tok.out)} | ${tools} | ${a.errors} | ${a.reads} (${a.uniqueReads}) | ${a.resumes} | ${a.handbacks} | ${flags} |`);
});
out.push("");
out.push(`## Timeline`);
for (const e of timeline) {
  const who = e.kind === "spawn" ? `spawn **${e.type}**${e.agentId ? ` (${e.agentId.slice(0, 8)})` : ""}` : e.kind === "resume" ? `resume → ${String(e.to).slice(0, 8)}` : e.kind;
  out.push(`- ${hm(e.at)} · ${who} — ${e.desc}${e.promptChars ? ` · prompt ${e.promptChars} chars` : ""}`);
}
out.push("");
out.push(`## Duplicated reads (same file read by >1 agent)`);
if (sharedReads.length === 0) out.push("- none");
for (const [p, who] of sharedReads.slice(0, 25)) out.push(`- ${p} — ${who.join(", ")}`);
if (sharedReads.length > 25) out.push(`- … ${sharedReads.length - 25} more (use --json)`);
out.push("");
out.push(`## Re-reads (same agent read a file >2×)`);
if (reReads.length === 0) out.push("- none");
for (const r of reReads) out.push(`- ${r.agent}: ${r.path} ×${r.n}`);
console.log(out.join("\n"));
