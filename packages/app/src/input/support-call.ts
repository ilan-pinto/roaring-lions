/**
 * The armed fire-support click, from a screen pixel to a sim call (S-F Task 4).
 *
 * F-Q10 (lead, 11 Oct): every armed support click resolves through
 * `pointerPoint`, the same function the hover cursor and the order clicks read,
 * so the point marked is the point hit -- a pixel that shows a building's wall
 * aims at that building, not at the ground hidden behind it. One function for
 * the click (`callSupport`) and for the ring drawn under the cursor
 * (`supportAim`), so the two cannot disagree.
 *
 * No DOM. `Sim` is read, never written; the runtime owns the spend.
 *
 * N2, D3 (lead, 16 Oct: "check, then send"): the click does not spend. It asks
 * the runtime's read-only `canSupport`, and an accepted call goes to the order
 * sink as a `support` command; the runtime re-checks and spends when it runs
 * it, before the next tick (`applyQueued`). The two share one predicate, so
 * they disagree only when two purchases in one frame compete for one purse.
 */
import { fx, type Command, type Sim, type SupportKind } from '@lions/sim';
import { pointerPoint, type PointerView } from './pointer';
import type { AimFootprint } from '@lions/render';
import { footprintTiles, ROUNDS } from '../ui/support-kinds';

/** The slice of `MissionRuntime` a call needs. */
export interface SupportRuntime {
  readonly intel: number;
  supportCost(kind: SupportKind): number;
  /** MissionRuntime's click-time pre-check: would `requestSupport` accept now? */
  canSupport(kind: SupportKind): boolean;
}

export type SupportOutcome =
  | { ok: true; kind: SupportKind; x: number; y: number }
  | { ok: false; kind: SupportKind; x: number; y: number; why: 'intel' | 'caller' };

/** F-Q10 (lead, 11 Oct): the point marked is the point hit -- a wall pixel aims at its building. */
export function supportAim(view: PointerView, sim: Sim, px: number, py: number): { x: number; y: number } {
  const p = pointerPoint(view, sim, px, py);
  return { x: p.x, y: p.y };
}

/**
 * Make the call: pre-check, then send a `support` command to `sink` (N2, D3).
 * A refusal sends nothing and says why, read-only: the runtime refuses for
 * exactly two reasons the player can act on -- too little intel, or (for the
 * three that fire) no living surface caller -- so intel in hand means the
 * caller.
 */
export function callSupport(
  rt: SupportRuntime,
  sink: { queueCommand(cmd: Command): void },
  kind: SupportKind,
  view: PointerView,
  sim: Sim,
  px: number,
  py: number
): SupportOutcome {
  const { x, y } = supportAim(view, sim, px, py);
  if (rt.canSupport(kind)) {
    sink.queueCommand({ kind: 'support', side: 0, support: kind, x: fx.from(x), y: fx.from(y) });
    return { ok: true, kind, x, y };
  }
  return { ok: false, kind, x, y, why: rt.intel < rt.supportCost(kind) ? 'intel' : 'caller' };
}

/** The ring(s) under the armed cursor, at the same point the click would spend
 *  it on. The kind picks the renderer's ring style (S-F Task 1): a barrage also
 *  carries its scatter, the radius its rounds land inside. */
export function aimFootprint(kind: SupportKind | null, at: { x: number; y: number } | null): AimFootprint | null {
  if (kind === null || at === null) return null;
  const radius = footprintTiles(kind);
  if (radius === null) return null;
  const base = { x: at.x, y: at.y, radius };
  switch (kind) {
    case 'mortar_barrage':
      return { ...base, kind: 'barrage', scatter: ROUNDS.mortar_barrage.scatterFx / 65536 };
    case 'smoke_screen':
      return { ...base, kind: 'smoke' };
    default:
      return { ...base, kind: 'strike' };
  }
}
