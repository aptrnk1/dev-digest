import { describe, it, expect } from 'vitest';
import { OpenAIProvider } from '../src/adapters/llm/openai.js';
import { AnthropicProvider } from '../src/adapters/llm/anthropic.js';
import { Container } from '../src/platform/container.js';
import { ConfigError } from '../src/platform/errors.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import type { SecretsProvider } from '@devdigest/shared';
import type { AppConfig } from '../src/platform/config.js';
import type { Db } from '../src/db/client.js';
import { z } from 'zod';

function countingFetch(status: number) {
  const calls = { n: 0 };
  const fn = (async () => {
    calls.n++;
    return new Response(JSON.stringify({ error: { message: 'boom' } }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const req = {
  model: 'm',
  messages: [{ role: 'user' as const, content: 'hi' }],
  schema: z.object({ a: z.string() }),
  schemaName: 'T',
  maxRetries: 0,
};

describe.each([429, 503])('transport limits, status %i', (status) => {
  it('OpenAIProvider makes exactly one HTTP request', async () => {
    const { fn, calls } = countingFetch(status);
    const p = new OpenAIProvider('k', { maxRetries: 0, timeoutMs: 5000, fetch: fn });
    await expect(p.completeStructured(req)).rejects.toBeTruthy();
    expect(calls.n).toBe(1);
  });

  it('AnthropicProvider makes exactly one HTTP request', async () => {
    const { fn, calls } = countingFetch(status);
    const p = new AnthropicProvider('k', { maxRetries: 0, timeoutMs: 5000, fetch: fn });
    await expect(p.completeStructured(req)).rejects.toBeTruthy();
    expect(calls.n).toBe(1);
  });
});

function container(secrets: Record<string, string>, overrides = {}) {
  const sp = {
    get: async (k: string) => secrets[k],
    set: async () => {},
    delete: async () => {},
  } as unknown as SecretsProvider;
  return new Container({ secretsPath: '/x' } as AppConfig, {} as Db, { secrets: sp, ...overrides });
}

describe('container.llmWithLimits', () => {
  it.each(['openai', 'anthropic', 'openrouter'] as const)('%s without key throws ConfigError', async (id) => {
    await expect(container({}).llmWithLimits(id, { maxRetries: 0, timeoutMs: 1000 })).rejects.toBeInstanceOf(
      ConfigError,
    );
  });

  it('builds a fresh provider per call when a key exists', async () => {
    const c = container({ OPENAI_API_KEY: 'k' });
    const a = await c.llmWithLimits('openai', { maxRetries: 0, timeoutMs: 1000 });
    const b = await c.llmWithLimits('openai', { maxRetries: 0, timeoutMs: 1000 });
    expect(a).not.toBe(b);
  });

  it('override returns the injected provider', async () => {
    const mock = new MockLLMProvider();
    const c = container({}, { llmWithLimits: () => mock });
    expect(await c.llmWithLimits('openai', { maxRetries: 0, timeoutMs: 1 })).toBe(mock);
  });
});
