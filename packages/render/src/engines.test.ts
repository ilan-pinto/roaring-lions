// The engine loops' rules (GH-35), without an AudioContext: which family a
// unit type gets, the idle/moving crossfade, the voice cap and the speed
// ramp. The WebAudio half is audio-engines.test.ts.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { unitTypeFromJson, type UnitTypeJson } from '@lions/sim';
import {
  ENGINE_OVERSPEED,
  ENGINE_RAMP_S,
  ENGINE_XFADE,
  engineCrossfade,
  engineFamilyOf,
  engineLayerMix,
  engineVariantFor,
  rampToward,
  selectEngineVoices,
  speedShare,
  type EngineSpec,
} from './engines';
import audioManifest from '../../../data/audio.json';

const ROOT = join(__dirname, '..', '..', '..');
const SPEC = (audioManifest as { engines?: EngineSpec }).engines;

/** Every shipped unit JSON, read off disk so a new unit is covered by itself. */
function shippedUnits(): UnitTypeJson[] {
  const out: UnitTypeJson[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.json')) out.push(JSON.parse(readFileSync(p, 'utf8')) as UnitTypeJson);
    }
  };
  walk(join(ROOT, 'data', 'units'));
  return out;
}

describe('engine family (tracked / wheeled / rotor / silent)', () => {
  const families = new Map(shippedUnits().map((u) => [u.id, engineFamilyOf(SPEC, unitTypeFromJson(u))]));

  it('the data declares the three families', () => {
    expect(Object.keys(SPEC?.families ?? {}).sort()).toEqual(['rotor', 'tracked', 'wheeled']);
  });

  it('tracked: the Lavi (and its ambush twin), the Namer, the D9 and the two Te\'o guns -- and only they carry the clank', () => {
    const tracked = [...families].filter(([, f]) => f === 'tracked').map(([id]) => id).sort();
    expect(tracked).toEqual(['dozer_d9', 'ifv_namer', 'mbt_lavi', 'mbt_lavi_camo', 'spg_cluster', 'spg_long_range', 'veh_ambulance']); // GH-709: the ambulance is the Namer's hull
    expect(SPEC?.families?.tracked?.clank).toBe('track_clank');
    for (const [name, layers] of Object.entries(SPEC?.families ?? {})) {
      if (name !== 'tracked') expect(layers.clank, name).toBeUndefined();
    }
  });

  it('every shipped unit that declares `gear: "tracks"` plays the tracked loop (GH-709)', () => {
    // A sweep, not a name list: the two GH-709 tracked hulls shipped once without a by_type
    // line and would have played the wheeled loop. Falsified: with spg_long_range's by_type
    // line deleted, this goes red.
    const tracksDeclared = shippedUnits().filter((u) => (u.mobility as { gear?: string }).gear === 'tracks');
    expect(tracksDeclared.length).toBeGreaterThan(0);
    for (const u of tracksDeclared) expect(families.get(u.id), u.id).toBe('tracked');
  });

  it('the D9 is tracked, not wheeled, although its flag says wheels-or-tracks: by_type names it', () => {
    // GH-598: the D9's JSON says `wheeled: true` (it was foot by its `engineer`
    // role until then), and `wheeled` means wheels OR tracks.
    const d9 = shippedUnits().find((u) => u.id === 'dozer_d9');
    expect(d9).toBeDefined();
    if (!d9) return;
    expect(unitTypeFromJson(d9).wheeled).toBe(true);
    expect(families.get('dozer_d9')).toBe('tracked');
    // Falsification: without its by_type line the D9 falls to the flag default,
    // and plays the wheeled loop.
    const byType = Object.fromEntries(Object.entries(SPEC?.by_type ?? {}).filter(([id]) => id !== 'dozer_d9'));
    const without: EngineSpec = { ...SPEC, by_type: byType };
    expect(engineFamilyOf(without, unitTypeFromJson(d9))).toBe('wheeled');
  });

  it('the wheeled APCs (Eitan 8x8, Kipod 6x6), the scout car, the jeep and the trucks are wheeled', () => {
    for (const id of ['apc_eitan', 'apc_kipod', 'scout_shachaf', 'jeep_shoded', 'technical', 'gun_truck', 'rocket_battery']) {
      expect(families.get(id), id).toBe('wheeled');
    }
  });

  it('rotor: both Peten helicopters, the Yanshuf and the medevac; every other air unit is silent', () => {
    expect(families.get('heli_peten')).toBe('rotor');
    expect(families.get('heli_peten_gunship')).toBe('rotor');
    expect(families.get('heli_yanshuf')).toBe('rotor'); // GH-698
    expect(families.get('air_medevac_heli')).toBe('rotor'); // GH-709
    for (const id of ['recon_drone', 'attack_drone', 'loiter_drone', 'paramotor']) expect(families.get(id), id).toBeNull();
  });

  it('a foot unit is silent', () => {
    for (const id of ['inf_squad', 'mortar_team', 'manpad_team', 'sniper_team', 'yahalom_squad', 'civilians']) {
      expect(families.get(id), id).toBeNull();
    }
  });

  it('`none` in by_type silences a vehicle; a family the data does not declare is silence, not a crash', () => {
    const facts = { id: 'jeep_shoded', isAir: false, wheeled: true };
    expect(engineFamilyOf({ ...SPEC, by_type: { jeep_shoded: 'none' } }, facts)).toBeNull();
    expect(engineFamilyOf({ families: {} }, facts)).toBeNull();
    expect(engineFamilyOf(null, facts)).toBeNull();
  });

  it('every by_type id is a shipped unit', () => {
    for (const id of Object.keys(SPEC?.by_type ?? {})) expect(families.has(id), id).toBe(true);
  });
});

describe('engine candidate choice (data pick, &engines override)', () => {
  const loop = { pick: 'b', a: { file: 'a.ogg' }, b: { file: 'b.ogg' } };
  it('a mission plays the loop pick; the override wins', () => {
    expect(engineVariantFor(loop)?.file).toBe('b.ogg');
    expect(engineVariantFor(loop, 'a')?.file).toBe('a.ogg');
    expect(engineVariantFor({ ...loop, pick: undefined })?.file).toBe('a.ogg');
    expect(engineVariantFor({ ...loop, pick: 'zzz' })?.file).toBe('a.ogg');
  });
  it('every shipped loop picks a (provisional) and declares both candidates', () => {
    for (const [id, l] of Object.entries(SPEC?.loops ?? {})) {
      expect(l.pick, id).toBe('a');
      expect(l.a?.file, id).toMatch(/^engines\/.+_a\.ogg$/);
      expect(l.b?.file, id).toMatch(/^engines\/.+_b\.ogg$/);
    }
  });
});

describe('engine crossfade', () => {
  it('is all idle at rest and all moving at and above the band top', () => {
    expect(engineCrossfade(0)).toEqual({ idle: 1, move: 0 });
    expect(engineCrossfade(ENGINE_XFADE.lo)).toEqual({ idle: 1, move: 0 });
    const top = engineCrossfade(ENGINE_XFADE.hi);
    expect(top.idle).toBeCloseTo(0, 12);
    expect(top.move).toBe(1);
    expect(engineCrossfade(1).move).toBe(1);
  });

  it('is equal POWER across the band: idle^2 + move^2 = 1 everywhere', () => {
    for (let s = 0; s <= 1.0001; s += 0.01) {
      const { idle, move } = engineCrossfade(s);
      expect(idle * idle + move * move).toBeCloseTo(1, 12);
    }
    // An equal-GAIN (linear) crossfade dips 3 dB at the middle; this does not.
    const mid = engineCrossfade((ENGINE_XFADE.lo + ENGINE_XFADE.hi) / 2);
    expect(mid.idle).toBeCloseTo(Math.SQRT1_2, 12);
    expect(mid.move).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('is monotone: idle only falls and moving only rises with speed', () => {
    let prev = engineCrossfade(0);
    for (let s = 0.01; s <= 1; s += 0.01) {
      const cur = engineCrossfade(s);
      expect(cur.idle).toBeLessThanOrEqual(prev.idle);
      expect(cur.move).toBeGreaterThanOrEqual(prev.move);
      prev = cur;
    }
  });

  it('the layers: moving 0.9x -> 1.2x, idle 1x, clank silent at rest, rotor always turning', () => {
    expect(engineLayerMix('move', 0)).toEqual({ gain: 0, rate: 0.9 });
    expect(engineLayerMix('move', 1).rate).toBeCloseTo(1.2, 12);
    expect(engineLayerMix('move', 1).gain).toBe(1);
    expect(engineLayerMix('idle', 0)).toEqual({ gain: 1, rate: 1 });
    expect(engineLayerMix('idle', 1).rate).toBe(1);
    expect(engineLayerMix('clank', 0).gain).toBe(0);
    expect(engineLayerMix('clank', 1)).toEqual({ gain: 1, rate: 1.2 });
    expect(engineLayerMix('rotor', 0).gain).toBeGreaterThan(0.8);
    // The whine check ran up to 1.2x: no layer may play faster than that.
    for (const layer of ['idle', 'move', 'clank', 'rotor'] as const) {
      for (const s of [-1, 0, 0.5, 1, 7]) expect(engineLayerMix(layer, s).rate, `${layer} ${s}`).toBeLessThanOrEqual(1.2 + 1e-12);
    }
  });
});

describe('engine voice cap', () => {
  const c = (id: number, dist: number): { id: number; dist: number } => ({ id, dist });

  it('takes the nearest `cap`, nearest first', () => {
    const got = selectEngineVoices([c(1, 9), c(2, 1), c(3, 5), c(4, 3), c(5, 12), c(6, 2)], new Set(), 4, 2);
    expect(got).toEqual([2, 6, 4, 3]);
  });

  it('never more than the cap, and nothing at a cap of 0', () => {
    const many = Array.from({ length: 40 }, (_, i) => c(i, i));
    expect(selectEngineVoices(many, new Set(), 4, 2)).toHaveLength(4);
    expect(selectEngineVoices(many, new Set(), 0, 2)).toEqual([]);
    expect(selectEngineVoices([c(1, 1)], new Set(), 4, 2)).toEqual([1]);
  });

  it('a sounding vehicle keeps its slot until a rival is the hysteresis nearer', () => {
    // 1..4 are sounding; 5 is a newcomer at 4.5, 1.5 nearer than incumbent 4 at 6.
    const incumbents = new Set([1, 2, 3, 4]);
    expect(selectEngineVoices([c(1, 1), c(2, 2), c(3, 3), c(4, 6), c(5, 4.5)], incumbents, 4, 2)).not.toContain(5);
    // 2 tiles nearer exactly: the newcomer wins.
    expect(selectEngineVoices([c(1, 1), c(2, 2), c(3, 3), c(4, 6), c(5, 4)], incumbents, 4, 2)).toContain(5);
    // Without hysteresis the newcomer at 4.5 wins.
    expect(selectEngineVoices([c(1, 1), c(2, 2), c(3, 3), c(4, 6), c(5, 4.5)], incumbents, 4, 0)).toContain(5);
  });

  it('is deterministic on ties', () => {
    expect(selectEngineVoices([c(7, 3), c(2, 3), c(5, 3)], new Set(), 2, 2)).toEqual([2, 5]);
  });
});

describe('engine speed share and ramp', () => {
  it('the share is distance over the type’s own step, clamped to 1', () => {
    expect(speedShare(0, 0, 0.05)).toBe(0);
    expect(speedShare(0.03, 0.04, 0.05)).toBeCloseTo(1, 12);
    expect(speedShare(0.015, 0.02, 0.05)).toBeCloseTo(0.5, 12);
    expect(speedShare(0.06, 0, 0.05)).toBe(1);
  });
  it('a jump past the overspeed ceiling is a discontinuity, not motion', () => {
    expect(speedShare(0.05 * (ENGINE_OVERSPEED + 0.01), 0, 0.05)).toBeNull();
    expect(speedShare(500, 0, 0.05)).toBeNull();
  });
  it('the ramp is constant-rate: 0 -> 1 in ENGINE_RAMP_S, and back', () => {
    let s = 0;
    const ticks = Math.round(ENGINE_RAMP_S * 20);
    for (let i = 0; i < ticks - 1; i++) s = rampToward(s, 1, 0.05);
    expect(s).toBeLessThan(1);
    s = rampToward(s, 1, 0.05);
    expect(s).toBeCloseTo(1, 12);
    expect(rampToward(1, 1, 0.05)).toBe(1);
    expect(rampToward(1, 0, 0.05)).toBeCloseTo(1 - 0.05 / ENGINE_RAMP_S, 12);
  });
});
