import type {
  AuthProvider,
  SecretsProvider,
  GitHubClient,
  GitClient,
  CodeIndex,
  Embedder,
  LLMProvider,
} from '@devdigest/shared';
import type { AppConfig } from './config.js';
import type { Db } from '../db/client.js';
import { JobRunner } from './jobs.js';
import { runBus, type RunBus } from './sse.js';
import { LocalSecretsProvider } from '../adapters/secrets/local.js';
import { LocalNoAuthProvider } from '../adapters/auth/local.js';
import { OctokitGitHubClient } from '../adapters/github/octokit.js';
import { SimpleGitClient } from '../adapters/git/simple-git.js';
import { RipgrepCodeIndex } from '../adapters/codeindex/ripgrep.js';
import { OpenAIProvider } from '../adapters/llm/openai.js';
import { AnthropicProvider } from '../adapters/llm/anthropic.js';
import { OpenAIEmbedder } from '../adapters/embedder/openai.js';
import { OpenRouterProvider } from '@devdigest/reviewer-core';
import { estimateCost } from '../adapters/llm/pricing.js';
import { PriceBook } from './price-book.js';
import { ConfigError } from './errors.js';
import { AgentsRepository } from '../modules/agents/repository.js';
import { ReviewRepository } from '../modules/reviews/repository.js';
import type { IntentFacade } from '../modules/intent/types.js';
import { createIntentFacade } from '../modules/intent/compose.js';
import type { ReviewsFacade } from '../modules/reviews/types.js';
import { createReviewsFacade } from '../modules/reviews/compose.js';
import type { SmartDiffFacade } from '../modules/smart-diff/types.js';
import { createSmartDiffFacade } from '../modules/smart-diff/compose.js';
import type { BlastFacade } from '../modules/blast/types.js';
import { createBlastFacade } from '../modules/blast/compose.js';
import type { ContextFacade, RunContextFacade } from '../modules/context/types.js';
import { createContextFacade, createRunContextFacade } from '../modules/context/compose.js';
import type { OnboardingFacade } from '../modules/onboarding/types.js';
import type { OnboardingLogger } from '../modules/onboarding/ports.js';
import { createOnboardingFacade } from '../modules/onboarding/compose.js';
import type { RepoIntel } from '../modules/repo-intel/types.js';
import { RepoIntelService } from '../modules/repo-intel/service.js';
import { type DepGraph, DepCruiseGraph } from '../adapters/depgraph/index.js';
import { type Tokenizer, TiktokenTokenizer } from '../adapters/tokenizer/index.js';

/**
 * DI container. One per app instance. Holds config, db, the JobRunner,
 * the SSE bus, and lazily-constructed adapters resolved through SecretsProvider.
 *
 * Tests construct a container with `overrides` to inject mock adapters; the
 * Services depend on these interfaces, not the concrete classes.
 */
/** Transport limits for a one-off provider (see `Container.llmWithLimits`). */
export interface LlmLimits {
  maxRetries: number;
  timeoutMs: number;
}

export interface ContainerOverrides {
  secrets?: SecretsProvider;
  auth?: AuthProvider;
  github?: GitHubClient;
  git?: GitClient;
  codeIndex?: CodeIndex;
  embedder?: Embedder;
  /** Pre-built providers by id (skip key lookup). */
  llm?: Partial<Record<'openai' | 'anthropic' | 'openrouter', LLMProvider>>;
  /** Replaces `llmWithLimits` (tests) — skips key lookup. */
  llmWithLimits?: (id: 'openai' | 'anthropic' | 'openrouter', limits: LlmLimits) => LLMProvider;
  /** repo-intel facade (T1.1+) — tests inject mock RepoIntel implementations. */
  repoIntel?: RepoIntel;
  /** Intent Layer facade — tests inject a stub instead of the LLM-backed one. */
  intent?: IntentFacade;
  /** Reviews read facade — tests inject a stub instead of the DB-backed one. */
  reviews?: ReviewsFacade;
  /** Smart Diff facade — route tests inject a stub (no DB). */
  smartDiff?: SmartDiffFacade;
  blast?: BlastFacade;
  /** Onboarding Tour facade — route tests inject a stub (no DB / FS / LLM). */
  onboarding?: OnboardingFacade;
  /** Project Context facade — route tests inject a stub (no DB / FS). */
  projectContext?: ContextFacade;
  runContext?: RunContextFacade;
  /** repo-intel T3 adapters — only the indexer pipeline reads these. */
  depgraph?: DepGraph;
  tokenizer?: Tokenizer;
}

export class Container {
  readonly config: AppConfig;
  readonly db: Db;
  readonly secrets: SecretsProvider;
  readonly auth: AuthProvider;
  readonly jobs: JobRunner;
  readonly runBus: RunBus;

  private _git?: GitClient;
  private _github?: GitHubClient;
  private _codeIndex?: CodeIndex;
  private _embedder?: Embedder;
  private llmCache = new Map<string, LLMProvider>();

  // Shared repositories for cross-cutting entities (agents, reviews/pulls,
  // runs). Constructed here, in the composition root, so consuming modules use
  // `container.agentsRepo` instead of reaching into another module's folder.
  private _agentsRepo?: AgentsRepository;
  private _reviewRepo?: ReviewRepository;
  private _repoIntel?: RepoIntel;
  private _intent?: IntentFacade;
  private _reviews?: ReviewsFacade;
  private _smartDiff?: SmartDiffFacade;
  private _blast?: BlastFacade;
  private _projectContext?: ContextFacade;
  private _runContext?: RunContextFacade;
  private _depgraph?: DepGraph;
  private _tokenizer?: Tokenizer;
  private _priceBook?: PriceBook;

  constructor(config: AppConfig, db: Db, private overrides: ContainerOverrides = {}) {
    this.config = config;
    this.db = db;
    this.secrets = overrides.secrets ?? new LocalSecretsProvider(config.secretsPath);
    this.auth = overrides.auth ?? new LocalNoAuthProvider(db);
    this.runBus = runBus;
    this.jobs = new JobRunner(db);
  }

  get git(): GitClient {
    if (this.overrides.git) return this.overrides.git;
    this._git ??= new SimpleGitClient(this.config.cloneDir);
    return this._git;
  }

  get agentsRepo(): AgentsRepository {
    return (this._agentsRepo ??= new AgentsRepository(this.db));
  }

  get reviewRepo(): ReviewRepository {
    return (this._reviewRepo ??= new ReviewRepository(this.db));
  }

  get codeIndex(): CodeIndex {
    if (this.overrides.codeIndex) return this.overrides.codeIndex;
    this._codeIndex ??= new RipgrepCodeIndex(this.git);
    return this._codeIndex;
  }

  /**
   * The repo-intel facade (T1.1). All higher-level features (reviews,
   * blast/onboarding migrations, phantom-gate) code against this interface.
   * Tests inject a mock via `ContainerOverrides.repoIntel`.
   */
  get repoIntel(): RepoIntel {
    if (this.overrides.repoIntel) return this.overrides.repoIntel;
    this._repoIntel ??= new RepoIntelService(this);
    return this._repoIntel;
  }

  /**
   * Intent Layer facade — derive/cached PR intent for the review pre-work.
   * Same pattern as `repoIntel`: reviews never import the intent module.
   */
  get intent(): IntentFacade {
    if (this.overrides.intent) return this.overrides.intent;
    this._intent ??= createIntentFacade(this);
    return this._intent;
  }

  /** Reviews read facade (reviews of a PR) for other modules. */
  get reviews(): ReviewsFacade {
    if (this.overrides.reviews) return this.overrides.reviews;
    this._reviews ??= createReviewsFacade(this);
    return this._reviews;
  }

  /** Smart Diff facade — grouped PR files + findings overlay. */
  get smartDiff(): SmartDiffFacade {
    if (this.overrides.smartDiff) return this.overrides.smartDiff;
    this._smartDiff ??= createSmartDiffFacade(this);
    return this._smartDiff;
  }

  get blast(): BlastFacade {
    if (this.overrides.blast) return this.overrides.blast;
    this._blast ??= createBlastFacade(this);
    return this._blast;
  }

  /** Onboarding Tour facade; built per call (the logger is the caller's). */
  onboarding(logger: OnboardingLogger): OnboardingFacade {
    return this.overrides.onboarding ?? createOnboardingFacade(this, logger);
  }

  /** Project Context: repo Markdown docs + agent/skill attachments. */
  get projectContext(): ContextFacade {
    if (this.overrides.projectContext) return this.overrides.projectContext;
    this._projectContext ??= createContextFacade(this);
    return this._projectContext;
  }

  /** Project Context resolver used once per agent run by the review executor. */
  get runContext(): RunContextFacade {
    if (this.overrides.runContext) return this.overrides.runContext;
    this._runContext ??= createRunContextFacade(this);
    return this._runContext;
  }

  /** Import-graph builder (dependency-cruiser). T3 indexer pipeline only. */
  get depgraph(): DepGraph {
    if (this.overrides.depgraph) return this.overrides.depgraph;
    this._depgraph ??= new DepCruiseGraph();
    return this._depgraph;
  }

  /** Token counter (js-tiktoken) for the repo-map budget search. */
  get tokenizer(): Tokenizer {
    if (this.overrides.tokenizer) return this.overrides.tokenizer;
    this._tokenizer ??= new TiktokenTokenizer();
    return this._tokenizer;
  }

  /**
   * Live OpenRouter pricing for cost attribution. The lister builds a bare
   * OpenRouter provider just for `/models` (no estimator needed) and degrades to
   * `[]` when no key is configured; the static `estimateCost` table is the
   * fallback for OpenAI/Anthropic and a cold/cold-failed cache.
   */
  get priceBook(): PriceBook {
    this._priceBook ??= new PriceBook(async () => {
      try {
        const key = await this.secrets.get('OPENROUTER_API_KEY');
        if (!key) return [];
        return await new OpenRouterProvider(key).listModels();
      } catch {
        return [];
      }
    }, estimateCost);
    return this._priceBook;
  }

  async github(): Promise<GitHubClient> {
    if (this.overrides.github) return this.overrides.github;
    if (this._github) return this._github;
    const token = await this.secrets.get('GITHUB_TOKEN');
    if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
    this._github = new OctokitGitHubClient(token);
    return this._github;
  }

  /** Resolve an LLM provider by id; constructs from the secret key, cached. */
  async llm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
    const injected = this.overrides.llm?.[id];
    if (injected) return injected;
    const cached = this.llmCache.get(id);
    if (cached) return cached;
    const provider = await this.buildLlm(id);
    this.llmCache.set(id, provider);
    return provider;
  }

  /**
   * Build a fresh (uncached) provider with bounded transport retries and a
   * request timeout. Throws ConfigError when the provider key is missing.
   */
  async llmWithLimits(
    id: 'openai' | 'anthropic' | 'openrouter',
    limits: LlmLimits,
  ): Promise<LLMProvider> {
    if (this.overrides.llmWithLimits) return this.overrides.llmWithLimits(id, limits);
    if (id === 'openai') {
      const key = await this.secrets.get('OPENAI_API_KEY');
      if (!key) throw new ConfigError('OPENAI_API_KEY is not configured');
      return new OpenAIProvider(key, limits);
    }
    if (id === 'openrouter') {
      const key = await this.secrets.get('OPENROUTER_API_KEY');
      if (!key) throw new ConfigError('OPENROUTER_API_KEY is not configured');
      return new OpenRouterProvider(key, {
        maxRetries: limits.maxRetries,
        timeoutMs: limits.timeoutMs,
        estimateCost: (model, tokensIn, tokensOut) =>
          this.priceBook.estimate(model, tokensIn, tokensOut),
      });
    }
    const key = await this.secrets.get('ANTHROPIC_API_KEY');
    if (!key) throw new ConfigError('ANTHROPIC_API_KEY is not configured');
    return new AnthropicProvider(key, limits);
  }

  private async buildLlm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
    if (id === 'openai') {
      const key = await this.secrets.get('OPENAI_API_KEY');
      if (!key) throw new ConfigError('OPENAI_API_KEY is not configured');
      return new OpenAIProvider(key);
    }
    if (id === 'openrouter') {
      // Single OpenRouter provider lives in reviewer-core (shared with the CI
      // runner); inject the PriceBook so cost attribution uses LIVE OpenRouter
      // prices (with the static table as a fallback) rather than a hardcoded one.
      const key = await this.secrets.get('OPENROUTER_API_KEY');
      if (!key) throw new ConfigError('OPENROUTER_API_KEY is not configured');
      return new OpenRouterProvider(key, {
        estimateCost: (model, tokensIn, tokensOut) =>
          this.priceBook.estimate(model, tokensIn, tokensOut),
      });
    }
    const key = await this.secrets.get('ANTHROPIC_API_KEY');
    if (!key) throw new ConfigError('ANTHROPIC_API_KEY is not configured');
    return new AnthropicProvider(key);
  }

  async embedder(): Promise<Embedder> {
    // Injected embedders (tests) always win. Otherwise embeddings are gated by
    // config: when disabled we throw BEFORE constructing the OpenAI client, so
    // the app makes ZERO OpenAI requests. All callers wrap this in try/catch and
    // degrade gracefully (memory/RAG simply returns no hits).
    if (this.overrides.embedder) return this.overrides.embedder;
    if (!this.config.embeddingsEnabled) {
      throw new ConfigError('Embeddings are disabled (set EMBEDDINGS_ENABLED=true to enable memory/RAG)');
    }
    if (this._embedder) return this._embedder;
    const openai = await this.llm('openai');
    this._embedder = new OpenAIEmbedder(openai);
    return this._embedder;
  }

  /**
   * Drop cached provider clients so the next resolve picks up changed secrets.
   * Call after persisting a new API key/PAT via SecretsProvider.set.
   */
  invalidateSecretCaches(): void {
    this.llmCache.clear();
    this._github = undefined;
    this._embedder = undefined;
  }
}
