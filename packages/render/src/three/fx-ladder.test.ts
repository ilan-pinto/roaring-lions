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
 * - shell landing: `shell_impact` at the largest indirect `impactPower`.
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
import { blastHitStopMs, blastLightSpec, blastShake } from './blast-spec';
import { explosionBurstPowerFromFootprint, explosionBurstPowerFromMaxHp } from './units/explosion-burst';
import { SHELL_PROFILES, shellKindFor } from './units/shells';

const VFX_DIR = new URL('../../../../data/vfx/', import.meta.url);
const UNITS_DIR = new URL('../../../../data/units/', import.meta.url);

function emitters(): EmitterSpec[] {
  return readdirSync(VFX_DIR)
    .filter((f) => f.endsWith('.json'))
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
  return {
    collapse: blastLevel(byId('structure_collapse'), collapsePower),
    kill: blastLevel(byId('catastrophic_kill'), killPower),
    shell: blastLevel(byId('shell_impact'), shellPower),
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

describe('firing never shakes the screen (VR-23)', () => {
  it('no weapon_fire emitter authors a screen_shake', () => {
    const fire = emitters().filter((e) => e.trigger === 'weapon_fire');
    // Every fire_* file plus rpg_backblast: an empty list would pass vacuously.
    expect(fire.length).toBeGreaterThanOrEqual(8);
    for (const e of fire) expect(e.screen_shake, e.id).toBeUndefined();
  });
});
