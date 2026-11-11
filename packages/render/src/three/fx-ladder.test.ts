/**
 * Polish VR-22 / VR-23: explosion strength in EVENT order.
 *
 * The lead's ruling (2026-10-08): building collapse > vehicle destroyed >
 * shell landing > muzzle flash, for each of light, screen shake and hit-stop.
 * A level that has none may stay none only if every level above it is larger
 * -- which a strict `>` chain already says.
 *
 * Each level is read at its STRONGEST, through the very functions the renderer
 * calls (`blastLightSpec`, `blastShake`, `blastHitStopMs`) at the power term the
 * renderer hands them, never at the authored number alone. That is the whole
 * point: a shell's light is multiplied by `SHELL_PROFILES[kind].impactPower`
 * (0.3 / 0.45) and a muzzle's is not multiplied at all, so comparing authored
 * values would pass a ladder the player sees inverted (an authored 2.0 shell
 * against a 3.8 muzzle was a 0.9 against a 3.8 on screen).
 *
 * - collapse: `structure_collapse` at `explosionBurstPowerFromFootprint` of the
 *   reference footprint (3x3, power 1). Twelve-tile houses ship.
 * - vehicle kill: `catastrophic_kill` at `explosionBurstPowerFromMaxHp` of the
 *   roster's largest hull, read from `data/units` (the Lavi, 3000 hp, power 1).
 * - shell landing: `shell_impact` at the largest indirect `impactPower`, and
 *   (GH-1197) every munition class on the shell rung whose `blast_from` is
 *   `'class'` (heavy artillery: the 155 and the Grad), at its own row through
 *   `munitionLightSpec`/`munitionShake`/`munitionHitStopMs` -- the functions
 *   the renderer calls. A ladder that read only `SHELL_PROFILES` would stop
 *   guarding the order the moment a round's look moved to the class table.
 * - muzzle flash: every `weapon_fire` emitter's light, plus `rpg_backblast`'s
 *   for a class a launcher team fires from a tube (`shellKindFor` -> missile),
 *   because ONE shot spawns both lights (`ThreeRenderer.onFire`/
 *   `spawnBackblast`). The fire path pushes no shake and no hit-stop, so the
 *   muzzle level has none of either -- and the second describe holds the data
 *   to that, so a shake authored on a fire emitter cannot hide as dead data.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WEAPON_CLASS } from '@lions/sim';
import type { EmitterSpec } from '../vfx/emitters';
import { blastHitStopMs, blastLightSpec, blastShake, munitionHitStopMs, munitionLightSpec, munitionShake } from './blast-spec';
import { MUNITIONS, munitionRow, type MunitionClassId } from './munitions';
import { AIR_STRIKE_IMPACT_POWER, BARRAGE_IMPACT_POWER } from './support-air';
import { explosionBurstPowerFromFootprint, explosionBurstPowerFromMaxHp } from './units/explosion-burst';
import { SHELL_PROFILES, shellKindFor } from './units/shells';

const VFX_DIR = new URL('../../../../data/vfx/', import.meta.url);
const UNITS_DIR = new URL('../../../../data/units/', import.meta.url);

function emitters(): EmitterSpec[] {
  return readdirSync(VFX_DIR)
    // GH-1197: `munitions.json` is the munition-class table, not an emitter.
    .filter((f) => f.endsWith('.json') && f !== 'munitions.json')
    .map((f) => JSON.parse(readFileSync(new URL(f, VFX_DIR), 'utf8')) as EmitterSpec);
}

function byId(id: string): EmitterSpec {
  const em = emitters().find((e) => e.id === id);
  if (!em) throw new Error(`no emitter "${id}" in data/vfx`);
  return em;
}

function unitHps(): number[] {
  const out: number[] = [];
  const walk = (dir: URL): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) walk(new URL(`${ent.name}/`, dir));
      else if (ent.name.endsWith('.json')) {
        const u = JSON.parse(readFileSync(new URL(ent.name, dir), 'utf8')) as { hull?: { hp?: number } };
        if (typeof u.hull?.hp === 'number') out.push(u.hull.hp);
      }
    }
  };
  walk(UNITS_DIR);
  return out;
}

interface Level {
  light: number;
  shake: number;
  hitStop: number;
}

function blastLevel(em: EmitterSpec, power: number): Level {
  return {
    light: blastLightSpec(em, power)?.intensity ?? 0,
    shake: blastShake(em, power)?.amplitudePx ?? 0,
    hitStop: blastHitStopMs(em, power),
  };
}

/**
 * GH-1197: which rung each munition class sits on. LITERALS, and every class in
 * `munitions.json` must be named here (the coverage case below), so a new class
 * cannot slip off the ladder unread.
 */
const SHELL_RUNG: readonly MunitionClassId[] = ['grenade', 'mortar', 'direct_he', 'heavy_artillery', 'blade'];
const SUPPORT_RUNG: readonly MunitionClassId[] = ['air_strike'];
const DEMOLITION_RUNG: readonly MunitionClassId[] = ['demolition'];

/** A munition class's level, through the renderer's own functions. The light is read at the class's largest
 *  mapped splash (its radius grows with S; its intensity does not). */
function classLevel(cls: MunitionClassId): Level {
  const row = munitionRow(cls);
  return {
    light: munitionLightSpec(row, row.reference_splash_tiles)?.intensity ?? 0,
    shake: munitionShake(row)?.amplitudePx ?? 0,
    hitStop: munitionHitStopMs(row),
  };
}

/** The shell-rung classes the renderer DRAWS from their row (Phase 1: heavy artillery). */
function drawnShellClasses(): MunitionClassId[] {
  return SHELL_RUNG.filter((c) => MUNITIONS.classes[c]?.blast_from === 'class');
}

/** The four levels, each at its strongest, as the renderer would spawn them. */
function ladder(): { collapse: Level; kill: Level; shell: Level; muzzle: Level } {
  const collapsePower = explosionBurstPowerFromFootprint(0, 0, 2, 2);
  const killPower = Math.max(...unitHps().map((hp) => explosionBurstPowerFromMaxHp(hp)));
  const shellPower = Math.max(
    ...Object.values(SHELL_PROFILES)
      .filter((p) => p.indirect)
      .map((p) => p.impactPower)
  );
  const backblast = byId('rpg_backblast').light?.intensity ?? 0;
  const muzzleLights = emitters()
    .filter((e) => e.trigger === 'weapon_fire' && e.id !== 'rpg_backblast')
    .flatMap((e) =>
      (e.weapon_classes ?? []).map((cls) => {
        const own = e.light?.intensity ?? 0;
        return shellKindFor(WEAPON_CLASS[cls]) === 'missile' ? own + backblast : own;
      })
    );
  const emitterShell = blastLevel(byId('shell_impact'), shellPower);
  const classShells = drawnShellClasses().map(classLevel);
  const strongest = (key: keyof Level): number => Math.max(emitterShell[key], ...classShells.map((l) => l[key]));
  return {
    collapse: blastLevel(byId('structure_collapse'), collapsePower),
    kill: blastLevel(byId('catastrophic_kill'), killPower),
    shell: { light: strongest('light'), shake: strongest('shake'), hitStop: strongest('hitStop') },
    // The fire path reads `light` and nothing else (`ThreeRenderer.onFire`).
    muzzle: { light: Math.max(...muzzleLights), shake: 0, hitStop: 0 },
  };
}

describe('explosion strength follows the event (VR-22)', () => {
  it('reads every level at a real power: the references the power functions name are reached', () => {
    // A ladder built on a power no shipped event can reach would be a ladder
    // about nothing. Both reference events exist: a 3000 hp hull and a
    // footprint of at least nine tiles.
    expect(Math.max(...unitHps().map((hp) => explosionBurstPowerFromMaxHp(hp)))).toBe(1);
    expect(explosionBurstPowerFromFootprint(28, 10, 31, 12)).toBe(1);
  });

  for (const key of ['light', 'shake', 'hitStop'] as const) {
    it(`ranks ${key}: collapse > vehicle kill > shell landing > muzzle flash`, () => {
      const l = ladder();
      const row = `collapse ${l.collapse[key]}, kill ${l.kill[key]}, shell ${l.shell[key]}, muzzle ${l.muzzle[key]}`;
      expect(l.collapse[key], row).toBeGreaterThan(l.kill[key]);
      expect(l.kill[key], row).toBeGreaterThan(l.shell[key]);
      expect(l.shell[key], row).toBeGreaterThan(l.muzzle[key]);
    });
  }
});

describe('the munition classes are on the ladder (GH-1197)', () => {
  it('names every class in munitions.json on exactly one rung', () => {
    const named = [...SHELL_RUNG, ...SUPPORT_RUNG, ...DEMOLITION_RUNG];
    expect(new Set(named).size).toBe(named.length);
    expect(Object.keys(MUNITIONS.classes).sort()).toEqual([...named].sort());
  });

  it('reads at least one drawn class into the shell level (the 155 anchor)', () => {
    // An empty list would leave the ladder guarding only SHELL_PROFILES, vacuously.
    expect(drawnShellClasses()).toContain('heavy_artillery');
  });

  for (const key of ['light', 'shake', 'hitStop'] as const) {
    it(`every shell-rung class row, drawn yet or not, sits under a vehicle kill on ${key}`, () => {
      const kill = ladder().kill[key];
      for (const cls of SHELL_RUNG) expect(classLevel(cls)[key], cls).toBeLessThan(kill);
    });
  }

  it('freezes the frame for no shell class (the lead, 9 Nov)', () => {
    for (const cls of SHELL_RUNG) expect(classLevel(cls).hitStop, cls).toBe(0);
  });
});

describe('the fire-support detonations (GH-748, the lead 22 Oct)', () => {
  it('air strike > barrage round > an emitter-drawn shell landing, on light and shake', () => {
    const strike = blastLevel(byId('air_strike_impact'), AIR_STRIKE_IMPACT_POWER);
    const round = blastLevel(byId('barrage_impact'), BARRAGE_IMPACT_POWER);
    const shellPower = Math.max(
      ...Object.values(SHELL_PROFILES)
        .filter((p) => p.indirect)
        .map((p) => p.impactPower)
    );
    const shell = blastLevel(byId('shell_impact'), shellPower);
    for (const key of ['light', 'shake'] as const) {
      const row = `strike ${strike[key]}, barrage ${round[key]}, shell ${shell[key]}`;
      expect(strike[key], row).toBeGreaterThan(round[key]);
      expect(round[key], row).toBeGreaterThan(shell[key]);
    }
  });

  // GH-1197: the 155 anchor's approved 4 px shake EQUALS a barrage round's (5 px x 0.8), and its light (3.2)
  // sits under the round's (4.2 x 0.8 = 3.36). So the drawn heavy classes sit at or under a barrage round, and
  // strictly under the strike; the strict order above stays on the emitter-drawn landings.
  it('a drawn heavy class sits under the strike, and at or under a barrage round', () => {
    const strike = blastLevel(byId('air_strike_impact'), AIR_STRIKE_IMPACT_POWER);
    const round = blastLevel(byId('barrage_impact'), BARRAGE_IMPACT_POWER);
    for (const cls of drawnShellClasses()) {
      const l = classLevel(cls);
      expect(l.light, cls).toBeLessThan(round.light);
      expect(l.shake, cls).toBeLessThanOrEqual(round.shake);
      expect(l.light, cls).toBeLessThan(strike.light);
      expect(l.shake, cls).toBeLessThan(strike.shake);
    }
  });
  it('freezes the frame 60 ms on the strike and never on a barrage round', () => {
    expect(blastLevel(byId('air_strike_impact'), AIR_STRIKE_IMPACT_POWER).hitStop).toBeCloseTo(60, 9);
    expect(blastLevel(byId('barrage_impact'), BARRAGE_IMPACT_POWER).hitStop).toBe(0);
  });
});

describe('firing never shakes the screen (VR-23)', () => {
  it('no weapon_fire emitter authors a screen_shake', () => {
    const fire = emitters().filter((e) => e.trigger === 'weapon_fire');
    // Every fire_* file plus rpg_backblast: an empty list would pass vacuously.
    expect(fire.length).toBeGreaterThanOrEqual(8);
    for (const e of fire) expect(e.screen_shake, e.id).toBeUndefined();
  });
});

describe('only the ranked blasts jolt or freeze the screen (GH-85)', () => {
  // The renderer reads `screen_shake` and `hit_stop_ms` on the ladder's own
  // events and nowhere else (the schema's `screen_shake` description). An
  // emitter outside that set authoring either would be a rung nobody ranked
  // -- or dead data that reads as a promise. `missile_impact` shakes (P-4)
  // and is the HEAT landing, a shell-class event with no freeze of its own.
  // GH-748 adds the two fire-support detonations, ranked by the lead on 22 Oct:
  // the air strike above a vehicle kill's freeze, a barrage round with a shake
  // and no freeze.
  const BLASTS = new Set(['structure_collapse', 'catastrophic_kill', 'shell_impact', 'missile_impact', 'barrage_impact', 'air_strike_impact']);

  it('no emitter outside the blasts authors screen_shake or hit_stop_ms', () => {
    const offenders = emitters()
      .filter((e) => !BLASTS.has(e.id))
      .filter((e) => e.screen_shake !== undefined || (e.hit_stop_ms ?? 0) > 0)
      .map((e) => e.id);
    expect(offenders).toEqual([]);
  });
});
