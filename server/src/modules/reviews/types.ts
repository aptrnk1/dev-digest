import type { ReviewDto } from './helpers.js';

export type { ReviewDto };

/** What other modules (smart-diff) get from `container.reviews`. */
export interface ReviewsFacade {
  listForPull(workspaceId: string, prId: string): Promise<ReviewDto[]>;
}
