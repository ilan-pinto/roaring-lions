/**
 * Which HUD surfaces are on screen right now (GH-345, spec §b).
 *
 * Pure, DOM-free and sim-free, beside the reducer it reads, so the whole rule
 * is testable without a page. Three sources, in this order of authority:
 *
 *  1. A RUNNING tutorial owns the answer outright. `hud_start` is what deploy
 *     shows; every step's `reveal` up to and including the open step is added
 *     on top, cumulatively, at the moment that step opens. Everything else is
 *     hidden -- including what the mission itself would show.
 *  2. With no tutorial running (finished, skipped, already learned, or never
 *     declared), the mission's own `hud.hidden` subtracts from everything.
 *  3. With neither, everything is shown -- every other mission and every
 *     sandbox renders exactly as before this existed.
 *
 * A finished or skipped tutorial falls through to rule 2, which for the
 * tutorial's own mission is "everything": skipping is how a player asks for
 * the full cockpit.
 */

import { ALL_SHOWN, type HudElement } from '../ui/hud-elements';
import type { TutorialState } from './runtime';

export interface TutorialHudJson {
  hud_start?: readonly HudElement[];
  steps: readonly { reveal?: readonly HudElement[] }[];
}

export interface MissionHudJson {
  hud?: { hidden?: readonly HudElement[] };
}

export function hudVisibility(
  state: TutorialState | null,
  tutorial: TutorialHudJson | null,
  mission: MissionHudJson | null
): ReadonlySet<HudElement> {
  if (state !== null && !state.done && tutorial !== null && tutorial.hud_start !== undefined) {
    const shown = new Set<HudElement>(tutorial.hud_start);
    const last = Math.min(state.index, tutorial.steps.length - 1);
    for (let i = 0; i <= last; i++) for (const el of tutorial.steps[i]?.reveal ?? []) shown.add(el);
    return shown;
  }
  const hidden = mission?.hud?.hidden;
  if (hidden === undefined || hidden.length === 0) return ALL_SHOWN;
  const shown = new Set<HudElement>(ALL_SHOWN);
  for (const el of hidden) shown.delete(el);
  return shown;
}
