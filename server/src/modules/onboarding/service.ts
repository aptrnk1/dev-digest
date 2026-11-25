import { randomUUID } from 'node:crypto';
import { OnboardingTour } from '@devdigest/shared';
import type { ChatMessage, OnboardingJob, OnboardingTourResponse } from '@devdigest/shared';
import type {
  HeadReader,
  IndexSource,
  ModelHandle,
  OnboardingLogger,
  OnboardingStore,
  RepoBasics,
  RepoFiles,
  ResolveModel,
  TokenCounter,
} from './ports.js';
import type { OnboardingFacade } from './types.js';
import {
  DEADLINE_MS,
  LOCK_FILES,
  MANIFEST_FILES,
  MAX_HTTP_REQUESTS,
  MAX_INPUT_TOKENS,
  MAX_MANIFEST_CHARS,
  MAX_MANIFEST_LINES,
  MAX_README_CHARS,
  MAX_TOP_FILES,
  MAX_TOP_FILE_CHARS,
  MAX_TOP_FILE_LINES,
  MAX_TREE_PATHS,
  SCHEMA_NAME,
  STALE_RUN_MS,
  TREE_EXCLUDED_DIRS,
} from './constants.js';
import { GenerationAbort, OnboardingDomainError, isStaleRunning } from './domain.js';
import { classifyGenerationError, isRetryable } from './classify.js';
import {
  contentPaths,
  fitToBudget,
  isSecretPath,
  toTourIndexStatus,
  usesRankedInput,
  type InputFile,
  type ModelInput,
} from './input.js';
import { OnboardingTourDraft } from './prompt.js';
import { sanitizeDraft } from './validate.js';
import { toJobDto } from './helpers.js';

export interface OnboardingDeps {
  store: OnboardingStore;
  files: RepoFiles;
  index: IndexSource;
  head: HeadReader;
  tokens: TokenCounter;
  resolveModel: ResolveModel;
  loadSystemPrompt: () => Promise<string>;
  repoIntelEnabled: boolean;
  logger?: OnboardingLogger;
  now?: () => Date;
}

interface Run {
  repo: RepoBasics;
  clonePath: string;
  runId: string;
  deadlineAt: number;
  model: ModelHandle;
  /** Set when the wall-clock guard fired: no further provider requests. */
  expired: boolean;
}

const rank = (f: string): number => (f.toLowerCase() === 'readme.md' ? 0 : 1);

/**
 * Onboarding Tour use cases. POST validates synchronously (so 404 / 409 / 422
 * fail the request), writes the `running` row, then generates in the
 * background. Errors surface only as fixed texts (AC79); raw text is logged once.
 */
export class OnboardingService implements OnboardingFacade {
  constructor(private readonly deps: OnboardingDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  /** undefined = repo not found in the workspace. Never calls the provider. */
  async get(workspaceId: string, repoId: string): Promise<OnboardingTourResponse | undefined> {
    const repo = await this.deps.store.getRepo(workspaceId, repoId);
    if (!repo) return undefined;
    const state = await this.deps.store.getState(repoId);
    if (!state) return { job: null, tour: null };
    return { job: toJobDto(state.job, this.now()), tour: state.tour };
  }

  /** undefined = repo not found. */
  async generate(workspaceId: string, repoId: string): Promise<OnboardingJob | undefined> {
    const repo = await this.deps.store.getRepo(workspaceId, repoId);
    if (!repo) return undefined;

    if (!repo.clonePath || !(await this.deps.files.isClone(repo.clonePath))) {
      throw new OnboardingDomainError('repo_not_cloned', 'The repo is not cloned yet — sync it first');
    }
    const state = await this.deps.store.getState(repoId);
    if (state && state.job.status === 'running' && !isStaleRunning(state.job, this.now(), STALE_RUN_MS)) {
      throw new OnboardingDomainError('onboarding_in_progress', 'A tour is already being generated');
    }
    const model = await this.deps.resolveModel(workspaceId); // throws llm_not_configured

    const runId = randomUUID();
    const job = await this.deps.store.tryStart(repoId, runId, this.now(), STALE_RUN_MS);
    if (!job) {
      throw new OnboardingDomainError('onboarding_in_progress', 'A tour is already being generated');
    }

    const run: Run = {
      repo,
      clonePath: repo.clonePath,
      runId,
      deadlineAt: job.startedAt.getTime() + DEADLINE_MS,
      model,
      expired: false,
    };
    void this.execute(run).catch((err) => {
      this.deps.logger?.error({ repoId, err: (err as Error).message }, 'onboarding: background run crashed');
    });
    return toJobDto(job, this.now());
  }

  // ------------------------------------------------------------------ internals

  private remaining(run: Run): number {
    return run.deadlineAt - this.now().getTime();
  }

  private async execute(run: Run): Promise<void> {
    const repoId = run.repo.id;
    try {
      const built = await this.withDeadline(run, () => this.build(run));
      // One completion timestamp: the tour's generated_at equals the job's finished_at.
      const completedAt = this.now();
      const tour = OnboardingTour.parse({ ...built, generated_at: completedAt.toISOString() });
      const ok = await this.deps.store.complete(repoId, run.runId, tour, completedAt, STALE_RUN_MS);
      if (!ok) this.deps.logger?.info({ repoId, runId: run.runId }, 'onboarding: result discarded (run replaced or stale)');
    } catch (err) {
      const message = classifyGenerationError(err);
      this.deps.logger?.error(
        { repoId, error: message, raw: err instanceof Error ? err.message : String(err) },
        'onboarding: generation failed',
      );
      const ok = await this.deps.store.fail(repoId, run.runId, message, this.now(), STALE_RUN_MS);
      if (!ok) this.deps.logger?.info({ repoId, runId: run.runId }, 'onboarding: failure discarded (run replaced or stale)');
    }
  }

  /** Stops waiting at the deadline; the late work can't start new requests (`run.expired`). */
  private withDeadline<T>(run: Run, work: () => Promise<T>): Promise<T> {
    const ms = Math.max(0, this.remaining(run));
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        run.expired = true;
        reject(new GenerationAbort('deadline'));
      }, ms);
      work().then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }

  /** Everything but `generated_at`, which `execute` stamps at completion. */
  private async build(run: Run): Promise<Omit<OnboardingTour, 'generated_at'>> {
    const { repo, clonePath } = run;
    // Snapshot at start: HEAD and index state describe what the model saw.
    const commitSha = await this.deps.head.currentHead({ owner: repo.owner, name: repo.name });
    const state = await this.deps.index.getIndexState(repo.id);
    const idx = toTourIndexStatus(state, this.deps.repoIntelEnabled);

    const input = await this.gatherInput(run, usesRankedInput(idx.status));
    const systemPrompt = await this.deps.loadSystemPrompt();
    const fit = fitToBudget(input, systemPrompt, this.deps.tokens, MAX_INPUT_TOKENS);
    if (!fit.ok) throw new GenerationAbort('context_too_large');

    const draft = await this.callModel(run, fit.messages);
    const body = await sanitizeDraft(draft, {
      exists: (p) => this.deps.files.isRegularFileInside(clonePath, p),
      contentPaths: contentPaths(fit.input),
    });
    return {
      commit_sha: commitSha,
      files_indexed: idx.filesIndexed,
      index_status: idx.status,
      ...body,
    };
  }

  /** At most MAX_HTTP_REQUESTS provider requests; the only retry loop (providers get maxRetries 0). */
  private async callModel(run: Run, messages: ChatMessage[]): Promise<OnboardingTourDraft> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= MAX_HTTP_REQUESTS; attempt++) {
      const remaining = this.remaining(run);
      if (run.expired || remaining <= 0) throw new GenerationAbort('deadline');
      try {
        const provider = await run.model.provider(remaining);
        const res = await provider.completeStructured({
          model: run.model.model,
          schema: OnboardingTourDraft,
          schemaName: SCHEMA_NAME,
          messages,
          maxRetries: 0,
          timeoutMs: remaining,
        });
        return res.data;
      } catch (err) {
        lastErr = err;
        if (attempt >= MAX_HTTP_REQUESTS || !isRetryable(err)) throw err;
      }
    }
    throw lastErr;
  }

  private async gatherInput(run: Run, ranked: boolean): Promise<ModelInput> {
    const { files, index } = this.deps;
    const root = run.clonePath;
    const [tree, rootFiles] = await Promise.all([
      files.listTree(root, { limit: MAX_TREE_PATHS, excludeDirs: TREE_EXCLUDED_DIRS }),
      files.listRootFiles(root),
    ]);
    const out: InputFile[] = [];

    // README* (case-insensitive): exact README.md first, then shortest name, then lexicographic.
    const readme = rootFiles
      .filter((f) => /^readme/i.test(f) && !isSecretPath(f))
      .sort((x, y) => rank(x) - rank(y) || x.length - y.length || (x < y ? -1 : x > y ? 1 : 0))[0];
    const manifests = (MANIFEST_FILES as readonly string[]).filter((m) => rootFiles.includes(m));
    const [readmeContent, ...manifestContents] = await Promise.all([
      readme ? files.readCapped(root, readme, { maxLines: Number.MAX_SAFE_INTEGER, maxChars: MAX_README_CHARS }) : null,
      ...manifests.map((m) => files.readCapped(root, m, { maxLines: MAX_MANIFEST_LINES, maxChars: MAX_MANIFEST_CHARS })),
    ]);
    if (readme && readmeContent !== null) out.push({ path: readme, content: readmeContent, kind: 'readme' });
    manifests.forEach((m, i) => {
      const content = manifestContents[i];
      if (content !== null && content !== undefined) out.push({ path: m, content, kind: 'manifest' });
    });

    let chains: string[][] = [];
    if (ranked) {
      const seen = new Set(out.map((f) => f.path));
      const top = await index.getTopFilesByRank(run.repo.id, MAX_TOP_FILES * 2);
      const picked = top.filter((p) => !isSecretPath(p) && !seen.has(p)).slice(0, MAX_TOP_FILES);
      const contents = await Promise.all(
        picked.map((p) => files.readCapped(root, p, { maxLines: MAX_TOP_FILE_LINES, maxChars: MAX_TOP_FILE_CHARS })),
      );
      picked.forEach((p, i) => {
        const content = contents[i];
        if (content !== null && content !== undefined) out.push({ path: p, content, kind: 'ranked' });
      });
      chains = (await index.getCriticalPaths(run.repo.id)).filter((c) => !c.some(isSecretPath));
    }

    return {
      tree: tree.filter((p) => !isSecretPath(p)),
      files: out,
      lockFiles: (LOCK_FILES as readonly string[]).filter((l) => rootFiles.includes(l)),
      chains,
    };
  }
}
