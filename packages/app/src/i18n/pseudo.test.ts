// packages/app/src/i18n/pseudo.test.ts
import { describe, expect, it } from 'vitest';
import { pseudo } from './pseudo';

describe('pseudo', () => {
  it('accents every letter, pads by about a third, and brackets the result', () => {
    const p = pseudo('Deploy');
    expect(p.startsWith('⟦') && p.endsWith('⟧')).toBe(true);
    expect(p).not.toContain('Deploy');
    expect(p.length).toBeGreaterThanOrEqual('Deploy'.length + 2 + 2);
  });
  it('leaves interpolated values alone', () => {
    expect(pseudo('Conduct 88')).toContain('88');
  });
  it('is stable for the same input', () => {
    expect(pseudo('Campaign')).toBe(pseudo('Campaign'));
  });
  it('leaves HTML tags alone but still accents the text between them', () => {
    const p = pseudo('<b>Enemy reinforcements</b> inbound');
    expect(p).toContain('<b>');
    expect(p).toContain('</b>');
    expect(p.startsWith('⟦') && p.endsWith('⟧')).toBe(true);
    expect(p).not.toContain('Enemy');
    expect(p).not.toContain('reinforcements');
    expect(p).not.toContain('inbound');
  });
});
