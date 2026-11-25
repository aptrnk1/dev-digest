import { describe, it, expect } from 'vitest';
import { applyCeiling, evidenceTier, meaningfulText } from '../src/modules/intent/domain.js';

const none = { specRead: false, ticketWithBody: false, ticketTitleOnly: false, descriptionChars: 0 };

describe('intent domain — evidence ceiling (spec §4)', () => {
  it('spec read → high / spec', () => {
    expect(evidenceTier({ ...none, specRead: true, descriptionChars: 500 })).toEqual({ ceiling: 'high', basis: 'spec' });
  });
  it('ticket with body → high / ticket; title only → medium / ticket', () => {
    expect(evidenceTier({ ...none, ticketWithBody: true })).toEqual({ ceiling: 'high', basis: 'ticket' });
    expect(evidenceTier({ ...none, ticketTitleOnly: true })).toEqual({ ceiling: 'medium', basis: 'ticket' });
  });
  it('description ≥ 80 meaningful chars → medium / description', () => {
    expect(evidenceTier({ ...none, descriptionChars: 80 })).toEqual({ ceiling: 'medium', basis: 'description' });
    expect(evidenceTier({ ...none, descriptionChars: 79 })).toEqual({ ceiling: 'low', basis: 'inferred' });
  });
  it('nothing → low / inferred', () => {
    expect(evidenceTier(none)).toEqual({ ceiling: 'low', basis: 'inferred' });
  });
});

describe('intent domain — applyCeiling', () => {
  it('the model can only lower the ceiling', () => {
    expect(applyCeiling('medium', 'high')).toBe('medium');
    expect(applyCeiling('high', 'low')).toBe('low');
    expect(applyCeiling('high', 'high')).toBe('high');
  });
  it('AC2: an empty body with model "high" ends low / inferred', () => {
    const tier = evidenceTier({ ...none, descriptionChars: meaningfulText('').length });
    expect(applyCeiling(tier.ceiling, 'high')).toBe('low');
    expect(tier.basis).toBe('inferred');
  });
});

describe('intent domain — meaningfulText', () => {
  it('drops comments, headings, checkboxes and whitespace', () => {
    const body = '## Summary\n<!-- fill me -->\n- [ ] tests\n- [x] docs\n\n   \nAdds a limiter.';
    expect(meaningfulText(body)).toBe('Adds a limiter.');
    expect(meaningfulText(null)).toBe('');
  });
});
