import type { BlastRadiusResponse } from '@devdigest/shared';

/** What `container.blast` exposes to the route. */
export interface BlastFacade {
  get(workspaceId: string, prId: string): Promise<BlastRadiusResponse>;
}
