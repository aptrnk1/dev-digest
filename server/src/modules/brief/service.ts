import type { PrBrief, PrBriefState } from '@devdigest/shared';
import { BRIEF_SCHEMA_NAME, LLM_MAX_ATTEMPTS, LLM_TIMEOUT_MS } from './constants.js';
import { BriefDomainError } from './domain.js';
import { buildFacts } from './facts.js';
import { BriefDraft, buildBriefMessages } from './prompt.js';
import { parseStoredBrief, sanitizeDraft } from './validate.js';
import type {
  BlastSource,
  BriefPull,
  BriefStore,
  Clock,
  DiffFactsSource,
  IntentSource,
  ModelResolver,
  SpecSource,
  TokenCounter,
} from './ports.js';

export interface BriefLogger {
  info(msg: string): void;
}

export interface BriefDeps {
  store: BriefStore;
  intent: IntentSource;
  blast: BlastSource;
  diff: DiffFactsSource;
  specs: SpecSource;
  resolveModel: ModelResolver;
  tokens: TokenCounter;
  now?: Clock;
  logger?: BriefLogger;
}

const NOOP_LOG: BriefLogger = { info: () => {} };

/**
 * PR Brief — one structured LLM call over facts gathered from sibling modules'
 * facades. Read-only inputs only: nothing here derives an intent or runs a review.
 * The generation lock is in-memory, so the instance must be created once.
 */
export class BriefService {
  private readonly inProgress = new Set<string>();

  constructor(private readonly deps: BriefDeps) {}

  private async requirePull(workspaceId: string, prId: string): Promise<BriefPull> {
    const pull = await this.deps.store.loadPull(workspaceId, prId);
    if (!pull) throw new BriefDomainError('pr_not_found', 'Pull request not found');
    return pull;
  }

  /** Stored brief (or null) + whether the PR head moved since. Never calls the LLM. */
  async get(workspaceId: string, prId: string): Promise<PrBriefState> {
    const pull = await this.requirePull(workspaceId, prId);
    const stored = await this.deps.store.getBriefJson(prId);
    const brief = stored === undefined ? null : parseStoredBrief(stored);
    return { brief, stale: brief !== null && brief.head_sha !== pull.headSha };
  }

  async generate(workspaceId: string, prId: string): Promise<PrBrief> {
    const pull = await this.requirePull(workspaceId, prId);
    if (this.inProgress.has(prId)) {
      throw new BriefDomainError('brief_in_progress', 'A brief is already being generated for this PR');
    }
    this.inProgress.add(prId);
    try {
      return await this.run(workspaceId, pull);
    } finally {
      this.inProgress.delete(prId);
    }
  }

  private async run(workspaceId: string, pull: BriefPull): Promise<PrBrief> {
    const log = this.deps.logger ?? NOOP_LOG;
    const [intent, blast, diff, specs] = await Promise.all([
      this.deps.intent.get(workspaceId, pull.id),
      this.deps.blast.get(workspaceId, pull.id),
      this.deps.diff.facts(workspaceId, pull.id),
      this.deps.specs
        .resolveForRepo(
          {
            workspaceId,
            repoId: pull.repoId,
            repo: pull.repo,
            clonePath: pull.clonePath,
            base: pull.base,
          },
          log,
        )
        .catch((err: unknown) => {
          // best-effort enrichment: no specs, not a failure
          log.info(`brief: specs unavailable for PR ${pull.id}: ${err instanceof Error ? err.message : String(err)}`);
          return { specs: [], specsRead: [] };
        }),
    ]);

    const facts = buildFacts({ pull, intent, blast, diff, specs });
    const messages = buildBriefMessages(facts, this.deps.tokens);
    const { model, provider } = await this.deps.resolveModel(workspaceId);

    let lastError: unknown;
    for (let attempt = 1; attempt <= LLM_MAX_ATTEMPTS; attempt++) {
      try {
        const res = await provider.completeStructured({
          model,
          schema: BriefDraft,
          schemaName: BRIEF_SCHEMA_NAME,
          messages,
          temperature: 0,
          maxRetries: 0,
          timeoutMs: LLM_TIMEOUT_MS,
        });
        const body = sanitizeDraft(res.data, { files: facts.files, callerFiles: facts.callerFiles });
        const brief: PrBrief = {
          ...body,
          intent: facts.intent,
          intent_stale: facts.intentStale,
          blast: facts.blast,
          history: { history: [] },
          missing_inputs: facts.missing,
          head_sha: pull.headSha,
          generated_at: (this.deps.now?.() ?? new Date()).toISOString(),
          model: res.model || model,
          cost_usd: res.costUsd,
        };
        await this.deps.store.upsertBrief(pull.id, brief);
        return brief;
      } catch (err) {
        if (err instanceof BriefDomainError && err.code === 'llm_not_configured') throw err;
        lastError = err;
        log.info(`brief: attempt ${attempt}/${LLM_MAX_ATTEMPTS} failed for PR ${pull.id}`);
      }
    }
    throw new BriefDomainError(
      'brief_failed',
      `Could not generate the brief${lastError instanceof Error ? `: ${lastError.message}` : ''}`,
    );
  }
}
