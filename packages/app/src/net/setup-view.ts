/**
 * The set-up of a capture-the-flag v2 room as one seat reads it (GH-976 v2): how long is left, where the line is, what is left of
 * the kit, and who has pressed Ready. ONE function, read by the browser's HUD (WP7) and by the AI harness's `observe` (WP8), so a
 * model is shown the board a human is shown, as `flag-view.ts` and `points-view.ts` do.
 *
 * Everything is read from the SIM -- its tick, its bell, its kit -- and never from a wall clock, so a paused room's countdown
 * stops (Review Focus 5) and a rejoiner, who never saw the `setupBell` event, reads the same board (Review Focus 4). The view is
 * null once the bell has rung: the HUD's "Contact" toast comes from that edge, not from the event.
 *
 * Import-free on purpose, like `flag-view.ts`: the harness's stdout-purity walk follows every import. The slice of `MatchWorld`
 * it reads is restated here (`SetupRules`), and `MatchWorld['setup']` satisfies it structurally.
 */

/** The slice of `Sim` the board reads. */
export interface SetupSim {
  readonly tickCount: number;
  /** True from `beginSetup` until the bell tick. */
  readonly setupActive: boolean;
  /** The tick the bell rings (earlier once both sides are Ready); -1 in a world with no set-up. */
  readonly setupBellTick: number;
  /** How many of kit slot `kit` `side` may still place. */
  setupKitLeft(side: 0 | 1, kit: number): number;
  /** Whether `side` has pressed Ready. */
  setupReady(side: 0 | 1): boolean;
}

/** The slice of `MatchWorld['setup']` the board reads: the line and the kit's three slots, in `SETUP_KIT_PIECES` order. */
export interface SetupRules {
  readonly line: { readonly a: readonly [number, number]; readonly b: readonly [number, number] };
  readonly kit: readonly { readonly piece: 'hesco' | 'sandbag_post' | 't_wall' }[];
}

export interface SetupView {
  /** Whole seconds to the bell, rounded UP (the last second reads 1, never 0). */
  secondsLeft: number;
  /** The seat bisector clipped to the map, in tile units, for the dashed line. */
  line: { a: [number, number]; b: [number, number] };
  /** What the viewer's own side may still place, by piece. */
  kit: Record<'hesco' | 'sandbag_post' | 't_wall', number>;
  /** Whether the viewer's side, and the other side, have pressed Ready. */
  ready: { mine: boolean; theirs: boolean };
}

/** The sim's tick rate, restated: the board imports nothing. */
const TICKS_PER_SECOND = 20;

/** `viewer`'s set-up board, or null once the bell has rung (and in a world with no set-up). */
export function setupViewOf(sim: SetupSim, setup: SetupRules, viewer: 0 | 1): SetupView | null {
  if (!sim.setupActive) return null;
  const other: 0 | 1 = viewer === 0 ? 1 : 0;
  const kit = { hesco: 0, sandbag_post: 0, t_wall: 0 };
  setup.kit.forEach((k, slot) => { kit[k.piece] = sim.setupKitLeft(viewer, slot); });
  return {
    secondsLeft: Math.ceil((sim.setupBellTick - sim.tickCount) / TICKS_PER_SECOND),
    line: { a: [setup.line.a[0], setup.line.a[1]], b: [setup.line.b[0], setup.line.b[1]] },
    kit,
    ready: { mine: sim.setupReady(viewer), theirs: sim.setupReady(other) },
  };
}
