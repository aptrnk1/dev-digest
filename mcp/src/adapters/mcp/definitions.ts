import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { ConventionCategory, Severity } from '@devdigest/shared';
import { z, type ZodRawShape } from 'zod';

export const DEFAULT_TIMEOUT_S = 300;
export const MAX_TIMEOUT_S = 600;

export type ToolName = 'list_agents' | 'run_agent_on_pr' | 'get_findings' | 'get_conventions' | 'get_blast_radius';

export const SERVER_INSTRUCTIONS = [
  'DevDigest: AI pull-request review on the local DevDigest API.',
  'repo is "owner/name"; pr is the PR number. Unsure which agent? Call list_agents first.',
  'run_agent_on_pr waits for the result; get_findings reads earlier results.',
].join('\n');

const repo = z.string().describe('owner/name');
const pr = z.number().int().min(1).describe('PR number');
const severityMin = Severity.optional().describe('lowest severity to include');
const detail = z.enum(['concise', 'full']).optional().describe('full adds rationale (default concise)');

const READ_ONLY: ToolAnnotations = { readOnlyHint: true };

interface ToolDef {
  description: string;
  inputSchema: ZodRawShape;
  annotations: ToolAnnotations;
}

// `satisfies` keeps each tool's literal shape, so adapters get typed args from z.object(shape).
export const TOOL_DEFS = {
  list_agents: {
    description: 'List enabled review agents (id, name, model).',
    inputSchema: {},
    annotations: READ_ONLY,
  },
  run_agent_on_pr: {
    description:
      'Run a review agent on a PR and wait for the findings and verdict. On timeout returns status running; fetch later with get_findings.',
    inputSchema: {
      repo,
      pr,
      agent: z.string().describe('agent id or name'),
      timeout_s: z.number().int().min(5).max(MAX_TIMEOUT_S).optional().describe(`default ${DEFAULT_TIMEOUT_S}`),
      severity_min: severityMin,
      detail,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  get_findings: {
    description: 'Get review findings and verdict, by run_id or by repo and pr (optionally one agent).',
    inputSchema: {
      run_id: z.string().optional(),
      repo: repo.optional(),
      pr: pr.optional(),
      agent: z.string().optional().describe('agent id or name'),
      severity_min: severityMin,
      detail,
    },
    annotations: READ_ONLY,
  },
  get_conventions: {
    description: 'Get the accepted coding conventions of a repo.',
    inputSchema: { repo, category: ConventionCategory.optional() },
    annotations: READ_ONLY,
  },
  get_blast_radius: {
    description: 'Impact map of a PR: symbols declared in the changed files, their callers (file:line) and the endpoints/crons that depend on them. Reads the repo index; degraded=true means the index is missing or incomplete.',
    inputSchema: { repo, pr },
    annotations: READ_ONLY,
  },
} satisfies Record<ToolName, ToolDef>;
