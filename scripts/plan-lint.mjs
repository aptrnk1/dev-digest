#!/usr/bin/env node
// Deterministic checks for an implementation plan (specs/plans/<feature>.md,
// format of specs/plans/_template.md). Run before the plan goes to the user:
//
//   node scripts/plan-lint.mjs specs/plans/<feature>.md
//
// ERROR (exit 1): parallel tasks of one wave own the same file, a spec AC /
// inline R# is covered by no task, a task cites an unknown AC/R, a Skills name
// does not exist, Depends on points to an unknown or not-earlier task, a task
// lacks Owns / Acceptance / Verify, the header lacks Status.
// WARN: AC verification hint not carried into Acceptance or not matched by the
// task's lane, [manual] AC without a "Manual check" line in Risks, Verify not
// via scripts/check.sh, missing tag / Skills / Progress row / Execution mode.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const planPath = process.argv[2];
if (!planPath) {
  console.error("usage: node scripts/plan-lint.mjs specs/plans/<feature>.md");
  process.exit(2);
}
const abs = resolve(process.cwd(), planPath);
if (!existsSync(abs)) {
  console.error(`plan-lint: no such file ${planPath}`);
  process.exit(2);
}
const text = readFileSync(abs, "utf8");
const lines = text.split("\n");

const errors = [];
const warns = [];
const err = (where, msg) => errors.push(`ERROR ${where}: ${msg}`);
const warn = (where, msg) => warns.push(`WARN  ${where}: ${msg}`);

// ---------- header ----------
const header = lines.find((l) => /^Spec:/.test(l)) ?? "";
if (!/Status:\s*\S/.test(header)) err("header", "no `Status:` in the `Spec: … · Status: …` line");
if (!/Execution mode:/.test(header)) warn("header", "no `Execution mode:` (multi-agent | single-agent)");

// ---------- sections ----------
function section(name) {
  const start = lines.findIndex((l) => new RegExp(`^## ${name}`).test(l));
  if (start < 0) return "";
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join("\n");
}
const risks = section("Risks");
const goal = section("Goal");

// ---------- requirements ----------
// requirement id → { hint, removed }
const reqs = new Map();
let reqSource = "none";
const specRef = /Spec:\s*`([^`]+\.md)`/.exec(header)?.[1];
if (specRef) {
  const specAbs = join(root, specRef);
  if (!existsSync(specAbs)) {
    err("header", `spec ${specRef} not found`);
  } else {
    reqSource = specRef;
    for (const l of readFileSync(specAbs, "utf8").split("\n")) {
      const m = /\*\*(AC\d+)\*\*/.exec(l);
      if (!m) continue;
      const hint = /`\[(unit|it|e2e|manual)\]`/.exec(l)?.[1] ?? null;
      reqs.set(m[1], { hint, removed: /\(removed\)/.test(l) });
    }
  }
}
if (reqs.size === 0) {
  for (const m of section("Requirements").matchAll(/\*\*(R\d+)\*\*/g)) {
    reqs.set(m[1], { hint: null, removed: false });
    reqSource = "inline";
  }
}

// "AC1–AC3", "AC1-3", "R2, R3" → ids
function refs(s) {
  const out = new Set();
  for (const m of s.matchAll(/\b(AC|R)(\d+)\s*[–-]\s*(?:AC|R)?(\d+)\b/g)) {
    for (let i = Number(m[2]); i <= Number(m[3]); i++) out.add(`${m[1]}${i}`);
  }
  for (const m of s.matchAll(/\b(AC|R)(\d+)\b/g)) out.add(`${m[1]}${m[2]}`);
  return out;
}

// ---------- tasks ----------
const FIELD = /^(Owns|Depends on|Skills|Route|Interfaces|Steps|Acceptance|Verify|Escalate if|Frontmatter):/;
const tasks = [];
let wave = null;
let cur = null;
for (const l of lines) {
  const w = /^## Wave (\d+)/.exec(l);
  if (w) { wave = Number(w[1]); cur = null; continue; }
  if (/^## /.test(l)) { cur = null; wave = /^## Wave/.test(l) ? wave : null; continue; }
  const t = /^### (T\d+)\b(.*)$/.exec(l);
  if (t && wave !== null) {
    cur = { id: t[1], title: t[2], wave, parallel: /\[P\]/.test(t[2]), tag: /\[(SHARED|BE|FE)\]/.exec(t[2])?.[1], fields: {}, field: null };
    tasks.push(cur);
    continue;
  }
  if (!cur) continue;
  const f = FIELD.exec(l);
  if (f) {
    cur.field = f[1];
    cur.fields[f[1]] = l.slice(f[0].length).trim();
  } else if (cur.field) {
    cur.fields[cur.field] += `\n${l}`;
  }
}
if (tasks.length === 0) err("plan", "no tasks found (`## Wave N` + `### T<n> …`)");

const byId = new Map(tasks.map((t, i) => [t.id, { ...t, index: i }]));

// ---------- per task ----------
const skillsDir = join(root, ".claude/skills");
const covered = new Map(); // req id → [task ids]
for (const t of tasks) {
  const where = t.id;
  for (const f of ["Owns", "Acceptance", "Verify"]) {
    if (!t.fields[f]?.trim()) err(where, `missing \`${f}:\``);
  }
  if (!t.tag) warn(where, "no [SHARED|BE|FE] tag");

  if (t.fields.Skills === undefined) warn(where, "no `Skills:` (the implementer then guesses)");
  else {
    const names = t.fields.Skills.split("\n")[0].replace(/\(.*?\)/g, "").split(/[,·]/).map((s) => s.trim()).filter((s) => s && s !== "—" && s !== "-");
    for (const n of names) {
      if (!existsSync(join(skillsDir, n, "SKILL.md"))) err(where, `skill \`${n}\` does not exist in .claude/skills/`);
    }
    if (names.length > 3) warn(where, `${names.length} skills — the implementer loads all of them; keep ≤3`);
  }

  const deps = (t.fields["Depends on"] ?? "").match(/\bT\d+\b/g) ?? [];
  for (const d of deps) {
    const dep = byId.get(d);
    if (!dep) { err(where, `Depends on unknown task ${d}`); continue; }
    const earlier = dep.wave < t.wave || (dep.wave === t.wave && !t.parallel && dep.index < byId.get(t.id).index);
    if (!earlier) err(where, `Depends on ${d}, which is not in an earlier wave (or earlier in a sequential wave)`);
  }

  const verify = t.fields.Verify ?? "";
  const cmds = [...verify.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  for (const c of cmds) {
    if (/e2e:hermetic|db:generate|scripts\/check\.sh|plan-lint|^node |^git /.test(c)) continue;
    if (/vitest|pnpm (typecheck|test|arch)|npm (test|run)|tsc/.test(c)) warn(where, `Verify \`${c}\` — use scripts/check.sh`);
  }

  const acc = t.fields.Acceptance ?? "";
  for (const id of refs(acc)) {
    if (reqSource !== "none" && !reqs.has(id)) err(where, `Acceptance cites ${id}, which is not in ${reqSource === "inline" ? "the plan's ## Requirements" : reqSource}`);
    if (!covered.has(id)) covered.set(id, []);
    covered.get(id).push(t.id);
  }

  // lane hints
  for (const id of refs(acc)) {
    const hint = reqs.get(id)?.hint;
    if (!hint || hint === "manual") continue;
    const tagged = acc.split("\n").some((l) => new RegExp(`\\b${id}\\b`).test(l) && l.includes(`[${hint}]`));
    if (!tagged) warn(where, `${id} is [${hint}] in the spec but its Acceptance line does not carry [${hint}]`);
  }
}

// ---------- coverage ----------
for (const [id, r] of reqs) {
  if (r.removed) continue;
  const owners = covered.get(id);
  if (!owners) {
    // an exclusion requirement ("X stays out of scope") is covered by the Goal's "Not doing" line
    if (!new RegExp(`\\b${id}\\b`).test(goal)) err("coverage", `${id} is covered by no task's Acceptance (an exclusion requirement: cite ${id} in ## Goal's "Not doing" line)`);
    continue;
  }
  if (r.hint === "manual") {
    if (!new RegExp(`Manual check:[^\\n]*\\b${id}\\b`).test(risks)) warn("coverage", `${id} is [manual] but ## Risks has no "Manual check: ${id} — who / how"`);
    continue;
  }
  const owns = owners.map((o) => byId.get(o).fields.Owns ?? "").join(" ");
  const verify = owners.map((o) => byId.get(o).fields.Verify ?? "").join(" ");
  if (r.hint === "it" && !/\.it\.test\.ts|server\/test\/\*\*/.test(owns) && !/check\.sh server it/.test(verify)) {
    warn("coverage", `${id} is [it] but no covering task (${owners.join(", ")}) owns a *.it.test.ts or runs \`check.sh server it\``);
  }
  if (r.hint === "e2e" && !/e2e\/specs\//.test(owns)) {
    warn("coverage", `${id} is [e2e] but no covering task (${owners.join(", ")}) owns an e2e/specs flow`);
  }
}

// ---------- Owns overlap among [P] tasks of one wave ----------
function expandBraces(p) {
  const m = /\{([^{}]*)\}/.exec(p);
  if (!m) return [p];
  return m[1].split(",").flatMap((alt) => expandBraces(p.slice(0, m.index) + alt + p.slice(m.index + m[0].length)));
}
function patterns(owns) {
  return [...(owns ?? "").matchAll(/`([^`]+)`/g)].flatMap((m) => expandBraces(m[1].trim()));
}
const hasGlob = (p) => p.includes("*") || p.endsWith("/");
function toRegex(p) {
  const src = p.endsWith("/") ? `${p}**` : p;
  let re = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "*" && src[i + 1] === "*") { re += ".*"; i++; }
    else if (c === "*") re += "[^/]*";
    else re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}
const literalPrefix = (p) => p.split("*")[0];
function overlap(a, b) {
  if (a === b) return true;
  if (!hasGlob(a) && !hasGlob(b)) return false;
  if (hasGlob(a) && !hasGlob(b)) return toRegex(a).test(b);
  if (!hasGlob(a) && hasGlob(b)) return toRegex(b).test(a);
  const pa = literalPrefix(a), pb = literalPrefix(b);
  return pa.startsWith(pb) || pb.startsWith(pa);
}
const waves = [...new Set(tasks.map((t) => t.wave))];
for (const w of waves) {
  const par = tasks.filter((t) => t.wave === w && t.parallel);
  for (let i = 0; i < par.length; i++) {
    for (let j = i + 1; j < par.length; j++) {
      for (const a of patterns(par[i].fields.Owns)) {
        for (const b of patterns(par[j].fields.Owns)) {
          if (overlap(a, b)) err(`wave ${w}`, `${par[i].id} and ${par[j].id} both own \`${a === b ? a : `${a}\` ~ \`${b}`}\` — move it to wave 0 or one task`);
        }
      }
    }
  }
}

// ---------- Progress ----------
const progress = section("Progress");
for (const t of tasks) {
  if (!new RegExp(`^\\|\\s*${t.id}\\s*\\|`, "m").test(progress)) warn("progress", `no row for ${t.id}`);
}

// ---------- report ----------
for (const l of [...errors, ...warns]) console.log(l);
console.log(`plan-lint: ${tasks.length} tasks, ${reqs.size} requirements (${reqSource}) — ${errors.length} errors, ${warns.length} warnings`);
process.exit(errors.length ? 1 : 0);
