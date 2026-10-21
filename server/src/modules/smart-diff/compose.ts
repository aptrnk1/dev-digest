import type { Container } from '../../platform/container.js';
import { SmartDiffRepository } from './repository.js';
import { SmartDiffService } from './service.js';
import type { SmartDiffFacade } from './types.js';

/** `container.smartDiff` — the only place that wires this module to the container. */
export function createSmartDiffFacade(c: Container): SmartDiffFacade {
  const service = new SmartDiffService({
    store: new SmartDiffRepository(c.db),
    reviews: c.reviews,
    ranks: c.repoIntel,
  });
  return { get: (workspaceId, prId) => service.get(workspaceId, prId) };
}
