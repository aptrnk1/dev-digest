import type { Container } from '../../platform/container.js';
import { FsDocSource } from './fs-scanner.js';
import { ContextRepository } from './repository.js';
import { ContextService } from './service.js';
import type { ContextFacade } from './types.js';

/** `container.projectContext` — the only place that wires this module to the container. */
export function createContextFacade(c: Container): ContextFacade {
  return new ContextService({
    store: new ContextRepository(c.db),
    docs: new FsDocSource(),
    tokens: c.tokenizer,
  });
}
