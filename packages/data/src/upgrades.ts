// applyUpgrades — a pure pre-pass over a unit's JSON, patching in the
// cumulative deltas a bought tier promises before @lions/sim registers the
// type. Step 3 of the brigade economy (spec 2026-09-15 §4.3); schema block
// added in Task 1 at 6067e84. This module owns the one whitelist both the
// schema and the runtime must agree on — UPGRADE_PATHS mirrors
// `data/schemas/unit.schema.json`'s `upgrades.<track>.tiers[].patch`
// `propertyNames.pattern`, and `upgrades.test.ts` pins the two together by
// reading the schema file off disk rather than trusting a comment to stay
// in sync.
//
// Leaf package rule (CLAUDE.md): @lions/data imports no other @lions
// package. This module imports nothing but its own types.

/** One priced tier: `patch` maps a whitelisted path to a cumulative DELTA
 *  over the unit's base value (not the delta over the previous tier). */
export interface UpgradeTier {
  price: number;
  patch: Record<string, number>;
}

/** One upgrade track: an ordered list of tiers, tier 1 at index 0. */
export interface UpgradeTrack {
  tiers: UpgradeTier[];
}

export type UpgradeTracks = Record<string, UpgradeTrack>;

/** A unit's JSON as far as this module needs to see it. */
export interface UpgradableUnit {
  id: string;
  upgrades?: UpgradeTracks;
  hull?: Record<string, unknown>;
  sensors?: Record<string, unknown>;
  weapons?: Record<string, unknown>[];
}

/** The closed whitelist, mirrored from unit.schema.json's
 *  `upgrades.<track>.tiers[].patch.propertyNames.pattern`:
 *  `hull.hp | hull.armor.(front|side|rear) | hull.suppression_resistance |
 *   sensors.optics | sensors.sight_tiles | weapons[i].(accuracy|penetration)`.
 *  Kept as separate anchored patterns rather than one big alternation so a
 *  caller can `.some()` over them without re-deriving the schema's grouping. */
export const UPGRADE_PATHS: readonly RegExp[] = [
  /^hull\.hp$/,
  /^hull\.armor\.(front|side|rear)$/,
  /^hull\.suppression_resistance$/,
  /^sensors\.optics$/,
  /^sensors\.sight_tiles$/,
  /^weapons\[\d+\]\.(accuracy|penetration)$/,
];

function isWhitelisted(path: string): boolean {
  return UPGRADE_PATHS.some((re) => re.test(path));
}

type PathSegment = { key: string; index?: number };

/** Parses `a.b`, `a[0].b` into segments. `weapons[0].accuracy` ->
 *  [{key:'weapons', index:0}, {key:'accuracy'}]. Only used on paths already
 *  confirmed against UPGRADE_PATHS, so no error handling for malformed
 *  input beyond what the regex already guarantees. */
function parsePath(path: string): PathSegment[] {
  return path.split('.').map((part) => {
    const m = /^([a-zA-Z_]+)\[(\d+)\]$/.exec(part);
    if (m) return { key: m[1], index: Number(m[2]) };
    return { key: part };
  });
}

/** Applies one numeric delta at `path` onto a shallow-cloned-along-the-path
 *  copy of `root`, mutating only the fresh copies this call itself created.
 *  `root` must already be a top-level shallow copy owned by the caller. */
function addDeltaAlongPath(root: Record<string, unknown>, path: string, delta: number): void {
  const segments = parsePath(path);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let container: any = root;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;

    if (seg.index !== undefined) {
      // Array-indexed segment: copy the array itself, then the element at
      // `index` (unpatched siblings stay shared by reference).
      const arr = container[seg.key];
      const arrCopy = Array.isArray(arr) ? arr.slice() : [];
      container[seg.key] = arrCopy;
      const item = arrCopy[seg.index] ?? {};
      const itemCopy = { ...item };
      arrCopy[seg.index] = itemCopy;
      if (isLast) {
        throw new Error(`applyUpgrades: malformed whitelisted path "${path}"`);
      }
      container = itemCopy;
      continue;
    }

    if (isLast) {
      const current = typeof container[seg.key] === 'number' ? (container[seg.key] as number) : 0;
      container[seg.key] = current + delta;
      return;
    }

    const next = container[seg.key];
    const nextCopy = next && typeof next === 'object' ? { ...(next as Record<string, unknown>) } : {};
    container[seg.key] = nextCopy;
    container = nextCopy;
  }
}

/** Every track at its maximum tier — what the harness and the balance
 *  backtest run, to price and to simulate the fully-upgraded unit. */
export function maxTiers(unit: UpgradableUnit): Record<string, number> {
  const out: Record<string, number> = {};
  const tracks = unit.upgrades;
  if (!tracks) return out;
  for (const [name, track] of Object.entries(tracks)) {
    out[name] = track.tiers.length;
  }
  return out;
}

/** The price of the next tier above `current` on `track`, or null when the
 *  track is already at its maximum, or the unit has no such track. */
export function nextTierPrice(unit: UpgradableUnit, track: string, current: number): number | null {
  const t = unit.upgrades?.[track];
  if (!t) return null;
  const nextTier = t.tiers[current];
  return nextTier ? nextTier.price : null;
}

/** Pure. Returns a NEW unit with each track's tier deltas added to base;
 *  tier 0 / an absent track is the identity for that track; a tier above
 *  the track's own maximum clamps to the maximum (data may shrink a track
 *  after a purchase — this never throws for that reason). Throws on a patch
 *  path outside UPGRADE_PATHS, naming the offending path: the schema
 *  validates this upstream, so reaching an unlisted path here is a
 *  programming error, not a data error to recover from. */
export function applyUpgrades<T extends UpgradableUnit>(unit: T, tiers: Readonly<Record<string, number>>): T {
  // Top-level shallow copy so the identity case still returns a new object,
  // and so every field addDeltaAlongPath does not touch is shared by
  // reference with the input (acceptable per the brief).
  const out: Record<string, unknown> = { ...(unit as Record<string, unknown>) };

  const tracks = unit.upgrades;

  // Resolve to ONE delta per whitelisted path before touching `out`. A
  // tier's patch is the cumulative delta over BASE, not over the previous
  // tier, so within a track the highest achieved tier's value for a given
  // path supersedes an earlier tier's value for that same path rather than
  // adding to it -- walking tiers 0..tierIndex-1 in order and letting a
  // later write win produces exactly that.
  const resolved: Record<string, number> = {};
  for (const [trackName, requestedTier] of Object.entries(tiers)) {
    const track = tracks?.[trackName];
    if (!track) continue; // unknown track: ignored

    const tierIndex = Math.min(Math.max(requestedTier, 0), track.tiers.length); // clamp to max
    for (let i = 0; i < tierIndex; i++) {
      for (const [path, delta] of Object.entries(track.tiers[i].patch)) {
        if (!isWhitelisted(path)) {
          throw new Error(`applyUpgrades: patch path "${path}" is outside the UPGRADE_PATHS whitelist`);
        }
        resolved[path] = delta;
      }
    }
  }

  for (const [path, delta] of Object.entries(resolved)) {
    addDeltaAlongPath(out, path, delta);
  }

  return out as T;
}
