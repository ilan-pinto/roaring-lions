/**
 * The one adapter between a running mission and `alerts.ts`'s `AlertWorld`.
 *
 * It lived inline in `main.ts` until WP-P5, where no test could reach it --
 * importing `main.ts` boots the app. Pulled out so the alert layer can be
 * fed by a REAL `Sim` and `MissionRuntime` in a test (`alert-world.test.ts`)
 * through exactly the adapter the game uses, rather than through a fixture
 * that agrees with the model by construction.
 *
 * Read-only on the sim (invariant 4): every member reads state the sim and
 * the runtime already hold. Nothing here adds an event.
 */
import { fx, type MissionJson, type MissionRuntime, type Sim } from '@lions/sim';
import type { Place } from './alert-place';
import type { AlertTier, AlertWave, AlertWorld } from './alerts';
import { reinforceTrigger } from './mission-notice';
import { objectivePoint, type MinimapMap } from './minimap';

type Point = { x: number; y: number };

export interface AlertWorldDeps {
  sim: Sim;
  /** Null in a sandbox, which has no mission. Read through a thunk because
   *  `main.ts` assigns its runtime after the adapter is built. */
  runtime: () => MissionRuntime | null;
  mission: MissionJson | null;
  map: Pick<MinimapMap, 'zones' | 'markers'>;
  /** Display names by unit type id (`@lions/data`'s `units`). */
  units: Readonly<Record<string, { name?: string } | undefined>>;
  /** Where a tile point lies from the camera, right now (`main.ts` asks the
   *  renderer's projection; a test hands in a rule). */
  placeOf: (x: number, y: number) => Place;
}

export function alertWorldFor(d: AlertWorldDeps): AlertWorld {
  const { sim, map } = d;
  const markerAt = (name: string): Point | null => {
    const m = map.markers[name];
    return m === undefined ? null : { x: m[0] + 0.5, y: m[1] + 0.5 };
  };
  const typeOf = (entity: number): string => sim.unitTypes[sim.state.typeIdx[entity]]?.id ?? '';
  return {
    /**
     * `posOf` reads the position of an entity that is usually DEAD -- that is
     * the whole point of `unitLost` -- which is safe because the sim clears
     * `alive` and leaves `posX`/`posY` where the casualty fell. The bounds
     * guard is not defensive noise: an id past `entityCount` would read
     * `undefined` out of a typed array and turn into `NaN` through
     * `fx.toNumber`, which flashes nowhere and jumps the camera to nowhere,
     * silently.
     */
    posOf: (entity) => {
      if (entity < 0 || entity >= sim.entityCount) return null;
      return { x: fx.toNumber(sim.state.posX[entity]), y: fx.toNumber(sim.state.posY[entity]) };
    },
    sideOf: (entity) => sim.state.side[entity],
    typeOf,
    // The same lookup the deploy panel's `broughtFor` caller uses, so a feed
    // line and a briefing line name a unit the same way.
    unitName: (typeId) => d.units[typeId]?.name ?? typeId,
    // Through `minimap.ts`'s own `objectivePoint`, so the camera lands on the
    // diamond the minimap drew, by construction.
    objectiveAt: (id) => {
      const o = d.runtime()?.objectiveList.find((x) => x.id === id);
      return o === undefined ? null : objectivePoint(o, map);
    },
    placeOf: d.placeOf,
    lossTier: (entity, typeId): AlertTier => {
      // A named veteran is a loss the brigade remembers (WP-G-E4's memorial).
      if (d.runtime()?.rosterEntryOf(entity)?.name !== undefined) return 'major';
      const type = sim.unitTypes.find((u) => u.id === typeId);
      if (type === undefined) return 'important';
      // A kamikaze drone ends its own life on purpose: spent ordnance, not a
      // loss that changes the plan.
      if (type.isKamikaze) return 'important';
      return type.isAir || type.wheeled ? 'major' : 'important';
    },
    waves: (d.mission?.enemy?.waves ?? []) as readonly AlertWave[],
    objectiveDone: (id) => d.runtime()?.objectiveList.find((o) => o.id === id)?.status === 'complete',
    markerAt,
    arrivedAt: (typeId) => {
      // The dock's unit is the newest of its type on the player's side: the
      // runtime spawns it in the same tick it reports `built`.
      for (let i = sim.entityCount - 1; i >= 0; i--) {
        if (sim.state.side[i] !== 0 || sim.state.alive[i] !== 1) continue;
        if (typeOf(i) !== typeId) continue;
        return { x: fx.toNumber(sim.state.posX[i]), y: fx.toNumber(sim.state.posY[i]) };
      }
      return null;
    },
    reinforcement: (triggerId) => {
      const r = reinforceTrigger<{ marker?: string; at?: readonly number[] }>(d.mission ?? undefined, triggerId);
      if (r === null) return null;
      const points: Point[] = [];
      for (const u of r.units) {
        const p = u.marker !== undefined ? markerAt(u.marker) : u.at !== undefined ? { x: u.at[0] + 0.5, y: u.at[1] + 0.5 } : null;
        if (p) points.push(p);
      }
      return { label: r.label, points };
    },
  };
}
