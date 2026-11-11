import { describe, expect, it } from 'vitest';
import { QUALITY_PRESETS, type RendererOptions } from '@lions/render';
import { withSoftParticles } from './soft-flag';
import { SANDBOX_FLAGS, readFlags, sandboxHelp } from './sandbox-help';

const opts = (q: 'high' | 'medium' | 'low' = 'high'): RendererOptions => ({ quality: QUALITY_PRESETS[q] }) as RendererOptions;
const P = (s: string): URLSearchParams => new URLSearchParams(s);

describe('&soft (GH-1227 slice 2)', () => {
  it('parses as a bare sandbox flag, off when absent', () => {
    expect(readFlags(P('?sandbox=qarn_hadid&soft')).soft).toBe(true);
    expect(readFlags(P('?sandbox=qarn_hadid')).soft).toBe(false);
  });
  it('is in the flag table with a catalogue label, and in the help text', () => {
    expect(SANDBOX_FLAGS.find((f) => f.name === 'soft')?.labelKey).toBe('freePlay.option.soft');
    expect(sandboxHelp({ mapId: 'm', mapIds: ['m'], on: [] })).toContain('&soft');
  });
  it('turns quality.softParticles on in a sandbox, for every preset, and keeps the rest of the preset', () => {
    for (const q of ['high', 'medium', 'low'] as const) {
      const r = withSoftParticles(opts(q), P('?soft'), true);
      expect(r.options.quality?.softParticles).toBe(true);
      expect({ ...r.options.quality, softParticles: undefined }).toEqual({ ...QUALITY_PRESETS[q], softParticles: undefined });
      expect(r.warning).toBeUndefined();
    }
  });
  it('is refused outside a sandbox, with a warning, and changes nothing', () => {
    const o = opts();
    const r = withSoftParticles(o, P('?soft'), false);
    expect(r.options).toBe(o);
    expect(r.options.quality?.softParticles).not.toBe(true);
    expect(r.warning).toMatch(/sandbox-only/);
  });
  it('absent changes nothing: the same options object, and no preset has it on', () => {
    const o = opts();
    expect(withSoftParticles(o, P('?sandbox=x'), true).options).toBe(o);
    for (const q of Object.values(QUALITY_PRESETS)) expect(q.softParticles).not.toBe(true);
  });
});
