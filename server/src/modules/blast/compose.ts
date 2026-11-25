import type { Container } from '../../platform/container.js';
import { BlastRepository } from './repository.js';
import { BlastService } from './service.js';
import type { BlastFacade } from './types.js';

/** `container.blast` — the only place that wires this module to the container. */
export function createBlastFacade(c: Container): BlastFacade {
  const service = new BlastService({
    store: new BlastRepository(c.db),
    intel: c.repoIntel,
    repoIntelEnabled: c.config.repoIntelEnabled,
  });
  return { get: (workspaceId, prId) => service.get(workspaceId, prId) };
}
