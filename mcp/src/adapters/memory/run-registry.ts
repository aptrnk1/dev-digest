import type { RunRef, RunStore } from '../../app/ports.js';

const CAP = 200;

/** In-process run_id -> PR map; oldest entry is evicted past the cap. */
export class RunRegistry implements RunStore {
  private readonly map = new Map<string, RunRef>();

  remember(runId: string, ref: RunRef): void {
    this.map.delete(runId);
    this.map.set(runId, ref);
    if (this.map.size > CAP) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
  }

  lookup(runId: string): RunRef | undefined {
    return this.map.get(runId);
  }
}
