/**
 * The fog one seat sees, kept the way the renderer keeps it: `computeFog`
 * from `packages/render/src/three/fog.ts` (a pure file that imports nothing,
 * pinned by `view.test.ts`), fed the same `FogInput` `ThreeRenderer.recomputeFog`
 * builds, on the same cadence (every fourth call, the first included, the
 * previous fog kept so decay-before-reveal holds). Reused by relative import,
 * never copied: a harness that re-derived the rule would show a model a
 * different board from the one its player sees.
 */
import { fx, type Sim } from '@lions/sim';
import { computeFog, isFogVisible, type FogInput } from '../../../packages/render/src/three/fog';

/** The renderer refreshes fog on every FOURTH snapshot (`ThreeRenderer.snapshot`). */
const FOG_EVERY = 4;

export class FogTracker {
  private fog: Uint8Array;
  private calls = 0;
  private readonly sightByType: Float64Array;

  constructor(
    private readonly sim: Sim,
    private readonly viewerSide: 0 | 1
  ) {
    this.fog = new Uint8Array(sim.width * sim.height);
    this.sightByType = new Float64Array(sim.unitTypes.length);
    for (let t = 0; t < sim.unitTypes.length; t++) this.sightByType[t] = fx.toNumber(sim.unitTypes[t].sight);
  }

  /** Call once after every sim tick. Recomputes on the renderer's cadence (every 4th call, from the first). */
  step(): void {
    if (this.calls++ % FOG_EVERY !== 0) return;
    const sim = this.sim;
    const st = sim.state;
    const input: FogInput = {
      width: sim.width,
      height: sim.height,
      entityCount: sim.entityCount,
      alive: st.alive,
      side: st.side,
      typeIdx: st.typeIdx,
      posX: st.posX,
      posY: st.posY,
      sightByType: this.sightByType,
      blocked: sim.blocked,
      isLowProfile: (x, y) => {
        const s = sim.structureAt(x, y);
        return s >= 0 && sim.structureTypes[sim.structures.typeIdx[s]].lowProfile;
      },
      viewerSide: this.viewerSide,
    };
    this.fog = computeFog(this.fog, input);
  }

  /** In sight right now at a (fractional) tile position, the renderer's `isVisible`. */
  visibleTile(x: number, y: number): boolean {
    return isFogVisible(this.fog, this.sim.width, this.sim.height, x, y);
  }
}
