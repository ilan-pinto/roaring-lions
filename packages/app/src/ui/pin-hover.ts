/**
 * What a pin, or the ground under the cursor, is about to say -- the pure
 * model a hover PREVIEW is built from, on the 3D campaign board
 * (`worldmap3d.ts`).
 *
 * `pickOutcome` is the one place the four-way branch a click resolves to
 * (locked / empty / cleared / opening) is written. Before this file existed,
 * `onPick` carried that switch as its own if-chain; a hover preview written
 * beside it would have been a second copy of the identical rule, the
 * "implemented twice" failure the pre-flight scan's M11 named. `onPick`
 * (click: side effects, `world3d.say.*` keys) and the hover preview (no side
 * effects, `world3d.hover.*` keys) both resolve their status through
 * `pickOutcome` before formatting a sentence, so the branch itself is
 * written once.
 *
 * No `t()` call inside the switch. `hoverLine` returns a catalogue key and
 * its params -- the same shape `alerts.ts` returns for the identical reason
 * (a pure model has no locale of its own) -- and the caller resolves the
 * text through `t()` where it renders, exactly as `onPick` already does for
 * the click sentence.
 */
import { t } from '../i18n/t';
import type { RegionStatus } from '../campaign';

/**
 * The status a hover preview switches on. Broader than `RegionStatus`: a
 * TOWN pin's own status can also read `'done'` -- every one of ITS objectives
 * complete, which is not itself a member of `RegionStatus` -- computed in
 * `worldmap3d.ts`'s pin loop as `total > 0 && done === total ? 'done' :
 * total === 0 ? 'empty' : p.status`. The ground-hover preview (a REGION, from
 * the view's own `hovered` getter) only ever supplies a `RegionStatus`, which
 * is a subset of this type and needs no separate handling.
 */
export type PinStatus = RegionStatus | 'done';

/** What a pin (a town) or the ground (a region) is, for the purpose of
 *  deciding what a hover -- or a click -- says about it. */
export interface PinState {
  status: PinStatus;
  regionName: string;
  lockedBecause?: string;
  nextMissionName?: string;
}

/** The four things a click on this ground could resolve to, and the four
 *  things a hover previews without doing any of them. */
export type PinOutcome = 'locked' | 'empty' | 'cleared' | 'opening';

/**
 * The single branch both a click and a hover preview resolve through.
 *
 * `hasNext` stands for "there is a mission id to open" -- not for "that
 * mission has a display name", which `onPick` and the hover preview each
 * decide for themselves once they already know the outcome is `'opening'`.
 */
export function pickOutcome(status: PinStatus, hasNext: boolean): PinOutcome {
  if (status === 'locked') return 'locked';
  if (status === 'empty') return 'empty';
  return hasNext ? 'opening' : 'cleared';
}

/** A line for the feed, as a catalogue key and its params -- the same shape
 *  `alerts.ts`'s `AlertLine` returns, but with `speak()`'s own local tone
 *  (`worldmap3d.ts`), not `hud-model.ts`'s `Tone`: the two are unrelated
 *  four-value enums that happen to share three spellings. */
export interface HoverLine {
  key: string;
  params: Record<string, string>;
  tone: 'hint' | 'good' | 'bad' | 'info';
}

/**
 * What a hover previews -- never what a click commits. The catalogue key
 * always starts `world3d.hover.`, distinct from `onPick`'s `world3d.say.`,
 * so a preview cannot be mistaken for a commitment even where the wording
 * is close (the click sentence says "opening", this one says "opens").
 */
export function hoverLine(s: PinState): HoverLine {
  const hasNext = s.nextMissionName !== undefined;
  const outcome = pickOutcome(s.status, hasNext);
  if (outcome === 'locked') {
    return {
      key: 'world3d.hover.locked',
      params: { region: s.regionName, reason: s.lockedBecause ?? t('world3d.locked.fallback') },
      tone: 'bad',
    };
  }
  if (outcome === 'empty') {
    return { key: 'world3d.hover.empty', params: { region: s.regionName }, tone: 'info' };
  }
  if (outcome === 'opening' && s.nextMissionName !== undefined) {
    return {
      key: 'world3d.hover.opening',
      params: { region: s.regionName, mission: s.nextMissionName },
      tone: 'good',
    };
  }
  return { key: 'world3d.hover.cleared', params: { region: s.regionName }, tone: 'good' };
}
