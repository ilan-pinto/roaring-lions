/**
 * The effects of a main gun being knocked out (the lead's ruling of 4 Nov): a brief smoke puff at the
 * moment, then a small fire at the turret ring for 8-15 s that dies down into the damage wisp the hull
 * already trails (`vehicle_damaged_smoke`). Both are VFX emitters (`data/vfx/gun_out_puff.json`,
 * `gun_out_fire.json`), spawned by name by the renderer.
 *
 * Presentation only, and dated off the SIM clock exactly as the wreck's smoulder is
 * (`trigger-fx.ts`, GH-85): a window opens at the knock-out TICK, slots are `interval` ms of
 * presentation sim time, the rolls are seeded by (entity, slot), and a frame emits only slots that have
 * come due, so a repaint at zero elapsed time emits nothing and a frozen frame repaints the same puffs.
 *
 * "Clearly smaller than a vehicle-kill fire": `catastrophic_kill` throws 18-26 flame dots of 10-22 px
 * and 10-16 smoke puffs of 24-52 px at once. This is one flame dot of 4-6 px a slot and a few embers,
 * thinning as it dies down.
 */
import { washRand } from './rotor-wash';
import { screenToWorldThree, worldToScreenThree } from '../camera';
import { WORLD_Y_PER_LIFT_PIXEL, type Camera, type Viewport } from '../../project';

export const GUN_OUT_PUFF_EMITTER_ID = 'gun_out_puff';
export const GUN_OUT_FIRE_EMITTER_ID = 'gun_out_fire';

/** How long the opening puff keeps throwing, sim ms. */
export const GUN_OUT_PUFF_MS = 600;
/** The puff's slot, sim ms: four windows of three puffs, a burst rather than a plume. */
export const GUN_OUT_PUFF_INTERVAL_MS = 150;
/** `ParticleSystem.spawn`'s magnitude for the puff. */
export const GUN_OUT_PUFF_MAGNITUDE = 0.5;

/** The fire lasts between these, sim seconds, a seeded draw per knock-out. */
export const GUN_OUT_FIRE_MIN_S = 8;
export const GUN_OUT_FIRE_MAX_S = 15;
/** One flame dot and a roll for embers per slot, sim ms. */
export const GUN_OUT_FIRE_INTERVAL_MS = 110;
/** The fire's magnitude at the knock-out, tapering to `GUN_OUT_FIRE_END_FRACTION` of it by the end. */
export const GUN_OUT_FIRE_MAGNITUDE = 0.5;
export const GUN_OUT_FIRE_END_FRACTION = 0.3;
/** The share of slots that throw at all at the start; it falls to `GUN_OUT_FIRE_END_FRACTION` of that at the end,
 *  so the flicker thins out as well as shrinking and the fire is gone into the wisp, not switched off. */
export const GUN_OUT_FIRE_DENSITY = 0.75;

/** Salts the presentation stream: the exhaust is +0x10000, the damage smoke +0x20000, the smoulder +0x30000. */
export const GUN_OUT_FX_SALT = 0x40000;

/** Where the fx sit: the puff leaves the muzzle end, the fire sits at the turret ring (tiles from the turret pivot). */
export const GUN_OUT_PUFF_REACH_TILES = 0.55;
export const GUN_OUT_FIRE_REACH_TILES = 0.08;
/**
 * How high above the ground the two sit, tiles. A particle has a ground position and no height of its own,
 * so a flame born at the turret's ground point draws on the hull's belly, not at the turret (the first
 * confirmation capture). The renderer shifts the spawn point by the ground distance that puts it where a
 * point this high would project (`liftShiftTiles`). A tile is 3 m: the turret ring is about 0.7 up, a drooped
 * muzzle about 0.6.
 */
export const GUN_OUT_FIRE_LIFT_TILES = 0.7;
export const GUN_OUT_PUFF_LIFT_TILES = 0.6;

let shiftProbe: { perTile: { x: number; y: number } } | null = null;
/**
 * The ground displacement, tiles, that a point `heightTiles` above the ground appears at on screen: the
 * camera's own answer (`worldToScreenThree` at that height, back to the ground plane), the one `pick.ts`
 * uses for the ground a body hides. It depends on the camera's pitch and yaw only -- not on zoom, not on
 * where the hull stands -- so it is measured once and scaled.
 */
export function liftShiftTiles(heightTiles: number): { x: number; y: number } {
  if (shiftProbe === null) {
    const cam: Camera = { x: 24, y: 24, zoom: 1 };
    const vp: Viewport = { width: 800, height: 600 };
    const top = worldToScreenThree(cam.x, cam.y, cam, vp, 1 / WORLD_Y_PER_LIFT_PIXEL);
    const g = screenToWorldThree(top.x, top.y, cam, vp);
    shiftProbe = { perTile: { x: g.x - cam.x, y: g.y - cam.y } };
  }
  return { x: shiftProbe.perTile.x * heightTiles, y: shiftProbe.perTile.y * heightTiles };
}

/** How long entity `entity`'s fire burns, in SIM seconds: a seeded draw in [MIN, MAX), the same on every machine. */
export function gunOutFireSeconds(entity: number): number {
  const r = washRand(entity + GUN_OUT_FX_SALT, 0xf1)();
  return GUN_OUT_FIRE_MIN_S + r * (GUN_OUT_FIRE_MAX_S - GUN_OUT_FIRE_MIN_S);
}

/** The fire's magnitude `ageMs` into a window of `lifeMs`: a linear taper to the end fraction. 0 outside it. */
export function gunOutFireMagnitude(ageMs: number, lifeMs: number): number {
  if (ageMs < 0 || ageMs >= lifeMs) return 0;
  return GUN_OUT_FIRE_MAGNITUDE * (1 - (1 - GUN_OUT_FIRE_END_FRACTION) * (ageMs / lifeMs));
}

/** Does slot `slot` of entity `entity`'s fire throw at all, `ageMs` into a window of `lifeMs`? A seeded roll against a density that thins. */
export function gunOutFireThrows(entity: number, slot: number, ageMs: number, lifeMs: number): boolean {
  if (ageMs < 0 || ageMs >= lifeMs) return false;
  const density = GUN_OUT_FIRE_DENSITY * (1 - (1 - GUN_OUT_FIRE_END_FRACTION) * (ageMs / lifeMs));
  return washRand(entity + GUN_OUT_FX_SALT, slot + 0x100)() < density;
}

/** One knock-out's two windows, in presentation sim ms. */
export interface GunOutFxWindow {
  readonly startMs: number;
  readonly puffEndMs: number;
  readonly fireEndMs: number;
}

/** The windows of a gun knocked out at presentation time `startMs` (`presentationSimMs(tick + 1, 0)`). */
export function gunOutWindow(entity: number, startMs: number): GunOutFxWindow {
  return {
    startMs,
    puffEndMs: startMs + GUN_OUT_PUFF_MS,
    fireEndMs: startMs + gunOutFireSeconds(entity) * 1000,
  };
}
