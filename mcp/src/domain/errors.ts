export type DomainErrorCode =
  | 'repo_not_found'
  | 'repo_bad_format'
  | 'pr_not_found'
  | 'agent_not_found'
  | 'agent_ambiguous'
  | 'agent_disabled'
  | 'run_unknown'
  | 'run_failed'
  | 'run_not_started'
  | 'bad_args';

/** Domain error: `code` is machine-readable, `message` is the actionable next step. */
export abstract class DomainError extends Error {
  abstract readonly code: DomainErrorCode;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

const MAX_LISTED = 10;
const list = (xs: string[]): string => xs.slice(0, MAX_LISTED).join(', ') + (xs.length > MAX_LISTED ? ', …' : '');

export class RepoNotFound extends DomainError {
  readonly code = 'repo_not_found';
  constructor(repo: string, known: string[]) {
    super(
      known.length
        ? `repo "${repo}" not found; known repos: ${list(known)}`
        : `repo "${repo}" not found; no repos are registered, add one in the DevDigest UI`,
    );
  }
}

export class RepoBadFormat extends DomainError {
  readonly code = 'repo_bad_format';
  constructor(repo: string) {
    super(`repo "${repo}" must be in the form owner/name`);
  }
}

export class PrNotFound extends DomainError {
  readonly code = 'pr_not_found';
  constructor(pr: number, repo: string) {
    super(`PR #${pr} not found in ${repo}; refresh the repo in the UI`);
  }
}

export class AgentNotFound extends DomainError {
  readonly code = 'agent_not_found';
  constructor(agent: string) {
    super(`agent "${agent}" not found; call list_agents to see available agents`);
  }
}

export class AgentAmbiguous extends DomainError {
  readonly code = 'agent_ambiguous';
  constructor(agent: string, matches: string[]) {
    super(`agent "${agent}" matches several agents (${list(matches)}); pass the exact id, call list_agents`);
  }
}

export class AgentDisabled extends DomainError {
  readonly code = 'agent_disabled';
  constructor(agent: string) {
    super(`agent "${agent}" is disabled; enable it in the UI or pick another, call list_agents`);
  }
}

export class RunUnknown extends DomainError {
  readonly code = 'run_unknown';
  constructor() {
    super('run_id not started in this MCP session; pass repo and pr too');
  }
}

export class RunFailed extends DomainError {
  readonly code = 'run_failed';
  constructor(status: string, error?: string | null) {
    super(
      `run ${status}${error ? `: ${error}` : ''}; check the agent's provider key in Settings or the run log in the UI`,
    );
  }
}

export class RunNotStarted extends DomainError {
  readonly code = 'run_not_started';
  constructor(pr: number, repo: string) {
    super(`DevDigest accepted the review for PR #${pr} in ${repo} but started no run; check the agent and the PR in the UI, then retry`);
  }
}

export class BadArgs extends DomainError {
  readonly code = 'bad_args';
  constructor(detail: string) {
    super(`invalid arguments: ${detail}`);
  }
}
