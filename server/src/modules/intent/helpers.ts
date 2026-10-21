import { createHash } from 'node:crypto';
import type { Intent, IntentSource, PrIntentRecord, RepoRef, UnresolvedRef } from '@devdigest/shared';
import type { IntentRecord } from './ports.js';
import {
  MAX_COMMIT_LINE_CHARS,
  NOT_JIRA_PREFIXES,
  SPEC_EXTENSIONS,
  TRUNCATION_MARK,
} from './constants.js';

/** Pure helpers: reference extraction, truncation, hashing, rendering. No I/O. */

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Cut to `max` chars and mark it; `truncated` tells the UI. */
export function truncate(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max) + TRUNCATION_MARK, truncated: true };
}

/** Read model → wire contract (legacy null `headSha` → '', Date → ISO). */
export function toPrIntentRecordDto(r: IntentRecord): PrIntentRecord {
  return {
    pr_id: r.prId,
    intent: r.intent,
    in_scope: r.inScope,
    out_of_scope: r.outOfScope,
    risk_areas: r.riskAreas,
    confidence: r.confidence,
    basis: r.basis,
    sources: r.sources,
    unresolved_refs: r.unresolvedRefs,
    head_sha: r.headSha ?? '',
    model: r.model,
    cost_usd: r.costUsd,
    updated_at: r.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------- refs

export interface ExtractedRefs {
  /** Same-repo issue numbers, strongest signal first (closing keywords → bare #N → branch). */
  issues: number[];
  /** Normalized repo-root-relative spec paths to read at head. */
  specs: string[];
  /** Found but never fetched/read (Jira, Linear, other repo, unsafe path …). */
  unresolved: UnresolvedRef[];
}

const HTML_COMMENT = /<!--[\s\S]*?-->/g;
const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b:?[ \t]+(?:([\w.-]+)\/([\w.-]+))?#(\d{1,7})\b/gi;
const CROSS_REPO = /(?<![\w./-])([\w.-]+)\/([\w.-]+)#(\d{1,7})\b/g;
const BARE = /(?<![\w/&#])#(\d{1,7})\b/g;
const BRANCH_NUMBER = /(?:^|\/)(\d+)[-_]/;
const JIRA = /\b([A-Z][A-Z0-9]{1,9})-(\d+)\b/g;
const LINEAR_URL = /https?:\/\/(?:www\.)?linear\.app\/[^\s)>\]"']+/gi;
const MD_LINK = /(!?)\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)/g;
const BARE_URL = /https?:\/\/[^\s)>\]"']+/g;
const BLOB_URL = /^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/;

type PathCheck = { ok: true; path: string } | { ok: false; reason: string };

/** Normalize a repo-relative path; refuses traversal out of the root, absolute paths, NUL/backslash. */
function checkPath(raw: string): PathCheck {
  if (raw.includes('\0') || raw.includes('\\')) return { ok: false, reason: 'unsafe path — not read' };
  if (raw.startsWith('/')) return { ok: false, reason: 'absolute path — not read' };
  const out: string[] = [];
  for (const seg of raw.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.pop() === undefined) return { ok: false, reason: 'path escapes the repository root — not read' };
      continue;
    }
    out.push(seg);
  }
  if (out.length === 0) return { ok: false, reason: 'empty path — not read' };
  return { ok: true, path: out.join('/') };
}

function extensionOf(path: string): string {
  const last = path.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(dot).toLowerCase() : '';
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export function extractRefs(input: { body: string | null | undefined; branch: string; repo: RepoRef }): ExtractedRefs {
  const body = (input.body ?? '').replace(HTML_COMMENT, '');
  const self = `${input.repo.owner}/${input.repo.name}`.toLowerCase();

  const issues: number[] = [];
  const unresolved: UnresolvedRef[] = [];
  const seenUnresolved = new Set<string>();
  const addUnresolved = (ref: string, reason: string): void => {
    if (seenUnresolved.has(ref)) return;
    seenUnresolved.add(ref);
    unresolved.push({ ref, reason });
  };
  const addIssue = (owner: string | undefined, name: string | undefined, n: number): void => {
    if (owner && name && `${owner}/${name}`.toLowerCase() !== self) {
      addUnresolved(`${owner}/${name}#${n}`, 'issue in another repository — not fetched');
      return;
    }
    if (!issues.includes(n)) issues.push(n);
  };

  // issues: closing keywords → cross-repo refs → bare #N → branch number
  for (const m of body.matchAll(CLOSING)) addIssue(m[1], m[2], Number(m[3]));
  for (const m of body.matchAll(CROSS_REPO)) addIssue(m[1], m[2], Number(m[3]));
  for (const m of body.matchAll(BARE)) addIssue(undefined, undefined, Number(m[1]));
  const branchNum = BRANCH_NUMBER.exec(input.branch);
  if (branchNum) addIssue(undefined, undefined, Number(branchNum[1]));

  // external trackers — recognised only, never fetched
  const text = `${body}\n${input.branch}`;
  for (const m of text.matchAll(LINEAR_URL)) addUnresolved(m[0], 'Linear — not fetched');
  const withoutLinear = text.replace(LINEAR_URL, ' ');
  for (const m of withoutLinear.matchAll(JIRA)) {
    if (!NOT_JIRA_PREFIXES.has(m[1]!)) addUnresolved(m[0], 'Jira — not fetched');
  }

  // spec / plan links
  const specs: string[] = [];
  const seenTargets = new Set<string>();
  const addSpec = (p: string): void => {
    if (!specs.includes(p)) specs.push(p);
  };

  const handle = (rawTarget: string, fromBlob: boolean, label: string): void => {
    const check = checkPath(safeDecode(rawTarget));
    if (!check.ok) return addUnresolved(label, check.reason);
    const ext = extensionOf(check.path);
    if (SPEC_EXTENSIONS.includes(ext)) return addSpec(check.path);
    // a plain relative link without an extension is just prose navigation
    if (ext !== '' || fromBlob) addUnresolved(label, `unsupported file type${ext ? ` (${ext})` : ''} — not read`);
  };

  const visit = (target: string): void => {
    const clean = target.split('#')[0]!.split('?')[0]!;
    if (!clean || seenTargets.has(target)) return;
    seenTargets.add(target);

    if (/^https?:\/\//i.test(clean)) {
      let url: URL;
      try {
        url = new URL(clean);
      } catch {
        return;
      }
      if (!/^(www\.)?github\.com$/i.test(url.hostname)) return;
      const m = BLOB_URL.exec(url.pathname);
      if (!m) return;
      if (`${m[1]}/${m[2]}`.toLowerCase() !== self) {
        return addUnresolved(target, 'link to another repository — not read');
      }
      return handle(m[4]!, true, target);
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) return; // mailto:, javascript:, …
    handle(clean, false, target);
  };

  for (const m of body.matchAll(MD_LINK)) {
    if (m[1] === '!') continue; // image
    visit(m[2]!);
  }
  for (const m of body.matchAll(BARE_URL)) {
    if (/^https?:\/\/(?:www\.)?linear\.app\//i.test(m[0])) continue;
    visit(m[0]);
  }

  return { issues, specs, unresolved };
}

// ---------------------------------------------------------------- hashing

export interface HashInput {
  headSha: string;
  title: string;
  body: string | null;
  sources: { ref: string; content: string }[];
}

/** `sha256(head_sha, title, body, each source ref + sha256(content))`. */
export function computeInputHash(i: HashInput): string {
  return sha256(
    JSON.stringify([i.headSha, i.title, i.body ?? '', i.sources.map((s) => [s.ref, sha256(s.content)])]),
  );
}

// ---------------------------------------------------------------- prompt text

export function formatDescription(title: string, body: string | null): string {
  return body && body.trim() ? `Title: ${title}\n\n${body}` : `Title: ${title}\n\n(no description)`;
}

export function formatSignals(input: {
  branch: string;
  commits: string[];
  files: { path: string; additions: number; deletions: number }[];
}): string {
  const commits = input.commits.map((c) => `- ${c.split('\n')[0]!.slice(0, MAX_COMMIT_LINE_CHARS)}`);
  const files = input.files.map((f) => `${f.path} +${f.additions}/-${f.deletions}`);
  return [
    `Branch: ${input.branch}`,
    `Commits (${commits.length}):`,
    ...(commits.length ? commits : ['(none)']),
    `Changed files (${files.length}):`,
    ...(files.length ? files : ['(none)']),
  ].join('\n');
}

/** Prompt label of a source — the `<untrusted source="…">` attribute. */
export function sourceLabel(s: Pick<IntentSource, 'kind' | 'ref'>): string {
  if (s.kind === 'spec') return `spec:${s.ref}`;
  if (s.kind === 'ticket') return `issue:${s.ref}`;
  return s.ref;
}

/** Short human form for logs / the review prompt: `spec specs/x.md (truncated)`. */
export function describeSource(s: IntentSource): string {
  const name = s.kind === 'spec' ? `spec ${s.ref}` : s.kind === 'ticket' ? `issue ${s.ref}` : s.kind;
  return s.truncated ? `${name} (truncated)` : name;
}

/** Plain-text intent for `ReviewInput.intent` (reviewer-core wraps it as untrusted). */
export function renderIntentForPrompt(i: Intent): string {
  const list = (items: string[]): string[] => (items.length ? items.map((x) => `- ${x}`) : ['- (none stated)']);
  return [
    `Intent: ${i.intent}`,
    `Confidence: ${i.confidence} (basis: ${i.basis})`,
    'In scope:',
    ...list(i.in_scope),
    'Out of scope:',
    ...list(i.out_of_scope),
    'Risk areas:',
    ...(i.risk_areas.length ? i.risk_areas.map((r) => `- ${r.label} [${r.kind}]`) : ['- (none stated)']),
    `Derived from: ${i.sources.length ? i.sources.map(describeSource).join(' · ') : 'n/a'}`,
  ].join('\n');
}

/** Race `p` against a timer; the timer is always cleared. */
export async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
