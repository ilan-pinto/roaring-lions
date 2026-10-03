import { describe, expect, it } from 'vitest';
import { HUD_ELEMENTS } from '../ui/hud-elements';
import { hudVisibility, type TutorialHudJson } from './hud-visibility';
import { initTutorial, type StepJson, type TutorialState } from './runtime';

const step = (id: string): StepJson => ({ id, title: id, teach: id, await: { kind: 'elapsed_s', seconds: 1 } });

const TUT: TutorialHudJson = {
  hud_start: ['minimap'],
  steps: [{ reveal: ['card'] }, { reveal: ['orders', 'hint'] }, {}],
};
const steps = [step('a'), step('b'), step('c')];
const at = (index: number): TutorialState => ({ ...initTutorial(steps, 0), index, done: index >= steps.length });

describe('hudVisibility', () => {
  it('shows only hud_start plus the open step and every earlier reveal', () => {
    expect([...hudVisibility(at(0), TUT, null)].sort()).toEqual(['card', 'minimap']);
    expect([...hudVisibility(at(1), TUT, null)].sort()).toEqual(['card', 'hint', 'minimap', 'orders']);
    // A step with no reveal adds nothing and removes nothing.
    expect([...hudVisibility(at(2), TUT, null)].sort()).toEqual(['card', 'hint', 'minimap', 'orders']);
  });

  it('a running tutorial overrides the mission entirely', () => {
    const shown = hudVisibility(at(0), TUT, { hud: { hidden: ['minimap'] } });
    expect(shown.has('minimap')).toBe(true);
    expect(shown.has('dock')).toBe(false);
  });

  it('a finished or skipped tutorial shows everything the mission does not hide', () => {
    expect(hudVisibility(at(3), TUT, null).size).toBe(HUD_ELEMENTS.length);
    expect(hudVisibility(null, TUT, null).size).toBe(HUD_ELEMENTS.length);
    const quiet = hudVisibility(null, TUT, { hud: { hidden: ['dock', 'intel'] } });
    expect(quiet.has('dock')).toBe(false);
    expect(quiet.has('intel')).toBe(false);
    expect(quiet.size).toBe(HUD_ELEMENTS.length - 2);
  });

  it('a tutorial with no hud_start hides nothing', () => {
    expect(hudVisibility(at(0), { steps: TUT.steps }, null).size).toBe(HUD_ELEMENTS.length);
  });

  it('every mission with no hud block shows everything', () => {
    expect(hudVisibility(null, null, {}).size).toBe(HUD_ELEMENTS.length);
    expect(hudVisibility(null, null, null).size).toBe(HUD_ELEMENTS.length);
  });
});
