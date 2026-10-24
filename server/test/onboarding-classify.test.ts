import { describe, it, expect } from 'vitest';
import {
  classifyGenerationError,
  isRetryable,
  isSchemaFailure,
} from '../src/modules/onboarding/classify.js';
import { ERROR_MESSAGES, httpError } from '../src/modules/onboarding/constants.js';
import { GenerationAbort } from '../src/modules/onboarding/domain.js';
import { ExternalServiceError } from '../src/platform/errors.js';

const err = (props: Record<string, unknown>, message = 'boom', name = 'Error') =>
  Object.assign(new Error(message), { name }, props);

describe('isSchemaFailure — exact adapter texts', () => {
  it.each([
    new ExternalServiceError('OpenAI structured output failed schema validation', { raw: 'x' }),
    new ExternalServiceError('Anthropic structured output failed schema validation', { raw: 'x' }),
    new Error('OpenRouter structured output failed schema validation for OnboardingTourDraft'),
  ])('detects %s', (e) => {
    expect(isSchemaFailure(e)).toBe(true);
  });
  it('rejects others', () => {
    expect(isSchemaFailure(new Error('nope'))).toBe(false);
    expect(isSchemaFailure(undefined)).toBe(false);
  });
});

describe('isRetryable (AC60)', () => {
  it('retries schema failure, 429, 503, ECONNRESET, APIConnectionError', () => {
    expect(isRetryable(new Error('OpenAI structured output failed schema validation'))).toBe(true);
    expect(isRetryable(err({ status: 429 }))).toBe(true);
    expect(isRetryable(err({ status: 503 }))).toBe(true);
    expect(isRetryable(err({ code: 'ECONNRESET' }))).toBe(true);
    expect(isRetryable(err({}, 'Connection error.', 'APIConnectionError'))).toBe(true);
  });
  it('does not retry 400, timeouts, deadline abort', () => {
    expect(isRetryable(err({ status: 400 }))).toBe(false);
    expect(isRetryable(err({}, 'x', 'TimeoutError'))).toBe(false);
    expect(isRetryable(err({}, 'Request timed out.', 'APIConnectionTimeoutError'))).toBe(false);
    expect(isRetryable(new GenerationAbort('deadline'))).toBe(false);
    expect(isRetryable(new GenerationAbort('context_too_large'))).toBe(false);
  });
});

describe('classifyGenerationError (AC79)', () => {
  it('maps each class to its fixed text', () => {
    expect(classifyGenerationError(new GenerationAbort('deadline'))).toBe(ERROR_MESSAGES.deadline);
    expect(classifyGenerationError(err({}, 'x', 'TimeoutError'))).toBe(ERROR_MESSAGES.deadline);
    expect(classifyGenerationError(err({}, 'Request timed out.', 'APIConnectionTimeoutError'))).toBe(
      ERROR_MESSAGES.deadline,
    );
    expect(classifyGenerationError(new GenerationAbort('context_too_large'))).toBe(
      ERROR_MESSAGES.contextTooLarge,
    );
    expect(classifyGenerationError(new Error('Anthropic structured output failed schema validation'))).toBe(
      ERROR_MESSAGES.schema,
    );
    expect(classifyGenerationError(err({ code: 'ECONNREFUSED' }, 'connect ECONNREFUSED 1.2.3.4'))).toBe(
      ERROR_MESSAGES.network,
    );
    expect(classifyGenerationError(new Error('whatever'))).toBe(ERROR_MESSAGES.unexpected);
    expect(classifyGenerationError('string')).toBe(ERROR_MESSAGES.unexpected);
  });

  it('includes a three-digit status and never the raw text', () => {
    const msg = classifyGenerationError(err({ status: 502 }, 'secret sk-abc leaked'));
    expect(msg).toBe(httpError(502));
    expect(msg).not.toContain('sk-abc');
    expect(msg).toMatch(/HTTP \d{3}\)$/);
  });

  it('every text fits the 200-char job.error contract', () => {
    for (const m of Object.values(ERROR_MESSAGES)) expect(m.length).toBeLessThanOrEqual(200);
  });
});
