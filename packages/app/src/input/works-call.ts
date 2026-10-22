/**
 * The armed field-works click and the works card's Cancel, as commands down the
 * order sink (GH-277 follow-up).
 *
 * "Check, then send" (N2, D3), the rule `build`, `support` and `setRally`
 * already follow: the click asks the runtime's read-only `constructReason` /
 * `canCancelWorks`, and an accepted request goes to the sink as a `raiseWorks`
 * / `cancelWorks` command. The runtime prices and runs it in `applyQueued`,
 * before the next tick, re-checking as it goes -- so the order reaches the sim
 * the one way every other order does, and a room's transport carries it.
 * Nothing here calls `requestConstruct` or `requestCancelWorks`: a click never
 * spends.
 *
 * No DOM. The runtime is read, never written.
 */
import type { Command, WorksRefusal } from '@lions/sim';

/** The slice of `MissionRuntime` a works click reads. */
export interface WorksRuntime {
  constructReason(typeId: string, tx?: number, ty?: number, builders?: readonly number[]): WorksRefusal | null;
  canCancelWorks(site: number): boolean;
}

export type WorksOutcome = { ok: true } | { ok: false; why: WorksRefusal | null };

/** Raise works `typeId` at tile (tx, ty) with `builders` (empty: the runtime's
 *  nearest idle carrier). Sends one `raiseWorks` command when the runtime would
 *  accept it now; sends nothing and names the refusal otherwise. */
export function callWorks(
  rt: WorksRuntime,
  sink: { queueCommand(cmd: Command): void },
  typeId: string,
  tx: number,
  ty: number,
  builders: readonly number[]
): WorksOutcome {
  const why = rt.constructReason(typeId, tx, ty, builders.length > 0 ? builders : undefined);
  if (why !== null) return { ok: false, why };
  sink.queueCommand({ kind: 'raiseWorks', side: 0, works: typeId, x: tx, y: ty, ids: [...builders] });
  return { ok: true };
}

/** Take down the player's own site `site`: one `cancelWorks` command when the
 *  runtime would accept it now, nothing otherwise. */
export function callCancelWorks(rt: WorksRuntime, sink: { queueCommand(cmd: Command): void }, site: number): boolean {
  if (!rt.canCancelWorks(site)) return false;
  sink.queueCommand({ kind: 'cancelWorks', side: 0, site });
  return true;
}
