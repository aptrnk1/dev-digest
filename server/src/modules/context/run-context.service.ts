import { renderSpecsBlock, type ProjectSpec } from '@devdigest/reviewer-core';
import { CONTEXT_TOKEN_BUDGET, MAX_DOC_BYTES } from './constants.js';
import { mergeAttachments } from './domain.js';
import type { AttachmentStore, BaseRefReader, DocSource, TokenCounter } from './ports.js';
import type {
  ContextLog,
  RunContextFacade,
  RunContextInput,
  RunProjectContext,
} from './types.js';

const PREFIX = 'Project context:';
const empty = (): RunProjectContext => ({ specs: [], specsRead: [] });

export interface RunContextDeps {
  store: Pick<AttachmentStore, 'loadForRun'>;
  docs: Pick<DocSource, 'isClone'>;
  git: BaseRefReader;
  tokenizer: TokenCounter;
}

/**
 * Resolves the Project context for one agent run: merge attachments, check the clone and the
 * base ref, read each doc from `origin/<base>` (never the PR head), apply the token budget.
 * Exactly one summary line is logged (NFR7).
 */
export class RunContextService implements RunContextFacade {
  constructor(private readonly deps: RunContextDeps) {}

  async resolveForRun(input: RunContextInput, log: ContextLog): Promise<RunProjectContext> {
    // Attachments are read once, here; later edits only affect the next run (AC67).
    const merged = mergeAttachments(await this.deps.store.loadForRun(input.agentId, input.repoId));
    if (merged.length === 0) {
      log.info(`${PREFIX} none attached`);
      return empty();
    }
    if (!input.clonePath || !(await this.deps.docs.isClone(input.clonePath))) {
      log.info(`${PREFIX} repo not cloned — skipped`);
      return empty();
    }
    const ref = `origin/${input.base}`;
    if (!(await this.deps.git.hasRef(input.repo, ref))) {
      log.info(`${PREFIX} base branch ${input.base} not fetched — skipped`);
      return empty();
    }

    const specs: ProjectSpec[] = [];
    for (const { path } of merged) {
      const content = await this.read(input, ref, path);
      if (content === null) {
        log.info(`${PREFIX} skipped ${path} (missing)`);
        continue;
      }
      const candidate = [...specs, { path, content }];
      if (this.deps.tokenizer.count(renderSpecsBlock(candidate) ?? '') > CONTEXT_TOKEN_BUDGET) {
        log.info(`${PREFIX} skipped ${path} (budget)`);
        continue;
      }
      specs.push({ path, content });
    }

    if (specs.length === 0) {
      log.info(`${PREFIX} no documents injected (all skipped)`);
      return empty();
    }
    const tokens = this.deps.tokenizer.count(renderSpecsBlock(specs) ?? '');
    const paths = specs.map((s) => s.path);
    log.info(`${PREFIX} ${specs.length} doc(s), +${tokens} tokens — ${paths.join(', ')}`);
    return { specs, specsRead: paths };
  }

  private async read(input: RunContextInput, ref: string, path: string): Promise<string | null> {
    try {
      const text = await this.deps.git.showFile(input.repo, ref, path);
      if (text === null || Buffer.byteLength(text, 'utf8') > MAX_DOC_BYTES) return null;
      return text;
    } catch {
      return null;
    }
  }
}
