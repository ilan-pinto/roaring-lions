/**
 * GH-941: the enemy AA gun's tracer must be the KDF autocannon's tracer, only
 * red. Both fire a `bolt` through the SAME batch with the SAME profile, so
 * what could differ is the colour pair, and until this fix the hostile half of
 * that pair was `vfx.ember` -- under the bolt's 4x HDR gain a dim orange that
 * did not read as the same weapon as the own half's white-hot lime.
 *
 * Real unit JSON (`ifv_namer`'s `cannon_30`, `gun_truck`'s `zu23_twin`), a real
 * `Sim`, the sim's own `fire` events handed to `ThreeRenderer.onEvents`, and
 * the colour buffer the bolt batch ACTUALLY writes -- the wiring, which
 * `fx.test.ts`'s pure `shellStreakHex` cases cannot see.
 */
import { describe, it, expect, vi } from 'vitest';
import { Sim, WEAPON_CLASS, fx, type SimEvent, type UnitTypeJson } from '@lions/sim';
import type { RendererOptions, TerrainTones } from '../api';
import { ThreeRenderer } from './ThreeRenderer';
import { SHELL_PROFILES, shellKindForWeapon, type ShellModel } from './units/shells';
import { hexToLinear } from './terrain/shared';
import { BLOOM_THRESHOLD, linearLuminance } from './bloom';
import { HDR_GAINS, streakKindGain } from './units/hdr-gains';
import ifvNamer from '../../../../data/units/kdf/ifv_namer.json';
import gunTruck from '../../../../data/units/enemy/gun_truck.json';
import infSquad from '../../../../data/units/kdf/inf_squad.json';
import sarimRifles from '../../../../data/units/enemy/sarim_rifles.json';
import apcEitan from '../../../../data/units/kdf/apc_eitan.json';
import technical from '../../../../data/units/enemy/technical.json';
import mortarTeam from '../../../../data/units/kdf/mortar_team.json';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    outputColorSpace = actual.SRGBColorSpace;
    domElement: unknown = {};
    setClearColor(): void {}
    getContext(): { isContextLost(): boolean } {
      return { isContextLost: () => false };
    }
    forceContextLoss(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

const TONES: TerrainTones = {
  open: '#C8B494', cover: ['#8F9464', '#6E7449', '#4E5433'],
  blocked: '#3A3C33', underBuilding: '#23241F', road: '#E6D8BE', rut: '#4E5433',
  rock: '#8E9491', rockLit: '#F2E8D5', earth: '#6E7449', low: '#8F9464',
  trunk: '#4E5433', trunkLit: '#8F9464', leafDark: '#333821', leafMid: '#4E5433',
  leafLit: '#6E7449', bladeLit: '#8F9464', bladeShade: '#4E5433', spoil: '#6E7449',
  crownRatio: 0.52, scatter: 'stone',
  groveFamily: 'desert_tree',
  haze: '#E0B87A',
};

/** The shipped colours, spelled as `renderer-options.ts` resolves them:
 *  `vfx.tracer` / `vfx.ember` for the pair, `team.hostile` for slot 1. */
const TRACER = '#B8FF5A';
const EMBER = '#E8541E';
const HOSTILE = '#D93A2B';

function makeOpts(viewerSide: 0 | 1): RendererOptions {
  return {
    background: '#14150F',
    teamColors: ['#2F6FD9', HOSTILE, '#C8B494'],
    hullColors: ['#8F9464', '#6E7449', '#4E5433'],
    infantryColors: ['#8F9464', '#6E7449', '#4E5433'],
    groupColors: ['#C8B494', '#6E7449', '#8E9491', '#3A3C33', '#E6D8BE', '#4E5433', '#8E9491', '#F2E8D5', '#6E7449'],
    terrainTones: TONES,
    tracerColors: [TRACER, EMBER],
    shellColors: ['#FFB43C', EMBER],
    flashColor: '#FFB43C',
    nearMissColor: '#6E7449',
    interceptColor: '#8E9491',
    viewerSide,
  };
}

const TARGET: UnitTypeJson = {
  id: 't_target',
  role: 'infantry',
  hull: { hp: 100000, armor: { front: 10, side: 10, rear: 10 } },
  mobility: { speed_tiles_s: 0 },
  sensors: { optics: 1, sight_tiles: 1 },
  weapons: [],
};

/** A shooter of `side`, 7 tiles from a target of the other side, ticked until
 *  it fires. Same geometry for every caller, so two runs are comparable. */
function fireOf(json: unknown, side: 0 | 1, viewerSide: 0 | 1): { renderer: ThreeRenderer; weaponId: string } {
  const sim = new Sim({ seed: 7, width: 32, height: 32, capacity: 8 });
  const shooterType = sim.addUnitType(json as UnitTypeJson);
  const targetType = sim.addUnitType(TARGET);
  const shooter = sim.spawn(shooterType, side, fx.from(4), fx.from(4));
  sim.spawn(targetType, 1 - side, fx.from(11), fx.from(4));
  for (let t = 0; t < 400; t++) {
    const events = sim.tick();
    const fire = events.find((e): e is Extract<SimEvent, { kind: 'fire' }> => e.kind === 'fire' && e.shooter === shooter);
    if (fire) {
      const renderer = new ThreeRenderer(sim, makeOpts(viewerSide));
      renderer.snapshot();
      renderer.onEvents(events);
      return { renderer, weaponId: fire.weaponId };
    }
  }
  throw new Error('never fired');
}

interface Privates {
  bolts: ShellModel[];
  shellBatch: { mesh: { geometry: { attributes: { aColor: { array: Float32Array } } } } };
  boltBatch: {
    mesh: { geometry: { attributes: { aColor: { array: Float32Array }; aAlpha: { array: Float32Array } } } };
  };
  updateFx(ms: number): void;
}
const priv = (r: ThreeRenderer): Privates => r as unknown as Privates;

/** What the bolt batch wrote for the first streak after one frame: its colours
 *  and alphas, plus the speed it flies at. The muzzle point differs by unit
 *  (the Namer's turret, the truck's hull), so world positions are not compared:
 *  speed, width (the profile) and the fade are what the KIND decides. */
function drawn(r: ThreeRenderer): { rgb: number[]; alpha: number[]; kind: string; speed: number; apexPx: number } {
  const p = priv(r);
  const b0 = p.bolts[0];
  const speed = Math.hypot(b0.tx - b0.sx, b0.ty - b0.sy) / b0.duration;
  p.updateFx(1000 / 60);
  const quads = 6; // SHELL_TRAIL_SEGMENTS
  const a = p.boltBatch.mesh.geometry.attributes;
  return {
    rgb: [...a.aColor.array.slice(0, quads * 12)],
    alpha: [...a.aAlpha.array.slice(0, quads * 4)],
    kind: p.bolts[0].kind,
    speed,
    apexPx: p.bolts[0].apexPx,
  };
}

const lin = (hex: string): number[] => [...hexToLinear(hex)];
/** Every vertex of the first streak carries `rgb` (the bolt's kind gain is 1). */
const allVertices = (buf: number[], rgb: number[]): boolean => buf.every((v, i) => Math.abs(v - rgb[i % 3]) < 1e-3);
/** Every vertex is `hex`'s hue (the same channel ratios) at `luminance`. */
const allVerticesAt = (buf: number[], hex: string, luminance: number): boolean => {
  const [r, g, b] = lin(hex);
  const k = luminance / linearLuminance(r, g, b);
  return allVertices(buf, [r * k, g * k, b * k]);
};

describe('GH-941: the enemy AA gun draws the KDF autocannon tracer, in red', () => {
  const kdf = fireOf(ifvNamer, 0, 0);
  const aa = fireOf(gunTruck, 1, 0);
  const kdfDrawn = drawn(kdf.renderer);
  const aaDrawn = drawn(aa.renderer);

  it('both weapons are autocannons that route to the same bolt profile', () => {
    expect(kdfDrawn.kind).toBe('bolt');
    expect(aaDrawn.kind).toBe('bolt');
    const clsOf = (json: { weapons: { id: string; type: string }[] }, id: string): string => json.weapons.find((w) => w.id === id)?.type ?? '';
    expect(clsOf(ifvNamer, kdf.weaponId)).toBe('autocannon');
    expect(clsOf(gunTruck, aa.weaponId)).toBe('autocannon');
    expect(shellKindForWeapon(WEAPON_CLASS.autocannon, 'zu23_twin')).toBe('bolt');
    expect(shellKindForWeapon(WEAPON_CLASS.autocannon, 'cannon_30')).toBe('bolt');
    expect(SHELL_PROFILES[kdfDrawn.kind as 'bolt'].widthPx).toBe(SHELL_PROFILES[aaDrawn.kind as 'bolt'].widthPx);
  });

  it('shape, length, speed, fade and glow are identical: only the colour differs', () => {
    expect(aaDrawn.speed).toBeCloseTo(SHELL_PROFILES.bolt.speedTilesS, 3);
    expect(kdfDrawn.speed).toBeCloseTo(SHELL_PROFILES.bolt.speedTilesS, 3);
    expect(aaDrawn.apexPx).toBe(kdfDrawn.apexPx);
    expect(aaDrawn.alpha).toEqual(kdfDrawn.alpha);
    expect(aaDrawn.rgb).not.toEqual(kdfDrawn.rgb);
    // The same kind gain on both: the streak colour is the palette colour, linear, times 1.
    expect(allVertices(kdfDrawn.rgb, lin(TRACER))).toBe(true);
    // The enemy streak is the hostile hue at the SAME luminance as the lime one:
    // bloom thresholds luminance, and the red alone sits under it (hostileStreakGain).
    const own = linearLuminance(...(lin(TRACER) as [number, number, number]));
    expect(allVerticesAt(aaDrawn.rgb, HOSTILE, own)).toBe(true);
  });

  it('the hostile streak is the hostile team colour, not vfx.ember', () => {
    const own = linearLuminance(...(lin(TRACER) as [number, number, number]));
    expect(allVerticesAt(aaDrawn.rgb, EMBER, own)).toBe(false);
    const [r, g, b] = lin(HOSTILE);
    expect(r).toBeGreaterThan(8 * Math.max(g, b));
  });

  it('both sides bloom alike: the two streaks have the same pre-bloom luminance, over the threshold', () => {
    const lum = (buf: number[]): number => linearLuminance(buf[0], buf[1], buf[2]);
    expect(lum(aaDrawn.rgb)).toBeCloseTo(lum(kdfDrawn.rgb), 4);
    // x the bolt's uHdr (4): the own streak is over BLOOM_THRESHOLD, the raw red would not be.
    expect(lum(kdfDrawn.rgb) * HDR_GAINS.bolt).toBeGreaterThan(BLOOM_THRESHOLD);
    expect(linearLuminance(...(lin(HOSTILE) as [number, number, number])) * HDR_GAINS.bolt).toBeLessThan(BLOOM_THRESHOLD);
  });

  it('colour follows hostility to the viewer, not the faction: the KDF round is red to a Sarim seat', () => {
    const asSarimKdf = drawn(fireOf(ifvNamer, 0, 1).renderer);
    const asSarimAa = drawn(fireOf(gunTruck, 1, 1).renderer);
    expect(allVerticesAt(asSarimKdf.rgb, HOSTILE, linearLuminance(...(lin(TRACER) as [number, number, number])))).toBe(true);
    expect(allVertices(asSarimAa.rgb, lin(TRACER))).toBe(true);
    expect(asSarimKdf.alpha).toEqual(asSarimAa.alpha);
  });
});

/**
 * GH-941 follow-up (lead, 1 Nov): the rifle and mg streaks get the same
 * treatment as the bolt. Each hostile kind is the hostile hue at the luminance of
 * ITS OWN kind's own-side streak (the kind gain 0.45 / 0.6 included), not the
 * bolt's. Arcing rounds keep ember.
 */
describe('GH-941: hostile rifle and mg streaks are red at their own-kind luminance', () => {
  const own = linearLuminance(...(lin(TRACER) as [number, number, number]));
  const cases = [
    { kind: 'rifle', ownJson: infSquad, hostileJson: sarimRifles },
    { kind: 'mg', ownJson: apcEitan, hostileJson: technical },
  ] as const;
  for (const c of cases) {
    it(`${c.kind}: own side lime x its kind gain, the other army the hostile hue at that luminance`, () => {
      const gain = streakKindGain(c.kind);
      expect(gain).toBeLessThan(1);
      const mine = drawn(fireOf(c.ownJson, 0, 0).renderer);
      const theirs = drawn(fireOf(c.hostileJson, 1, 0).renderer);
      expect(mine.kind).toBe(c.kind);
      expect(theirs.kind).toBe(c.kind);
      expect(allVertices(mine.rgb, lin(TRACER).map((v) => v * gain))).toBe(true);
      expect(allVerticesAt(theirs.rgb, HOSTILE, own * gain)).toBe(true);
      // not ember, and not the bolt's luminance
      expect(allVerticesAt(theirs.rgb, EMBER, own * gain)).toBe(false);
      expect(allVerticesAt(theirs.rgb, HOSTILE, own)).toBe(false);
      // the same glow: with the 4x gain the hostile streak is over the bloom threshold exactly as the own one is
      const lum = (buf: number[]): number => linearLuminance(buf[0], buf[1], buf[2]);
      expect(lum(theirs.rgb)).toBeCloseTo(lum(mine.rgb), 4);
      expect(lum(theirs.rgb) * HDR_GAINS.bolt).toBeGreaterThan(BLOOM_THRESHOLD);
    });
  }

  it('an arcing round from the other army keeps vfx.ember (GH-149)', () => {
    const r = fireOf(mortarTeam, 1, 0).renderer;
    const p = priv(r);
    p.updateFx(1000 / 60);
    const rgb = [...p.shellBatch.mesh.geometry.attributes.aColor.array.slice(0, 12)];
    expect(allVertices(rgb, lin(EMBER))).toBe(true);
  });
});
