/**
 * Who holds a building, and whether the person looking may be told -- the
 * ONE rule the banner (`garrison-banner.ts`), the minimap outline and the
 * HUD's "2 / 4 inside" all read, so the three cannot disagree about a
 * building the fog is hiding.
 *
 * THE RULE (lead ruling 2026-10-14): a building held by the viewer's own
 * side always shows; one held by anyone else shows only while a tile of it
 * is in sight right now -- in single-player and in a versus room alike.
 * Before this, the held badge was drawn through fog in single-player (only a
 * versus seat was gated, N1a final review), so a player could read an
 * enemy-held building, and how many men were in it, off the dark.
 *
 * Pure and free of `THREE` and `ThreeRenderer`: fog is injected as a
 * predicate, `observed.ts`'s split, so the app's HUD and minimap call the
 * same functions through `@lions/render` rather than agreeing with them.
 */
import { isOwnSide } from '../../relation';

/** The structure and unit reads the rule needs; a `Sim` is one. */
export interface HeldView {
  readonly structureCount: number;
  readonly structures: {
    readonly alive: ArrayLike<number>;
    readonly occupants: ArrayLike<number>;
    readonly typeIdx: ArrayLike<number>;
    readonly minX: ArrayLike<number>;
    readonly minY: ArrayLike<number>;
    readonly maxX: ArrayLike<number>;
    readonly maxY: ArrayLike<number>;
  };
  readonly structureTypes: readonly { readonly garrisonSlots: number }[];
  readonly state: {
    readonly alive: ArrayLike<number>;
    readonly side: ArrayLike<number>;
    readonly garrisonedIn: ArrayLike<number>;
  };
  structureAt(x: number, y: number): number;
}

/** One held building as the viewer may know it. */
export interface HeldBuilding {
  readonly s: number;
  /** The first living occupant's side. */
  readonly holder: number;
  readonly occupants: number;
  readonly slots: number;
}

/**
 * Every living structure with a living unit inside, and that unit's side, in
 * one pass over the first `entityCount` entities (the renderer passes the
 * count it last snapshotted). Unfiltered: what the VIEWER may know is
 * `heldShown`.
 *
 * Held means a LIVING occupant, not `occupants > 0`. The sim cannot kill a
 * man inside a building (`applyDamage` skips him; a collapse empties it and
 * zeroes the count), but `debugKill` can, and leaves the count standing --
 * the retired badge read that as "no side found" and drew it in the hostile
 * colour. Nobody inside is nobody's.
 */
export function heldBuildings(view: HeldView, entityCount: number): HeldBuilding[] {
  const str = view.structures;
  const n = view.structureCount;
  const holder = new Int16Array(n).fill(-2);
  let any = false;
  for (let s = 0; s < n; s++) {
    if (str.alive[s] !== 0 && str.occupants[s] > 0) {
      holder[s] = -1;
      any = true;
    }
  }
  const out: HeldBuilding[] = [];
  if (!any) return out;
  const st = view.state;
  for (let i = 0; i < entityCount; i++) {
    if (st.alive[i] !== 1) continue;
    const s = st.garrisonedIn[i];
    if (s >= 0 && s < n && holder[s] === -1) holder[s] = st.side[i];
  }
  for (let s = 0; s < n; s++) {
    if (holder[s] < 0) continue;
    out.push({ s, holder: holder[s], occupants: str.occupants[s], slots: view.structureTypes[str.typeIdx[s]].garrisonSlots });
  }
  return out;
}

/** `heldBuildings` for one structure: null unless `s` stands with a living
 *  unit inside. The HUD's question, asked of the building under a hover. */
export function heldBuilding(view: HeldView, s: number, entityCount: number): HeldBuilding | null {
  const str = view.structures;
  if (s < 0 || s >= view.structureCount || str.alive[s] === 0 || str.occupants[s] === 0) return null;
  const st = view.state;
  for (let i = 0; i < entityCount; i++) {
    if (st.alive[i] === 1 && st.garrisonedIn[i] === s) {
      return { s, holder: st.side[i], occupants: str.occupants[s], slots: view.structureTypes[str.typeIdx[s]].garrisonSlots };
    }
  }
  return null;
}

/** True when any tile of structure `s`'s own footprint is in sight. The
 *  bounding box can hold tiles that are not the structure's, so each is
 *  checked against `structureAt` -- the renderer's `structureInSight`. */
export function structureInSight(view: HeldView, s: number, isVisible: (wx: number, wy: number) => boolean): boolean {
  const str = view.structures;
  for (let y = str.minY[s]; y <= str.maxY[s]; y++) {
    for (let x = str.minX[s]; x <= str.maxX[s]; x++) {
      if (view.structureAt(x, y) === s && isVisible(x + 0.5, y + 0.5)) return true;
    }
  }
  return false;
}

/** Whether `viewer` may be shown that `b` is held, and by whom: always for
 *  its own side, otherwise only while a tile of it is in sight. */
export function heldShown(
  view: HeldView,
  b: HeldBuilding,
  viewer: number,
  isVisible: (wx: number, wy: number) => boolean
): boolean {
  return isOwnSide(b.holder, viewer) || structureInSight(view, b.s, isVisible);
}
