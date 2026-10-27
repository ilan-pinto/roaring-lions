/**
 * "2 / 4 inside" (lead ruling 2026-10-14): how many men a held building
 * holds, and how many it can. The world used to say it with a pip per man
 * on the held badge over the roof; the badge is retired for a banner in the
 * holder's colour (`@lions/render`'s `units/garrison-banner.ts`), and the
 * count moves to the HUD, as kit moved to the icons.
 *
 * Two places ask: the unit card, for a selected unit that is inside a
 * building, and the held tag beside a hovered building -- the building under
 * the pointer, or the one a hovered unit is inside. Both read the banner's
 * own rule (`heldBuilding`/`heldShown`), so a building whose banner the fog
 * hides gives no count either: your own always, anyone else's only while a
 * tile of it is in sight.
 *
 * Pure: the sim, the fog and the hover are passed in.
 */
import { heldBuilding, heldShown, isOwnSide, type HeldView } from '@lions/render';

export interface HeldReadout {
  readonly s: number;
  /** The building type's display name. */
  readonly name: string;
  /** Units inside, and the places it has. */
  readonly n: number;
  readonly cap: number;
  /** Held by the viewer's own side. */
  readonly own: boolean;
}

/** `HeldView` plus the type's name, which the readout prints. */
export interface HeldReadoutView extends HeldView {
  readonly structureTypes: readonly { readonly garrisonSlots: number; readonly name: string }[];
}

/**
 * The building a hover is about: the one under the pointer, else the one the
 * first hovered unit is inside, else -1. `hoverUnits` is the hovered hostile
 * and the hovered friendly, either -1 when there is none.
 */
export function heldHoverTarget(garrisonedIn: ArrayLike<number>, hoverStructure: number, hoverUnits: readonly number[]): number {
  if (hoverStructure >= 0) return hoverStructure;
  for (const i of hoverUnits) {
    if (i >= 0 && i < garrisonedIn.length && garrisonedIn[i] >= 0) return garrisonedIn[i];
  }
  return -1;
}

/** What the viewer may be told about structure `s`: null when it is not held,
 *  or held by another side and out of sight. */
export function heldReadout(
  view: HeldReadoutView,
  s: number,
  entityCount: number,
  viewer: number,
  isVisible: (wx: number, wy: number) => boolean
): HeldReadout | null {
  const b = heldBuilding(view, s, entityCount);
  if (!b || !heldShown(view, b, viewer, isVisible)) return null;
  const type = view.structureTypes[view.structures.typeIdx[s]];
  return { s, name: type.name, n: b.occupants, cap: b.slots, own: isOwnSide(b.holder, viewer) };
}

/**
 * GH-588 (ruling G4): a unit inside a building whose every weapon is barred
 * from firing out of a window (`fires_from_building: false`, the mortar and
 * the rocket) is silent, and the card says why. Read off the weapons the sim
 * itself consults (`WeaponStats.firesFromBuilding`), never off a unit id, so a
 * future rocket team gets the line with no change here. An unarmed unit is
 * not silent because of the building, so it gets none.
 */
export function silentInBuilding(garrisoned: boolean, weapons: readonly { readonly firesFromBuilding: boolean }[]): boolean {
  return garrisoned && weapons.length > 0 && !weapons.some((w) => w.firesFromBuilding);
}
