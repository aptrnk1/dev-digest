import type { MergedDoc, RunAttachments } from './types.js';

/**
 * Project Context rules. Pure: no I/O, no framework.
 */

export class ContextDomainError extends Error {
  constructor(
    readonly code:
      | 'repo_not_found'
      | 'agent_not_found'
      | 'skill_not_found'
      | 'doc_not_found'
      | 'repo_not_cloned'
      | 'invalid_path',
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Own docs first, then each skill in order; the first occurrence of a path wins. */
export function mergeAttachments(r: RunAttachments): MergedDoc[] {
  const seen = new Set<string>();
  const out: MergedDoc[] = [];
  for (const path of r.own) {
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ path, via: null });
  }
  for (const s of r.skills) {
    for (const path of s.paths) {
      if (seen.has(path)) continue;
      seen.add(path);
      out.push({ path, via: { skillId: s.skillId, skillName: s.skillName } });
    }
  }
  return out;
}
