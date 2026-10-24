import { z } from 'zod';
import { OnboardingNodeKind, type ChatMessage } from '@devdigest/shared';
import { wrapUntrusted } from '../../platform/prompt.js';
import type { ModelInput } from './input.js';

/** What the model returns (strict-schema friendly: every field required, no max). */
export const OnboardingTourDraft = z.object({
  summary: z.string(),
  diagram: z.object({
    nodes: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        kind: OnboardingNodeKind,
        path: z.string().nullable(),
      }),
    ),
    edges: z.array(z.object({ from: z.string(), to: z.string() })),
  }),
  critical_paths: z.array(z.object({ path: z.string(), description: z.string() })),
  run_steps: z.array(z.object({ command: z.string(), source_path: z.string() })),
  reading_path: z.array(z.object({ path: z.string(), why: z.string() })),
  first_tasks: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      size: z.enum(['S', 'M']),
      files: z.array(z.string()),
    }),
  ),
});
export type OnboardingTourDraft = z.infer<typeof OnboardingTourDraft>;

/** A label safe inside the `source="…"` attribute of an <untrusted> block. */
function label(prefix: string, path: string): string {
  return `${prefix}:${path.replace(/["<>\n\r]/g, '_')}`;
}

/** System prompt as-is; ALL repo content goes into the user message, each file in its own block. */
export function buildMessages(input: ModelInput, systemPrompt: string): ChatMessage[] {
  const parts: string[] = [];
  parts.push(`## File tree\n${wrapUntrusted('file-tree', input.tree.join('\n'))}`);
  if (input.lockFiles.length > 0) {
    parts.push(
      `## Lock files present (names only)\n${wrapUntrusted('lock-files', input.lockFiles.join('\n'))}`,
    );
  }
  for (const f of input.files) {
    parts.push(
      `## ${f.kind}: ${f.path.replace(/[\n\r]/g, '_')}\n${wrapUntrusted(label(f.kind, f.path), f.content)}`,
    );
  }
  if (input.chains.length > 0) {
    const text = input.chains.map((c) => c.join(' -> ')).join('\n');
    parts.push(`## Critical call chains\n${wrapUntrusted('call-chains', text)}`);
  }
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: parts.join('\n\n') },
  ];
}
