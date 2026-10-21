import type {
  IntentConfidence,
  IntentSource,
  PrIntentRecord,
  PrIntentState,
  UnresolvedRef,
} from '@devdigest/shared';
import type { EnsureIntentOptions } from './types.js';
import type {
  FileSource,
  IntentLog,
  IntentStore,
  IssueSource,
  Logger,
  ModelResolver,
  PullInputs,
} from './ports.js';
import { IntentDomainError, applyCeiling, evidenceTier, meaningfulText } from './domain.js';
import {
  computeInputHash,
  describeSource,
  extractRefs,
  formatDescription,
  formatSignals,
  sourceLabel,
  truncate,
  withTimeout,
} from './helpers.js';
import { IntentClassification, buildIntentMessages, type PromptSource } from './prompt.js';
import {
  INTENT_SCHEMA_NAME,
  ISSUE_TIMEOUT_MS,
  LLM_MAX_RETRIES,
  LLM_TIMEOUT_MS,
  MAX_BODY_CHARS,
  MAX_ISSUES,
  MAX_ISSUE_CHARS,
  MAX_LIST_ITEMS,
  MAX_SPEC_CHARS,
  MAX_SPEC_DOCS,
} from './constants.js';

export interface IntentDeps {
  store: IntentStore;
  issues: IssueSource;
  files: FileSource;
  resolveModel: ModelResolver;
  logger?: Logger;
}

const NOOP_LOG: IntentLog = { info: () => {}, error: () => {} };

/** One gathered input: what goes into the prompt, the hash and the stored `sources`. */
interface Gathered {
  sources: IntentSource[];
  prompt: PromptSource[];
  /** Raw content per source ref, for the input hash. */
  hashed: { ref: string; content: string }[];
  unresolved: UnresolvedRef[];
  specRead: boolean;
  ticketWithBody: boolean;
  ticketTitleOnly: boolean;
}

/**
 * Intent Layer — derive (or serve from cache) the "why" of a PR. Sources are
 * gathered deterministically (spec links, issues, description, signals), hashed,
 * and only a changed hash (or `force`) triggers the cheap classifier call.
 */
export class IntentService {
  constructor(private readonly deps: IntentDeps) {}

  /** Cached intent (or null) + whether it lags the PR head. */
  async get(workspaceId: string, prId: string): Promise<PrIntentState> {
    const pull = await this.deps.store.loadPull(workspaceId, prId);
    if (!pull) throw new IntentDomainError('pr_not_found', 'Pull request not found');
    const stored = await this.deps.store.getIntent(prId);
    return {
      intent: stored?.record ?? null,
      stale: stored ? stored.record.head_sha !== pull.headSha : false,
    };
  }

  async ensure(
    workspaceId: string,
    prId: string,
    opts: EnsureIntentOptions = {},
  ): Promise<PrIntentRecord> {
    const log = opts.log ?? NOOP_LOG;
    const started = Date.now();
    const pull = await this.deps.store.loadPull(workspaceId, prId);
    if (!pull) throw new IntentDomainError('pr_not_found', 'Pull request not found');

    log.info('Deriving PR intent…');
    const g = await this.gather(pull);
    log.info(
      `Intent sources: ${g.sources.map(describeSource).join(' · ')}` +
        (g.unresolved.length ? ` · unresolved ${g.unresolved.map((u) => u.ref).join(', ')}` : ''),
    );

    const inputHash = computeInputHash({
      headSha: pull.headSha,
      title: pull.title,
      body: pull.body,
      sources: g.hashed,
    });
    const sourceKinds = [...new Set(g.sources.map((s) => s.kind))];

    if (!opts.force) {
      const stored = await this.deps.store.getIntent(prId);
      if (stored && stored.inputHash === inputHash) {
        log.info(`Intent cache hit (${inputHash.slice(0, 7)})`);
        this.deps.logger?.info(
          {
            prId, cacheHit: true, basis: stored.record.basis, confidence: stored.record.confidence,
            sourceKinds, latencyMs: Date.now() - started,
          },
          'intent: cache hit',
        );
        return stored.record;
      }
    }

    const { llm, model } = await this.deps.resolveModel(workspaceId);
    const res = await llm.completeStructured({
      model,
      schema: IntentClassification,
      schemaName: INTENT_SCHEMA_NAME,
      messages: buildIntentMessages(g.prompt),
      temperature: 0,
      maxRetries: LLM_MAX_RETRIES,
      timeoutMs: LLM_TIMEOUT_MS,
    });

    const tier = evidenceTier({
      specRead: g.specRead,
      ticketWithBody: g.ticketWithBody,
      ticketTitleOnly: g.ticketTitleOnly,
      descriptionChars: meaningfulText(pull.body).length,
    });
    const confidence: IntentConfidence = applyCeiling(tier.ceiling, res.data.confidence);

    const record = await this.deps.store.upsertIntent(prId, {
      intent: res.data.intent.trim(),
      in_scope: res.data.in_scope.slice(0, MAX_LIST_ITEMS),
      out_of_scope: res.data.out_of_scope.slice(0, MAX_LIST_ITEMS),
      risk_areas: res.data.risk_areas.slice(0, MAX_LIST_ITEMS),
      confidence,
      basis: tier.basis,
      sources: g.sources,
      unresolved_refs: g.unresolved,
      head_sha: pull.headSha,
      input_hash: inputHash,
      model: res.model,
      tokens_in: res.tokensIn,
      tokens_out: res.tokensOut,
      cost_usd: res.costUsd,
    });

    const cost = res.costUsd === null ? 'n/a' : `$${res.costUsd.toFixed(4)}`;
    log.info(
      `Intent: confidence=${confidence} basis=${tier.basis} · ${res.tokensIn}→${res.tokensOut} tok · ${cost}`,
    );
    this.deps.logger?.info(
      {
        prId, model: res.model, cacheHit: false, basis: tier.basis, confidence, sourceKinds,
        tokensIn: res.tokensIn, tokensOut: res.tokensOut, costUsd: res.costUsd,
        latencyMs: Date.now() - started,
      },
      'intent: derived',
    );
    return record;
  }

  // ------------------------------------------------------------------ internals

  private async gather(pull: PullInputs): Promise<Gathered> {
    const refs = extractRefs({ body: pull.body, branch: pull.branch, repo: pull.repo });
    const g: Gathered = {
      sources: [],
      prompt: [],
      hashed: [],
      unresolved: [...refs.unresolved],
      specRead: false,
      ticketWithBody: false,
      ticketTitleOnly: false,
    };
    const add = (source: IntentSource, content: string): void => {
      g.sources.push(source);
      g.prompt.push({ label: sourceLabel(source), content });
      g.hashed.push({ ref: sourceLabel(source), content });
    };

    // spec: strongest tier, read from the clone at head
    for (const path of refs.specs.slice(0, MAX_SPEC_DOCS)) {
      const text = await this.readSpec(pull, path);
      if (!text || !text.trim()) {
        g.unresolved.push({ ref: path, reason: 'not found at head' });
        continue;
      }
      const t = truncate(text, MAX_SPEC_CHARS);
      add({ kind: 'spec', ref: path, truncated: t.truncated }, t.text);
      g.specRead = true;
    }
    for (const path of refs.specs.slice(MAX_SPEC_DOCS)) {
      g.unresolved.push({ ref: path, reason: `not read: only the first ${MAX_SPEC_DOCS} specs are used` });
    }

    // ticket: GitHub issues; failures are unresolved refs, not errors
    for (const n of refs.issues.slice(0, MAX_ISSUES)) {
      try {
        const issue = await withTimeout(
          this.deps.issues.getIssue(pull.repo, n),
          ISSUE_TIMEOUT_MS,
          `issue #${n}`,
        );
        const body = issue.body?.trim() ?? '';
        const t = truncate(body ? `${issue.title}\n\n${body}` : issue.title, MAX_ISSUE_CHARS);
        add({ kind: 'ticket', ref: `#${n}`, truncated: t.truncated }, t.text);
        if (body) g.ticketWithBody = true;
        else g.ticketTitleOnly = true;
      } catch (err) {
        g.unresolved.push({ ref: `#${n}`, reason: `not fetched: ${(err as Error).message.slice(0, 120)}` });
      }
    }
    for (const n of refs.issues.slice(MAX_ISSUES)) {
      g.unresolved.push({ ref: `#${n}`, reason: `not fetched: only the first ${MAX_ISSUES} issues are used` });
    }

    // description: title + body (the title alone still goes to the prompt)
    const desc = truncate(pull.body ?? '', MAX_BODY_CHARS);
    const descText = formatDescription(pull.title, pull.body ? desc.text : null);
    if (pull.body && pull.body.trim()) {
      add({ kind: 'description', ref: 'pr-description', truncated: desc.truncated }, descText);
    } else {
      g.prompt.push({ label: 'pr-description', content: descText });
      g.hashed.push({ ref: 'pr-description', content: descText });
    }

    // inferred: branch, commits, changed paths
    add(
      { kind: 'inferred', ref: 'pr-signals', truncated: false },
      formatSignals({ branch: pull.branch, commits: pull.commits, files: pull.files }),
    );
    return g;
  }

  private async readSpec(pull: PullInputs, path: string): Promise<string | null> {
    try {
      return await this.deps.files.showFile(pull.repo, pull.headSha, path);
    } catch {
      return null;
    }
  }
}
