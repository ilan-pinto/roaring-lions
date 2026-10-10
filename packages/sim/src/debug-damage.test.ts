// `Sim.debugDamageStructure` -- the dev hook the damage-state capture sheet
// drives (GH-31, A3.2 remainder). It must grind a building through the SAME
// path a hit takes, so the renderer sees a `structureHit`, and it must never
// heal: a replay cannot see it (nothing in a mission calls it), so the only
// thing to pin is that it does what the sheet needs and nothing else.
import { describe, expect, it } from 'vitest';
import { fx } from './fixed';
import { Sim } from './sim';

function world(): { sim: Sim; s: number } {
  const sim = new Sim({ seed: 1, width: 4, height: 4, capacity: 1 });
  const type = sim.addStructureType({ id: 'shanty', hp_per_tile: 200, height_px: 11, color: 'dust.1' });
  const s = sim.addStructure(type, [0, 1]);
  sim.tick();
  return { sim, s };
}

describe('Sim.debugDamageStructure', () => {
  it('lands exactly on eighths/8 of max HP, and says so as a structureHit', () => {
    const { sim, s } = world();
    const max = sim.structures.maxHp[s];
    sim.debugDamageStructure(s, 3);
    expect(sim.structures.hp[s]).toBe(fx.mul(max, fx.div(fx.fromInt(3), fx.fromInt(8))));
    const events = sim.tick();
    const hit = events.find((e) => e.kind === 'structureHit');
    expect(hit).toBeDefined();
    expect(hit && hit.kind === 'structureHit' ? hit.structure : -1).toBe(s);
    expect(hit && hit.kind === 'structureHit' ? hit.by : 0).toBe(-1);
    expect(sim.structures.alive[s]).toBe(1);
  });

  it('never heals: a building already below the band is left alone', () => {
    const { sim, s } = world();
    sim.debugDamageStructure(s, 2);
    const hp = sim.structures.hp[s];
    sim.tick();
    sim.debugDamageStructure(s, 6);
    expect(sim.structures.hp[s]).toBe(hp);
    expect(sim.tick().some((e) => e.kind === 'structureHit')).toBe(false);
  });

  it('levels the building at band 0 through damageStructure\'s own zero check', () => {
    const { sim, s } = world();
    sim.debugDamageStructure(s, 0);
    expect(sim.structures.alive[s]).toBe(0);
    const kinds = sim.tick().map((e) => e.kind);
    expect(kinds).toContain('structureHit');
    expect(kinds).toContain('structureDestroyed');
  });

  it('clamps the band to 0..8 and ignores a dead structure', () => {
    const { sim, s } = world();
    const max = sim.structures.maxHp[s];
    sim.debugDamageStructure(s, 11);
    expect(sim.structures.hp[s]).toBe(max);
    sim.debugDamageStructure(s, -3);
    expect(sim.structures.alive[s]).toBe(0);
    sim.tick();
    sim.debugDamageStructure(s, 4);
    expect(sim.tick().some((e) => e.kind === 'structureHit')).toBe(false);
  });
});
