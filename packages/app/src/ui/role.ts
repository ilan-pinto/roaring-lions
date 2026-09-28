import { t } from '../i18n/t';
import { symbolSvg } from './symbol';

/**
 * The seven buckets a unit falls into for display.
 *
 * Extracted from hud.ts's inspect-card rung so the cursor's badge and the
 * card's mark cannot disagree about what a unit is -- the player sees both
 * at once. What is shared is the BUCKET; how each bucket is DRAWN is the G1
 * sheet's APP-6 role mark (`symbol.ts`), the one source every badge reads.
 *
 * Seven and not fourteen because a badge is about 10px in motion.
 */
export type RoleBucket =
  | 'kamikaze'
  | 'drone'
  | 'gunship'
  | 'sniper'
  | 'transport'
  | 'soft'
  | 'armour';

/** Structural on purpose: the four fields it reads, so this module needs no
 *  sim import and a test can describe a unit without building one. */
export function roleBucket(type: {
  isKamikaze: boolean;
  role?: string;
  transportSlots: number;
  isSoft: boolean;
}): RoleBucket {
  if (type.isKamikaze) return 'kamikaze';
  if (type.role === 'drone') return 'drone';
  if (type.role === 'gunship') return 'gunship';
  if (type.role === 'sniper') return 'sniper';
  if (type.transportSlots > 0) return 'transport';
  return type.isSoft ? 'soft' : 'armour';
}

/**
 * Whether a unit in `unitBucket` should show under the garage rail's selected
 * tab (`'all'`, or one of the seven buckets `roleBucket` returns). Extracted
 * from `brigade.ts`'s `syncTabs`, where this was an inline expression with no
 * test of its own (GH-237) -- the actual bug there was `theme.css` letting
 * `.rl-garage__card`'s unconditional `display: flex` beat the native
 * `hidden` attribute the tab click sets, so every card kept drawing at full
 * size regardless of what this predicate said. Pulling the decision out to a
 * pure function does not touch that CSS fix; it means the ANSWER a tab click
 * computes has one small, direct test, separate from whether the DOM element
 * that answer gets written to actually renders it.
 */
export function bucketVisible(unitBucket: RoleBucket, selected: RoleBucket | 'all'): boolean {
  return selected === 'all' || unitBucket === selected;
}

/** Role id -> catalogue key. Not the labels themselves -- see `ROLE_LABEL` below
 *  for why the labels are read lazily instead of resolved from this table once. */
const ROLE_KEYS: Readonly<Record<string, string>> = {
  apc: 'role.apc',
  artillery: 'role.artillery',
  at_team: 'role.at_team',
  drone: 'role.drone',
  engineer: 'role.engineer',
  gunship: 'role.gunship',
  ifv: 'role.ifv',
  infantry: 'role.infantry',
  mbt: 'role.mbt',
  recon: 'role.recon',
  sniper: 'role.sniper',
  support: 'role.support',
};

/**
 * The twelve KDF roles (`data/units/kdf/*.json`'s own `role` field), as
 * lowercase player-facing words. The brigade screen (F2) is the first place
 * that ever printed a raw role id to a player; this is what stops it doing
 * that again the moment a thirteenth role ships. `role.test.ts` pins every
 * role any shipped KDF unit declares against this table.
 *
 * Each property is a GETTER that calls `t()` on ACCESS, not a value resolved once
 * at module load: `main.ts`'s boot sets the active catalogue -- `?pseudo=1` and
 * `?lang=` included -- well after every module's top-level code has run, so a
 * value resolved at import time can never see a locale picked after it. Caught by
 * the pseudo pass: an eager version left every role label as plain English on the
 * brigade screen.
 *
 * Minor 3 (final review): this comment used to contrast the getters with
 * "`grade-copy.ts`'s eager trade". That trade is gone -- Task 10's fix round made
 * grade-copy's tables the `tierName`/`tierLine` accessors for exactly this reason,
 * so the two modules agree now and the contrast described a file that no longer
 * exists in that shape. */
export const ROLE_LABEL: Record<string, string> = {};
for (const [role, key] of Object.entries(ROLE_KEYS)) {
  Object.defineProperty(ROLE_LABEL, role, { get: () => t(key), enumerable: true });
}

/** `ROLE_LABEL[role]`, or the id with underscores turned to spaces for a role
 *  this table has not caught up with yet -- never a crash, and never the raw
 *  snake_case id verbatim. */
export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role.replace(/_/g, ' ');
}

/**
 * The role mark as a standalone inline SVG for the HUD, in `currentColor`.
 *
 * S3e: drawn from the G1 sheet (`symbol.ts`) -- the seven APP-6-derived role
 * marks -- so the chip, the card, the dock, its tooltip and the garage cannot
 * say different things about what a unit is. Q7: the APP-6 frame (the
 * friendly rectangle, or the air dome) from 16 px up; below that the bare
 * mark, since a frame at 10 px is a smudge around a smudge.
 *
 * `currentColor` and not a token: the badge is set in the same ink as the name
 * beside it, so a chip that dims dims its badge with it and nothing has to
 * remember to dim two things. That also keeps this file clear of
 * `pnpm validate:ui` — it names no colour at all.
 */
export function roleBadgeSvg(bucket: RoleBucket, size: number): string {
  return symbolSvg(bucket, size, { framed: size >= 16, className: 'rl-badge' });
}
