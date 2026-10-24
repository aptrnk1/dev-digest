import type { Container } from '../../platform/container.js';
import { FsDocSource } from './fs-scanner.js';
import { ContextRepository } from './repository.js';
import { RunContextService } from './run-context.service.js';
import { ContextService } from './service.js';
import type { ContextFacade, RunContextFacade } from './types.js';

/** `container.projectContext` — the only place that wires this module to the container. */
export function createContextFacade(c: Container): ContextFacade {
  return new ContextService({
    store: new ContextRepository(c.db),
    docs: new FsDocSource(),
    tokens: c.tokenizer,
  });
}

/** `container.runContext` — resolves the Project context for one agent run. */
export function createRunContextFacade(c: Container): RunContextFacade {
  return new RunContextService({
    store: new ContextRepository(c.db),
    docs: new FsDocSource(),
    git: c.git,
    tokenizer: c.tokenizer,
  });
}
