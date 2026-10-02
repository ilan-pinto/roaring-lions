/**
 * The HUD's progressive-disclosure vocabulary (GH-345, spec §b).
 *
 * One list, read three ways: the tutorial's `hud_start`/`reveal`
 * (`tutorial.schema.json`), a mission's `hud.hidden` (`mission.schema.json`),
 * and the `isShown(el)` question every HUD surface asks before it draws. The
 * two schema enums are copies of this array and `hud-elements.test.ts` pins
 * them against it both ways, the way `steps.test.ts` pins `INTENT_KINDS`, so a
 * member added here and not there is a red spec rather than an id
 * `validate:data` refuses in shipped JSON.
 *
 * "Hidden" means INERT, not merely invisible: a hidden `dock` also swallows
 * the production key, a hidden `groups` swallows ctrl+N, a hidden `conduct`
 * opens no tooltip. The set is the same object everywhere, so a surface cannot
 * be drawn by one reader and refused by another.
 */

export const HUD_ELEMENTS = [
  'minimap',
  'card',
  'orders',
  'hint',
  'feed',
  'fire',
  'status',
  'objective',
  'objectives',
  'clock',
  'conduct',
  'logistics',
  'intel',
  'speed',
  'mute',
  'radio',
  'dock',
  'groups',
] as const;

export type HudElement = (typeof HUD_ELEMENTS)[number];

const KNOWN: ReadonlySet<string> = new Set(HUD_ELEMENTS);

export function isHudElement(s: string): s is HudElement {
  return KNOWN.has(s);
}

/** Everything shown: the answer for every mission and sandbox that declares
 *  nothing, which is all of them but the tutorial and any later mission that
 *  opts into a quieter cockpit. */
export const ALL_SHOWN: ReadonlySet<HudElement> = new Set(HUD_ELEMENTS);
