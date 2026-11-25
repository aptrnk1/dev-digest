import { describe, expect, it } from 'vitest';
import {
  AgentAmbiguous,
  AgentDisabled,
  AgentNotFound,
  BadArgs,
  DomainError,
  PrNotFound,
  RepoBadFormat,
  RepoNotFound,
  RunFailed,
  RunNotStarted,
  RunUnknown,
} from '../../src/domain/errors.js';

describe('domain errors', () => {
  const cases: Array<[DomainError, string, RegExp]> = [
    [new RepoNotFound('a/b', ['x/y']), 'repo_not_found', /known repos: x\/y/],
    [new RepoBadFormat('ab'), 'repo_bad_format', /owner\/name/],
    [new PrNotFound(7, 'a/b'), 'pr_not_found', /PR #7 not found in a\/b; refresh the repo in the UI/],
    [new AgentNotFound('z'), 'agent_not_found', /call list_agents/],
    [new AgentAmbiguous('z', ['a', 'b']), 'agent_ambiguous', /call list_agents/],
    [new AgentDisabled('z'), 'agent_disabled', /call list_agents/],
    [new RunUnknown(), 'run_unknown', /pass repo and pr too/],
    [new RunFailed('failed', 'boom'), 'run_failed', /boom.*provider key in Settings or the run log in the UI/],
    [new RunNotStarted(7, 'a/b'), 'run_not_started', /PR #7 in a\/b.*retry/],
    [new BadArgs('x'), 'bad_args', /x/],
  ];

  it.each(cases)('%s has its code and an actionable message', (err, code, re) => {
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(code);
    expect(err.message).toMatch(re);
  });

  it('lists at most 10 known repos', () => {
    const known = Array.from({ length: 15 }, (_, i) => `o/r${i}`);
    const msg = new RepoNotFound('a/b', known).message;
    expect(msg).toContain('o/r9');
    expect(msg).not.toContain('o/r10');
  });

  it('says what to do when no repos exist', () => {
    expect(new RepoNotFound('a/b', []).message).toMatch(/add one/);
  });
});
