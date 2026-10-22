export interface BlastRadiusView {
  status: 'not_implemented';
  hint: string;
}

/** Stable stub: the signature is final, the implementation comes later. */
export function makeGetBlastRadius(): (i: { repo: string; pr: number }) => Promise<BlastRadiusView> {
  return async () => ({
    status: 'not_implemented',
    hint: 'blast radius is not implemented yet; use get_findings and the PR diff instead',
  });
}
