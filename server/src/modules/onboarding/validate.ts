import type { OnboardingTour } from '@devdigest/shared';
import {
  MAX_COMMAND,
  MAX_CRITICAL_PATHS,
  MAX_DESCRIPTION,
  MAX_EDGES,
  MAX_FIRST_TASKS,
  MAX_FIRST_TASK_FILES,
  MAX_NODE_LABEL,
  MAX_NODES,
  MAX_READING_PATH,
  MAX_RUN_STEPS,
  MAX_SUMMARY,
  MAX_TASK_TITLE,
} from './constants.js';
import { isSafeRelativePath } from './domain.js';
import type { OnboardingTourDraft } from './prompt.js';

export type TourBody = Omit<
  OnboardingTour,
  'commit_sha' | 'generated_at' | 'files_indexed' | 'index_status'
>;

export interface SanitizeDeps {
  exists: (path: string) => Promise<boolean>;
  contentPaths: ReadonlySet<string>;
}

/** Length <= max; a cut text ends with «…». */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, Math.max(0, max - 1)) + '…';
}

/** Whitelist (AC66): anything outside A-Z a-z 0-9 space . _ / * @ : - becomes `_`. */
export function sanitizeLabel(label: string): string {
  const s = truncate(label.replace(/[^A-Za-z0-9 ._/*@:-]/g, '_').trim(), MAX_NODE_LABEL);
  return s === '' ? '_' : s;
}

function dedupe<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = key(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Order matters: drop invalid -> dedupe -> count caps from the end -> truncate texts.
 */
export async function sanitizeDraft(
  draft: OnboardingTourDraft,
  deps: SanitizeDeps,
): Promise<TourBody> {
  const cache = new Map<string, Promise<boolean>>();
  const valid = (p: string): Promise<boolean> => {
    if (!isSafeRelativePath(p)) return Promise.resolve(false);
    let r = cache.get(p);
    if (!r) {
      r = deps.exists(p).catch(() => false);
      cache.set(p, r);
    }
    return r;
  };
  const filterAsync = async <T>(items: T[], pred: (t: T) => Promise<boolean>): Promise<T[]> => {
    const flags = await Promise.all(items.map(pred));
    return items.filter((_, i) => flags[i]);
  };

  const keyed = dedupe(draft.diagram.nodes, (n) => n.key).slice(0, MAX_NODES);
  const nodeOk = await Promise.all(keyed.map((n) => (n.path === null ? false : valid(n.path))));
  const idByKey = new Map<string, string>();
  const nodes = keyed.map((n, i) => {
    const id = `n${i + 1}`;
    idByKey.set(n.key, id);
    return {
      id,
      label: sanitizeLabel(n.label),
      kind: n.kind,
      path: n.path !== null && nodeOk[i] ? n.path : null,
    };
  });
  const edges = dedupe(
    draft.diagram.edges.flatMap((e) => {
      const from = idByKey.get(e.from);
      const to = idByKey.get(e.to);
      return from && to ? [{ from, to }] : [];
    }),
    (e) => `${e.from}>${e.to}`,
  ).slice(0, MAX_EDGES);

  const critical_paths = dedupe(
    await filterAsync(draft.critical_paths, (c) => valid(c.path)),
    (c) => c.path,
  )
    .slice(0, MAX_CRITICAL_PATHS)
    .map((c) => ({ path: c.path, description: truncate(c.description, MAX_DESCRIPTION) }));

  const reading_path = dedupe(
    await filterAsync(draft.reading_path, (c) => valid(c.path)),
    (c) => c.path,
  )
    .slice(0, MAX_READING_PATH)
    .map((c) => ({ path: c.path, why: truncate(c.why, MAX_DESCRIPTION) }));

  const steps = draft.run_steps.filter(
    (s) => s.command.length <= MAX_COMMAND && deps.contentPaths.has(s.source_path),
  );
  const run_steps = dedupe(await filterAsync(steps, (s) => valid(s.source_path)), (s) => s.command)
    .slice(0, MAX_RUN_STEPS)
    .map((s) => ({ command: s.command, source_path: s.source_path }));

  const withFiles = await Promise.all(
    draft.first_tasks.map(async (t) => ({
      t,
      files: dedupe(await filterAsync(t.files, valid), (f) => f).slice(0, MAX_FIRST_TASK_FILES),
    })),
  );
  const first_tasks = dedupe(
    withFiles
      .filter((x) => x.files.length > 0)
      .map(({ t, files }) => ({
        title: truncate(t.title, MAX_TASK_TITLE),
        description: truncate(t.description, MAX_DESCRIPTION),
        size: t.size,
        files,
      })),
    (x) => x.title,
  ).slice(0, MAX_FIRST_TASKS);

  return {
    architecture: { summary: truncate(draft.summary, MAX_SUMMARY), diagram: { nodes, edges } },
    critical_paths,
    run_steps,
    reading_path,
    first_tasks,
  };
}
