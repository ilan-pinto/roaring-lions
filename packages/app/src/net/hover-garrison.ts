/** The few structure reads `garrisonRoomShown` needs; a `Sim` is one. */
export interface StructureSight {
  readonly structures: {
    readonly occupants: ArrayLike<number>;
    readonly typeIdx: ArrayLike<number>;
    readonly minX: ArrayLike<number>;
    readonly minY: ArrayLike<number>;
    readonly maxX: ArrayLike<number>;
    readonly maxY: ArrayLike<number>;
  };
  readonly structureTypes: readonly { readonly garrisonSlots: number }[];
  structureAt(x: number, y: number): number;
}

/** True when any tile of structure `s`'s own footprint is in sight. The
 *  bounding box can hold tiles that are not the structure's, so each tile is
 *  checked against `structureAt` -- the renderer's `structureInSight` rule. */
export function structureInSight(view: StructureSight, s: number, isVisible: (wx: number, wy: number) => boolean): boolean {
  const st = view.structures;
  for (let y = st.minY[s]; y <= st.maxY[s]; y++) {
    for (let x = st.minX[s]; x <= st.maxX[s]; x++) {
      if (view.structureAt(x, y) === s && isVisible(x + 0.5, y + 0.5)) return true;
    }
  }
  return false;
}

/**
 * Whether the garrison hover (the doorway arrow, `hoverCanGarrison`) treats
 * structure `s` as having room inside.
 *
 * Single-player, and any building a versus seat can see: room is free slots,
 * exactly as main reads it. A building a versus seat CANNOT see is unknown
 * (N1a final review): reading its occupancy would tell the seat, by the
 * arrow appearing or not, whether the enemy has filled it. Unknown is read
 * as an EMPTY building of its type -- room whenever the type has any slot --
 * which is also what the click does: the resolver orders a garrison onto any
 * building whatever its occupancy, and a unit sent to a full one waits
 * outside. So the cursor and the order agree, and full and empty read alike.
 */
export function garrisonRoomShown(
  view: StructureSight,
  s: number,
  versus: boolean,
  isVisible: (wx: number, wy: number) => boolean
): boolean {
  const slots = view.structureTypes[view.structures.typeIdx[s]].garrisonSlots;
  if (versus && !structureInSight(view, s, isVisible)) return slots > 0;
  return view.structures.occupants[s] < slots;
}
