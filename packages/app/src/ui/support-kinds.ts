/**
 * S-F Task 1: ONE table for the fire-support menu. The sim's `SupportKind`
 * (F1, GH-183) is the only kind type the app speaks; everything the shell
 * knows about a call -- its words, its tile glyph, its armed cursor, its
 * hotkey action, its telemetry verb, its round timings -- is a row here.
 *
 * Tables hold catalogue KEYS, never text resolved at module load: a locale is
 * set at boot, after this module has been imported (the `ROLE_LABEL` rule).
 */

import { FIRE_SUPPORT_KINDS, type SupportKind } from '@lions/sim';
import type { TelemetryOrderVerb } from '@lions/data/telemetry';
import type { CursorName } from '../input/cursor';
import type { Action } from '../input/keymap';
import type { SightOrderId } from './order-sight';

export type { SupportKind };

/** Dock order, cheapest first: the sim's own list. */
export const SUPPORT_KINDS: readonly SupportKind[] = FIRE_SUPPORT_KINDS;

export interface SupportSpec {
  /** Catalogue KEYS, resolved with t() where drawn. */
  readonly word: string;
  readonly name: string;
  readonly blurb: string;
  /** The tile glyph, `symbolSvg(mark)`. */
  readonly mark: SightOrderId;
  /** The armed cursor. `barrage`/`smokeScreen` are CURSOR_ALIAS names. */
  readonly cursor: CursorName;
  /** The keymap action that presses this tile (Task 3). */
  readonly action: Extract<Action, 'supportScreen' | 'supportBarrage' | 'supportSweep' | 'supportStrike'>;
  readonly verb: TelemetryOrderVerb;
}

export const SUPPORT: Readonly<Record<SupportKind, SupportSpec>> = {
  smoke_screen: {
    word: 'dock.support.smoke_screen.word',
    name: 'dock.support.smoke_screen.name',
    blurb: 'dock.support.smoke_screen.blurb',
    mark: 'smoke',
    cursor: 'smokeScreen',
    action: 'supportScreen',
    verb: 'smokeScreen',
  },
  mortar_barrage: {
    word: 'dock.support.mortar_barrage.word',
    name: 'dock.support.mortar_barrage.name',
    blurb: 'dock.support.mortar_barrage.blurb',
    mark: 'strike',
    cursor: 'barrage',
    action: 'supportBarrage',
    verb: 'barrage',
  },
  drone_sweep: {
    word: 'dock.support.drone_sweep.word',
    name: 'dock.support.drone_sweep.name',
    blurb: 'dock.support.drone_sweep.blurb',
    mark: 'sweep',
    cursor: 'sweep',
    action: 'supportSweep',
    verb: 'sweep',
  },
  air_strike: {
    word: 'dock.support.air_strike.word',
    name: 'dock.support.air_strike.name',
    blurb: 'dock.support.air_strike.blurb',
    mark: 'strike',
    cursor: 'strike',
    action: 'supportStrike',
    verb: 'strike',
  },
};

/** COPIED from packages/sim/src/tuning.ts (the PROJ_SPEED rule: the app never
 *  imports tuning). support-kinds.test.ts reads tuning.ts as TEXT and fails on drift. */
export const FS_AIR_STRIKE = 0;
export const FS_MORTAR_BARRAGE = 1;
export interface RoundTiming {
  readonly rounds: number;
  readonly spacingTicks: number;
  readonly delayTicks: number;
  readonly scatterFx: number;
  readonly splashFx: number;
}
export const ROUNDS: Readonly<Record<'air_strike' | 'mortar_barrage' | 'smoke_screen', RoundTiming>> = {
  air_strike: { rounds: 1, spacingTicks: 0, delayTicks: 60, scatterFx: 19661, splashFx: 131072 },
  mortar_barrage: { rounds: 6, spacingTicks: 36, delayTicks: 120, scatterFx: 98304, splashFx: 65536 },
  smoke_screen: { rounds: 3, spacingTicks: 40, delayTicks: 80, scatterFx: 98304, splashFx: 0 },
};
export const SMOKE_RADIUS_TILES = 3; // tuning.ts SMOKE_RADIUS
export const SWEEP_RADIUS_SQ_FX = 3932160; // tuning.ts SWEEP_RADIUS_SQ (moved here from intel-moments.ts)

/** Ticks from the call to the last round landing. */
export function lastRoundTicks(kind: keyof typeof ROUNDS): number {
  const r = ROUNDS[kind];
  return r.delayTicks + (r.rounds - 1) * r.spacingTicks;
}

/** The ring under the armed cursor, tiles: where rounds can land and what
 *  they touch. Null for the sweep (decision 6 of GH-113: its circle is not drawn). */
export function footprintTiles(kind: SupportKind): number | null {
  switch (kind) {
    case 'air_strike':
      return ROUNDS.air_strike.splashFx / 65536; // 2.0, unchanged
    case 'mortar_barrage':
      return (ROUNDS.mortar_barrage.scatterFx + ROUNDS.mortar_barrage.splashFx) / 65536; // 2.5
    case 'smoke_screen':
      return ROUNDS.smoke_screen.scatterFx / 65536 + SMOKE_RADIUS_TILES; // 4.5
    case 'drone_sweep':
      return null;
  }
}
