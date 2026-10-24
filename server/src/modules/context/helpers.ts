import { wrapSpec } from '@devdigest/reviewer-core';
import type { ContextAttachmentStatus, SpecFile } from '@devdigest/shared';
import { categoryOf, folderOf } from './paths.js';
import type { DocRead, ScannedDoc, TokenCounter } from './ports.js';

/** Tokens of the exact text a doc adds to the prompt (AC11). */
export function docTokens(counter: TokenCounter, path: string, content: string): number {
  return counter.count(wrapSpec({ path, content }));
}

/** Attachment/list status + tokens for one read result. */
export function readState(
  counter: TokenCounter,
  path: string,
  read: DocRead,
): { status: ContextAttachmentStatus; tokens: number | null } {
  if (read.kind === 'ok') return { status: 'ok', tokens: docTokens(counter, path, read.content) };
  return { status: read.kind === 'outside' ? 'missing' : read.kind, tokens: null };
}

export function toSpecFile(
  doc: ScannedDoc,
  status: 'ok' | 'too_large',
  tokens: number | null,
): SpecFile {
  return {
    path: doc.path,
    folder: folderOf(doc.path),
    category: categoryOf(doc.path),
    size: doc.size,
    updated_at: doc.mtime,
    tokens,
    status,
  };
}
