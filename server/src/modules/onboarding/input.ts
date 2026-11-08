import type { ChatMessage, OnboardingIndexStatus } from '@devdigest/shared';
import type { IndexState } from '../repo-intel/types.js';
import type { TokenCounter } from './ports.js';
import { buildMessages } from './prompt.js';

export interface InputFile {
  path: string;
  content: string;
  kind: 'readme' | 'manifest' | 'ranked';
}

/** Model input (AC56). `ranked` files are ordered by rank, best first. */
export interface ModelInput {
  tree: string[];
  files: InputFile[];
  lockFiles: string[];
  chains: string[][];
}

/** Secrets never read, never sent (AC57). `.env.example` stays. */
export function isSecretPath(path: string): boolean {
  const base = path.split('/').pop() ?? path;
  if (base === '.env.example') return false;
  if (base === '.env' || base.startsWith('.env.')) return true;
  return /\.(pem|key)$/i.test(base);
}

export function toTourIndexStatus(
  state: Pick<IndexState, 'status' | 'filesIndexed' | 'degradedReason'>,
  enabled: boolean,
): { status: OnboardingIndexStatus; filesIndexed: number } {
  if (!enabled || state.degradedReason === 'no_data') return { status: 'none', filesIndexed: 0 };
  return { status: state.status, filesIndexed: state.filesIndexed };
}

export function usesRankedInput(status: OnboardingIndexStatus): boolean {
  return status === 'full' || status === 'partial';
}

/** Paths whose content the model saw: README, manifests, ranked files. */
export function contentPaths(input: ModelInput): Set<string> {
  return new Set(input.files.map((f) => f.path));
}

type Fit = { ok: true; input: ModelInput; messages: ChatMessage[] } | { ok: false };

/**
 * Trim to the token budget in this order: lowest-ranked files, call chains,
 * file tree, then give up (AC59, AC76). README and manifests are never trimmed.
 */
export function fitToBudget(
  input: ModelInput,
  systemPrompt: string,
  tokens: TokenCounter,
  max: number,
): Fit {
  const size = (i: ModelInput): { messages: ChatMessage[]; n: number } => {
    const messages = buildMessages(i, systemPrompt);
    return { messages, n: messages.reduce((s, m) => s + tokens.count(m.content), 0) };
  };
  const fits = (i: ModelInput): boolean => size(i).n <= max;

  let cur: ModelInput = { ...input, files: [...input.files], chains: [...input.chains] };
  while (!fits(cur)) {
    let idx = -1;
    for (let k = cur.files.length - 1; k >= 0; k--) {
      if (cur.files[k]!.kind === 'ranked') {
        idx = k;
        break;
      }
    }
    if (idx < 0) break;
    cur = { ...cur, files: cur.files.filter((_, k) => k !== idx) };
  }
  while (!fits(cur) && cur.chains.length > 0) {
    cur = { ...cur, chains: cur.chains.slice(0, -1) };
  }
  if (!fits(cur)) {
    // Largest tree prefix that fits (size grows monotonically with the prefix).
    let lo = 0;
    let hi = cur.tree.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits({ ...cur, tree: cur.tree.slice(0, mid) })) lo = mid;
      else hi = mid - 1;
    }
    cur = { ...cur, tree: cur.tree.slice(0, lo) };
  }
  const s = size(cur);
  return s.n <= max ? { ok: true, input: cur, messages: s.messages } : { ok: false };
}
