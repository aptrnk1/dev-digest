import { ERROR_MESSAGES, httpError } from './constants.js';
import { GenerationAbort } from './domain.js';

const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ENETUNREACH',
]);

function field(err: unknown, key: string): unknown {
  return err && typeof err === 'object' ? (err as Record<string, unknown>)[key] : undefined;
}

function nameOf(err: unknown): string {
  const n = field(err, 'name');
  return typeof n === 'string' ? n : '';
}

function messageOf(err: unknown): string {
  const m = field(err, 'message');
  return typeof m === 'string' ? m : '';
}

function statusOf(err: unknown): number | undefined {
  const s = field(err, 'status') ?? field(err, 'statusCode');
  return typeof s === 'number' ? s : undefined;
}

/** "<Provider> structured output failed schema validation" (openai, anthropic, OpenRouterProvider). */
export function isSchemaFailure(err: unknown): boolean {
  return /structured output failed schema validation/i.test(messageOf(err));
}

function isTimeout(err: unknown): boolean {
  if (err instanceof GenerationAbort) return err.kind === 'deadline';
  const name = nameOf(err);
  return (
    name === 'TimeoutError' ||
    name === 'APIConnectionTimeoutError' ||
    field(err, 'code') === 'ETIMEDOUT' ||
    /timed? ?out/i.test(messageOf(err))
  );
}

function isNetwork(err: unknown): boolean {
  const code = field(err, 'code');
  return nameOf(err) === 'APIConnectionError' || (typeof code === 'string' && NETWORK_CODES.has(code));
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof GenerationAbort || isTimeout(err)) return false;
  if (isSchemaFailure(err) || isNetwork(err)) return true;
  const status = statusOf(err);
  return status !== undefined && (status === 429 || status >= 500);
}

/** One of the fixed AC79 texts; the raw error text never reaches the caller. */
export function classifyGenerationError(err: unknown): string {
  if (err instanceof GenerationAbort) {
    return err.kind === 'context_too_large' ? ERROR_MESSAGES.contextTooLarge : ERROR_MESSAGES.deadline;
  }
  if (isTimeout(err)) return ERROR_MESSAGES.deadline;
  if (isSchemaFailure(err)) return ERROR_MESSAGES.schema;
  const status = statusOf(err);
  if (status !== undefined && status >= 100 && status <= 999) return httpError(status);
  if (isNetwork(err)) return ERROR_MESSAGES.network;
  return ERROR_MESSAGES.unexpected;
}
