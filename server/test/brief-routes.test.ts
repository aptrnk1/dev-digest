import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrBrief, PrBriefState } from '@devdigest/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { MockAuthProvider } from '../src/adapters/mocks.js';
import { BriefDomainError } from '../src/modules/brief/domain.js';

const svc = vi.hoisted(() => ({ get: vi.fn(), generate: vi.fn() }));
vi.mock('../src/modules/brief/compose.js', () => ({ createBriefService: () => svc }));

const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
const ID = '11111111-1111-4111-8111-111111111111';
const app = () => buildApp({ config, overrides: { auth: new MockAuthProvider() } });
const brief = {
  summary: 's', intent: null, intent_stale: false, blast: null, risks: { risks: [] }, review_focus: [],
  history: { history: [] }, missing_inputs: [], head_sha: 'x', generated_at: '2026-10-24T10:00:00.000Z',
  model: 'm', cost_usd: null,
};

beforeEach(() => {
  svc.get.mockReset().mockResolvedValue({ brief: null, stale: false });
  svc.generate.mockReset().mockResolvedValue(brief);
});

describe('GET /pulls/:id/brief', () => {
  it('200 PrBriefState', async () => {
    const res = await (await app()).inject({ method: 'GET', url: `/pulls/${ID}/brief` });
    expect(res.statusCode).toBe(200);
    expect(PrBriefState.safeParse(res.json()).success).toBe(true);
  });
  it('404 and 422 (non-uuid)', async () => {
    svc.get.mockRejectedValue(new BriefDomainError('pr_not_found', 'nf'));
    const a = await app();
    expect((await a.inject({ method: 'GET', url: `/pulls/${ID}/brief` })).statusCode).toBe(404);
    expect((await a.inject({ method: 'GET', url: '/pulls/nope/brief' })).statusCode).toBe(422);
  });
});

describe('POST /pulls/:id/brief', () => {
  it('200 PrBrief', async () => {
    const res = await (await app()).inject({ method: 'POST', url: `/pulls/${ID}/brief` });
    expect(res.statusCode).toBe(200);
    expect(PrBrief.safeParse(res.json()).success).toBe(true);
  });
  it('422 for non-uuid', async () => {
    expect((await (await app()).inject({ method: 'POST', url: '/pulls/nope/brief' })).statusCode).toBe(422);
  });
  it.each([
    ['pr_not_found', 404],
    ['brief_in_progress', 409],
    ['llm_not_configured', 422],
    ['brief_failed', 502],
  ] as const)('%s -> %i', async (code, status) => {
    svc.generate.mockRejectedValue(new BriefDomainError(code, 'msg'));
    const res = await (await app()).inject({ method: 'POST', url: `/pulls/${ID}/brief` });
    expect(res.statusCode).toBe(status);
    expect(JSON.stringify(res.json())).toContain(code);
  });
});
