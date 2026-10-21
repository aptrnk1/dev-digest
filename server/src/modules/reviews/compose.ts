import type { Container } from '../../platform/container.js';
import { ReviewService } from './service.js';
import type { ReviewsFacade } from './types.js';

/** `container.reviews` — read access to a PR's reviews for other modules. */
export function createReviewsFacade(c: Container): ReviewsFacade {
  const service = new ReviewService(c);
  return { listForPull: (workspaceId, prId) => service.reviewsForPull(workspaceId, prId) };
}
