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

/** Which branch of a branched tier is owned (GH-1384): 1 or 2, never 0, never "both". */
export type BranchPick = 1 | 2;
/** One unit's picks, keyed by TRACK: which branch of that track's branched last tier is owned.
 *  It holds one entry per branched track owned at its last tier, however many the unit has. */
export type BranchPicks = Readonly<Record<string, BranchPick>>;
/** A store's or a view's picks: keyed by unit, then by track. Never by track alone. */
export type OwnedPicks = Readonly<Record<string, BranchPicks>>;

/** One branch of a branched tier (GH-1384, design 2026-11-17 §1.1). `label` is an
 *  `en.json` KEY (`garage.branch.<unit>.<id>`), never text. `patch` is a plain tier's
 *  patch: the cumulative DELTA over base. */
export interface UpgradeBranch {
  id: string;
  label: string;
  patch: Record<string, number>;
}

/** One priced tier: `patch` maps a whitelisted path to a cumulative DELTA
 *  over the unit's base value (not the delta over the previous tier). */
export interface PlainTier {
  price: number;
  patch: Record<string, number>;
  branches?: undefined;
}

/** A branched tier (GH-1384): exactly two `branches` sharing the one `price`, and no
 *  `patch` of its own. Only a track's LAST tier may be branched (validator rule B1);
 *  the schema holds `branches` to exactly two. It is typed as an array, not a pair,
 *  because a JSON import infers an array and the shipped unit files must type-check
 *  against this interface without a cast. */
export interface BranchedTier {
  price: number;
  branches: readonly UpgradeBranch[];
  patch?: undefined;
}

export type UpgradeTier = PlainTier | BranchedTier;

/** Whether a tier is branched. */
export function isBranchedTier(tier: UpgradeTier): tier is BranchedTier {
  return tier.branches !== undefined;
}

const isPick = (v: unknown): v is BranchPick => v === 1 || v === 2;

/** The patch a tier applies: a plain tier's own, or the PICKED branch's of a branched
 *  tier. `undefined` for a branched tier with no pick, or a pick that is not 1 or 2, so a
 *  caller cannot read an unpicked branched tier as either branch, or as both. */
export function tierPatch(tier: UpgradeTier, pick?: unknown): Readonly<Record<string, number>> | undefined {
  if (!isBranchedTier(tier)) return tier.patch;
  if (!isPick(pick)) return undefined;
  return tier.branches[pick - 1]?.patch;
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

/**
 * The number at a whitelisted `path` on a unit, or `undefined` when the unit
 * does not declare it (a missing key, a `weapons[i]` past the unit's own
 * weapons list, a non-numeric value).
 *
 * The read half of `addDeltaAlongPath` below, exported because the shell's
 * upgrade board has to print what a tier moves a stat FROM, and it must
 * resolve that base value through the same segment parser the patch is
 * applied through. A second parser in `packages/app` could disagree about
 * `weapons[0].accuracy` and print a number the sim will never see -- which is
 * exactly the drift `upgrade-benefit.test.ts` pins against `applyUpgrades`.
 * `@lions/data` stays a leaf: this adds no import.
 */
export function readPath(unit: UpgradableUnit, path: string): number | undefined {
  let cur: unknown = unit;
  for (const seg of parsePath(path)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    const held = (cur as Record<string, unknown>)[seg.key];
    cur = seg.index === undefined ? held : Array.isArray(held) ? (held as unknown[])[seg.index] : undefined;
  }
  return typeof cur === 'number' ? cur : undefined;
}

/** Applies one numeric delta at `path` onto a shallow-cloned-along-the-path
 *  copy of `root`, mutating only the fresh copies this call itself created.
 *  `root` must already be a top-level shallow copy owned by the caller.
 *  `unitId` is only used to name the unit in a thrown message. */
function addDeltaAlongPath(root: Record<string, unknown>, path: string, delta: number, unitId: string): void {
  const segments = parsePath(path);
  let container: Record<string, unknown> = root;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;

    if (seg.index !== undefined) {
      // Array-indexed segment: copy the array itself, then the element at
      // `index` (unpatched siblings stay shared by reference).
      const arr = container[seg.key];
      const arrCopy = Array.isArray(arr) ? (arr as unknown[]).slice() : [];
      container[seg.key] = arrCopy;
      const item = arrCopy[seg.index];
      if (item === undefined) {
        // The validator refuses a unit whose weapons array is shorter than
        // a whitelisted patch index, so reaching this is a programming
        // error (a unit edited after its upgrades were authored, or a bad
        // fixture) -- same class as an off-whitelist path, not data to
        // paper over with a synthesised {}.
        throw new Error(`applyUpgrades: ${unitId} has no ${seg.key}[${seg.index}]`);
      }
      const itemCopy: Record<string, unknown> = { ...(item as Record<string, unknown>) };
      arrCopy[seg.index] = itemCopy;
      if (isLast) {
        throw new Error(`applyUpgrades: malformed whitelisted path "${path}"`);
      }
      container = itemCopy;
      continue;
    }

    if (isLast) {
      const current = container[seg.key];
      if (typeof current !== 'number') {
        // Same class as an array index past the unit's own weapons length
        // above: the validator refuses a whitelisted patch path the unit
        // does not itself declare as a scalar, so reaching this is a
        // programming error (a unit edited after its upgrades were
        // authored, or a bad fixture), not data to default to 0 for.
        throw new Error(`applyUpgrades: ${unitId} has no ${path}`);
      }
      container[seg.key] = current + delta;
      return;
    }

    const next = container[seg.key];
    const nextCopy: Record<string, unknown> =
      next && typeof next === 'object' ? { ...(next as Record<string, unknown>) } : {};
    container[seg.key] = nextCopy;
    container = nextCopy;
  }
}

/** The unit's tracks whose LAST tier is branched, sorted (GH-1384). Any track may branch,
 *  and a unit may branch more than one (the lead, Q3); slice 1's content branches one. */
export function branchedTracks(unit: UpgradableUnit): readonly string[] {
  const out: string[] = [];
  for (const [name, track] of Object.entries(unit.upgrades ?? {})) {
    const last = track.tiers[track.tiers.length - 1];
    if (last !== undefined && isBranchedTier(last)) out.push(name);
  }
  return out.sort();
}

/** The two branches of `track`'s branched last tier, or `null` when it is not branched. */
export function branchOf(unit: UpgradableUnit, track: string): readonly [UpgradeBranch, UpgradeBranch] | null {
  const tiers = unit.upgrades?.[track]?.tiers;
  const last = tiers?.[tiers.length - 1];
  if (last === undefined || !isBranchedTier(last)) return null;
  const [a, b] = last.branches;
  return a !== undefined && b !== undefined ? [a, b] : null;
}

/** Every branched track of the unit at `pick` (the uniform vector the balance gates run),
 *  or per track when `pick` is a map (a track the map does not name is left out). */
export function maxPicks(unit: UpgradableUnit, pick: BranchPick | BranchPicks): Record<string, BranchPick> {
  const out: Record<string, BranchPick> = {};
  for (const track of branchedTracks(unit)) {
    const p = typeof pick === 'number' ? pick : pick[track];
    if (isPick(p)) out[track] = p;
  }
  return out;
}

/** One branched track as the economy sees it: the branched tier's NUMBER (the track's
 *  length, since only the last tier may branch) and its one price, read from the unit's JSON
 *  so a refund is priced from data, never from a store. */
export interface BranchedTrack {
  readonly tier: number;
  readonly price: number;
}
/** Unit id -> each of its branched tracks, for every unit that has one. The economy's
 *  migrations, buy guards and the legacy Switch and Return read this table; a test builds it
 *  from inline fixtures, the app and the Worker from the shipped roster. */
export type BranchedTable = Readonly<Record<string, Readonly<Record<string, BranchedTrack>>>>;
export function branchedTable(roster: Iterable<UpgradableUnit>): BranchedTable {
  const out: Record<string, Record<string, BranchedTrack>> = {};
  for (const u of roster) {
    for (const track of branchedTracks(u)) {
      const tiers = u.upgrades?.[track]?.tiers ?? [];
      const last = tiers[tiers.length - 1];
      if (last === undefined) continue;
      (out[u.id] ??= {})[track] = { tier: tiers.length, price: last.price };
    }
  }
  return out;
}

/** Every track at its maximum tier — what the harness and the balance
 *  backtest run, to price and to simulate the fully-upgraded unit. A branched
 *  last tier also needs a pick (`maxPicks`), or `applyUpgrades` stops below it. */
export function maxTiers(unit: UpgradableUnit): Record<string, number> {
  const out: Record<string, number> = {};
  const tracks = unit.upgrades;
  if (!tracks) return out;
  for (const [name, track] of Object.entries(tracks)) {
    out[name] = track.tiers.length;
  }
  return out;
}

/** How kitted a unit is, as one number the garage, the HUD and the renderer
 *  all read (garage uplift §3.1, §6): tiers owned across every track over the
 *  sum of the tracks' lengths, in thirds, rounded UP -- so any purchase at all
 *  shows, and 7 of 9 already reads as the top level. "Every tier owned" is a
 *  different question (`kitCounts` answers it), and the two are kept apart. */
export type KitLevel = 0 | 1 | 2 | 3;

export interface KitCounts {
  readonly owned: number;
  readonly available: number;
}

/** Owned tiers clamped to each track's current length (data may SHRINK a
 *  track after a purchase -- `applyUpgrades`'s own rule), over the tiers
 *  the unit's own tracks declare. A tier map naming a track the unit does
 *  not have counts nothing; a negative or non-finite tier counts as 0. */
export function kitCounts(unit: UpgradableUnit, tiers: Readonly<Record<string, number>>): KitCounts {
  let owned = 0;
  let available = 0;
  for (const [name, track] of Object.entries(unit.upgrades ?? {})) {
    const len = track.tiers.length;
    available += len;
    const raw = tiers[name];
    owned += Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 0), len) : 0;
  }
  return { owned, available };
}

export function kitLevel(unit: UpgradableUnit, tiers: Readonly<Record<string, number>>): KitLevel {
  const { owned, available } = kitCounts(unit, tiers);
  if (available === 0 || owned === 0) return 0;
  const thirds = Math.ceil((3 * owned) / available);
  return thirds >= 3 ? 3 : thirds === 2 ? 2 : 1;
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
 *  programming error, not a data error to recover from.
 *
 *  `picks` (GH-1384) names, per TRACK, which branch of that track's branched tier is
 *  owned. It is REQUIRED, with no default, so the compiler lists every caller: a default
 *  of `{}` would let one silently drop a player's branched tier. A branched tier with no
 *  pick, or a pick that is not 1 or 2, is NOT applied, and the walk stops below it (the
 *  track resolves as owned to the tier under it): an unpicked branched tier is never free
 *  stats, and never "both". The pick is looked up by THAT track inside the per-track loop,
 *  so two branched tracks resolve independently. */
export function applyUpgrades<T extends UpgradableUnit>(
  unit: T,
  tiers: Readonly<Record<string, number>>,
  picks: BranchPicks
): T {
  // Top-level shallow copy so the identity case still returns a new object,
  // and so every field addDeltaAlongPath does not touch is shared by
  // reference with the input (acceptable per the brief).
  const out: Record<string, unknown> = { ...(unit as Record<string, unknown>) };

  const tracks = unit.upgrades;

  // Resolve to one delta per whitelisted path in two stages. WITHIN a
  // track, a tier's patch is the cumulative delta over BASE, not over the
  // previous tier, so the highest achieved tier's value for a given path
  // supersedes an earlier tier's value for that same path rather than
  // adding to it -- walking tiers 0..tierIndex-1 in order and letting a
  // later write win produces exactly that. ACROSS tracks, each track is an
  // independent improvement over the same base, so two tracks that happen
  // to patch the same path (e.g. an armour track and a survivability track
  // both raising hull.hp) both contribute and their resolved deltas SUM.
  // Track names walked in a fixed, canonical (lexicographic) order rather
  // than object-insertion order -- an account's owned-tiers map and a unit's
  // `upgrades` JSON both key by track name with no ordering guarantee of
  // their own, and float addition is not associative: summing the same two
  // deltas in the opposite order can read back a different (if
  // ULP-adjacent) float. Sorting `tiers`'s own keys makes `merged`'s
  // per-path sum order depend only on the SET of requested tracks, never on
  // the order the caller happened to write them or the JSON parsed them in.
  const merged: Record<string, number> = {};
  for (const trackName of Object.keys(tiers).sort()) {
    const requestedTier = tiers[trackName];
    const track = tracks?.[trackName];
    if (!track) continue; // unknown track: ignored

    const tierIndex = Math.min(Math.max(requestedTier, 0), track.tiers.length); // clamp to max
    const perTrack: Record<string, number> = {};
    for (let i = 0; i < tierIndex; i++) {
      const patch = tierPatch(track.tiers[i], picks[trackName]);
      if (patch === undefined) break; // a branched tier with no pick: stop below it
      for (const [path, delta] of Object.entries(patch)) {
        if (!isWhitelisted(path)) {
          throw new Error(`applyUpgrades: patch path "${path}" is outside the UPGRADE_PATHS whitelist`);
        }
        perTrack[path] = delta; // last tier within this track wins
      }
    }
    for (const [path, delta] of Object.entries(perTrack)) {
      merged[path] = (merged[path] ?? 0) + delta; // sum across tracks
    }
  }

  for (const [path, delta] of Object.entries(merged)) {
    addDeltaAlongPath(out, path, delta, unit.id);
  }

  return out as T;
}
