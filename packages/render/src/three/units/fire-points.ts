/**
 * A crew-served weapon's fire points (unit polish, 14 Oct): where on its own
 * mesh a round leaves, a backblast blows out and a baseplate kicks up dust.
 *
 * `atgm_cell` and `mortar_crew` are not squad rigs (their weapon rides one
 * shared `prop` bone), so neither gets `squad-rig.ts`'s launcher backblast,
 * and both used to fire from the renderer's generic guess -- the unit centre
 * plus 0.4 tile along its bearing, at the ground. The motion pass and
 * `mortar-graft.ts` measure the real points on the weapon's own vertices and
 * write them to the GLB's scene extras as `rl_fire` (metres, the GLB's own
 * frame: +X forward, +Y up, +Z the figures' right). Presentation only: the
 * sim never sees them.
 */
import { MESH_UNITS_PER_TILE } from './mesh-anim';

export type FirePoint = readonly [number, number, number];

export interface FirePoints {
  /** Where the round leaves -- the flash, the muzzle emitter, the round's path. */
  readonly muzzle?: FirePoint;
  /** A launcher's rear: its backblast blows out of here, away from the bearing. */
  readonly backblast?: FirePoint;
  /** A mortar's baseplate: the ground it slams on the shot. */
  readonly base?: FirePoint;
}

const KEYS = ['muzzle', 'backblast', 'base'] as const;

/** `rl_fire`, validated: a malformed entry is dropped with the file named. */
export function parseFireExtras(raw: unknown, label: string): FirePoints | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'object' || raw === null) {
    console.warn(`mesh-unit: ${label} declares rl_fire as ${typeof raw}, not an object -- ignored`);
    return undefined;
  }
  const out: { -readonly [K in (typeof KEYS)[number]]?: FirePoint } = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(KEYS as readonly string[]).includes(k)) {
      console.warn(`mesh-unit: ${label} declares rl_fire."${k}", not one of ${KEYS.join('/')} -- ignored`);
      continue;
    }
    if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
      console.warn(`mesh-unit: ${label} declares a malformed rl_fire."${k}" -- ignored`);
      continue;
    }
    out[k as (typeof KEYS)[number]] = [v[0], v[1], v[2]];
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * A fire point carried into the map: tile x/y and height above the unit's
 * ground in world units. The mesh root is scaled by `1 / MESH_UNITS_PER_TILE`
 * and turned by `meshYawFromFacing` (`rotation.y = -bearing`), so the GLB's
 * +X lies along the bearing and its +Z, the right hand, a quarter turn
 * clockwise on the map: (-sin, cos).
 */
export function firePointOnMap(p: FirePoint, x: number, y: number, bearingRad: number): { x: number; y: number; up: number } {
  const c = Math.cos(bearingRad);
  const s = Math.sin(bearingRad);
  return {
    x: x + (p[0] * c - p[2] * s) / MESH_UNITS_PER_TILE,
    y: y + (p[0] * s + p[2] * c) / MESH_UNITS_PER_TILE,
    up: p[1] / MESH_UNITS_PER_TILE,
  };
}
