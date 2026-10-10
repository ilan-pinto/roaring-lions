/**
 * VR-01: the colour-vision switch is live. The oracle is the palette's own
 * hex, as LITERALS copied out of `data/palette.json`'s
 * `reserved.team.variants` -- not `paletteTeamColors`, which is the code
 * under test's own source and would agree with any value it returned.
 */
import { describe, it, expect, vi } from 'vitest';
import { bindLiveTeamColors } from './live-team-colors';
import { DEFAULT_SETTINGS, settingsBus, type ColorVision, type Settings } from './settings';

const DEUTERANOPIA = ['#0072B2', '#D55E00', '#F0E442'];
const TRITANOPIA_NEUTRAL = '#CC79A7';

function withVision(v: ColorVision): Settings {
  return { ...DEFAULT_SETTINGS, accessibility: { ...DEFAULT_SETTINGS.accessibility, colorVision: v } };
}

function setUp() {
  const bus = settingsBus();
  const renderer = { setTeamColors: vi.fn<(t: [string, string, string], r: (k: string) => string) => void>() };
  const minimap = { setTeamColors: vi.fn<(t: readonly [string, string, string]) => void>() };
  const dispose = bindLiveTeamColors((fn) => bus.onChange(fn), 'default', { renderer, minimap });
  return { bus, renderer, minimap, dispose };
}

describe('bindLiveTeamColors (VR-01)', () => {
  it("a switch to deuteranopia hands the variant's team colours to the renderer and the minimap at once", () => {
    const w = setUp();
    w.bus.notify(withVision('deuteranopia'));
    expect(w.renderer.setTeamColors).toHaveBeenCalledTimes(1);
    const [team, resolve] = w.renderer.setTeamColors.mock.calls[0];
    expect(team).toEqual(DEUTERANOPIA);
    // The resolver is variant-aware: what the HP bar, the silhouettes and
    // the objective tint ask for by key.
    expect(resolve('team.kedem')).toBe('#0072B2');
    expect(resolve('team.neutral')).toBe('#F0E442');
    // Non-team keys are the plain palette.
    expect(resolve('scrub.0')).toBe('#6B8A4A');
    // The SAME array to both, so a dot and a ring cannot disagree.
    expect(w.minimap.setTeamColors).toHaveBeenCalledWith(team);
  });

  it('every variant in turn, and back to default', () => {
    const w = setUp();
    w.bus.notify(withVision('tritanopia'));
    expect(w.renderer.setTeamColors.mock.calls[0][0][2]).toBe(TRITANOPIA_NEUTRAL);
    w.bus.notify(withVision('protanopia'));
    expect(w.renderer.setTeamColors.mock.calls[1][0]).toEqual(DEUTERANOPIA);
    w.bus.notify(withVision('default'));
    expect(w.renderer.setTeamColors.mock.calls[2][0]).toEqual(['#2F6FD9', '#D93A2B', '#E8C33A']);
    expect(w.minimap.setTeamColors).toHaveBeenCalledTimes(3);
  });

  it('a settings change that is not colour vision re-colours nothing', () => {
    const w = setUp();
    w.bus.notify({ ...DEFAULT_SETTINGS, language: 'en' });
    w.bus.notify(withVision('default'));
    expect(w.renderer.setTeamColors).not.toHaveBeenCalled();
    expect(w.minimap.setTeamColors).not.toHaveBeenCalled();
  });

  it('the listener is gone after the battlefield disposer runs', () => {
    const w = setUp();
    w.dispose();
    w.bus.notify(withVision('deuteranopia'));
    expect(w.renderer.setTeamColors).not.toHaveBeenCalled();
    expect(w.minimap.setTeamColors).not.toHaveBeenCalled();
  });
});
