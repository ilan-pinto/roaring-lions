/**
 * GH-782: the app hands the plan the renderer built for an accepted fire-support
 * call to the audio, so the jet, the rotor and the whistles read the clock the
 * aircraft fly on. A source-text pin, in the style of ambience.test.ts: the
 * behaviour behind it is audio-support.test.ts (render) and
 * ThreeRenderer.support-plan.test.ts.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');

describe('main.ts wires an accepted support call to the audio', () => {
  it('passes renderer.supportCalled’s return value to audio.supportPlan, inside the accepted branch', () => {
    expect(main).toContain('audio.supportPlan(renderer.supportCalled(call, out.x, out.y, sim.tickCount + 1))');
    const accepted = main.indexOf('if (out.ok) {\n          renderer.addOrderMarker');
    const wired = main.indexOf('audio.supportPlan(renderer.supportCalled(');
    expect(accepted).toBeGreaterThan(0);
    expect(wired).toBeGreaterThan(accepted);
    // ...and nowhere a refused call could reach it.
    expect(main.match(/audio\.supportPlan\(/g)).toHaveLength(1);
  });

  it('feeds the support voices from the per-tick audio update, once, not from a second clock', () => {
    expect(main.match(/audio\.updateEngines\(/g)).toHaveLength(1);
  });
});
