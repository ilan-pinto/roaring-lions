/**
 * A structure's footprint centre, in fractional tile units: `(min + max + 1)
 * / 2` on each axis, because `maxX`/`maxY` are INCLUSIVE tile indices.
 *
 * Read by `ThreeRenderer`'s building overlays (integrity bar, garrison
 * highlight) and the building-mesh placement. It lived in `units/structures.ts`
 * beside the structure BILLBOARDS until those were retired (WP-A3.3); it is
 * the one piece of that module the mesh path still needed.
 */
import type { Sim } from '@lions/sim';

export function footprintCentre(sim: Sim, sIdx: number): { fx: number; fy: number } {
  const st = sim.structures;
  return {
    fx: (st.minX[sIdx] + st.maxX[sIdx] + 1) / 2,
    fy: (st.minY[sIdx] + st.maxY[sIdx] + 1) / 2,
  };
}
