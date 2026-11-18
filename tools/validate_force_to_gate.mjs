// GH-1438 E13 rule (b), the force-to-gate rule (docs/campaign/civilian-drama.md §10.2 E13, §11.1.2, §11.3).
//
// The rule: after the start layout, no GROUND side-0 unit stands within 4.5 tiles of a civilian body, a muster
// marker or a gate centre. 4.5 is the shepherd radius (4 tiles, `SHEPHERD_RADIUS_SQ`, civilians.ts) plus 0.5; the
// lead relaxed it from 5 on 18 Nov because the breach's `at_team` stands 4.61 tiles from the west gate (V23).
// Why: a ground soldier within 4 tiles walks a family out (`CivilianFlight.step`), and a gate opens for one
// (E1). A force that STARTS that close evacuates people, or opens the compound, for a player who never moves:
// the passive player wins (§1.1, "why the muster is the anti-passive rule").
//
// The three kinds of point:
//   - a civilian body: every surface body of `civilians.groups` (a buried one, `in_tunnel`, reaches nobody);
//   - a muster marker: the `to` of a `withdraw_to` trigger whose group is ALL civilian (rule (a)'s wording: a group
//     declared by at least one civilian placement and by no placement of any other side). No shipped mission has one
//     yet (§1.1), so this part is live only on the fixtures until the first crowd ships;
//   - a gate centre: a structure whose TYPE carries a `gate` block (E1, §2.2), from the map grid (a contiguous run of
//     its symbol, as parseMap builds it, or one tile for a per_tile type) or from the mission's `structures[]`
//     (`at` + `size` / 2, default [2,2]). Until E1 adds `gate` to structure.schema.json and `compound_gate` to
//     data/structures.json, no type has the block and this part is inert on shipped data.
//
// Ground: a unit whose `mobility.domain` is not `air` (`isAir`, sim.ts; an aircraft walks nobody out, GH-279 a).
//
// Two readings, one rule. `forceToGateFailures` takes the POSITIONS; the callers decide where bodies stand:
//   - validate_data.mjs passes the AUTHORED spread (`authoredBodies`: the placement origin, a marker +0.5 to its tile
//     centre, then 1.25 tiles east and south per body, exactly `spawnPlacement`'s SPREAD). It needs no sim, so an
//     author sees the failure from `pnpm validate:data`.
//   - tools/src/validate_force_to_gate.test.ts builds every shipped mission's world and passes where the bodies stand
//     after `MissionRuntime.start()`, the start layout applied (38 of 39 shipped missions are `assembly`, which moves a
//     body up to 11 tiles). That is the doc's reading ("after the start layout"); validate_data.mjs cannot import the
//     sim, so it is a test, and a mission must pass both.
//
// Its own module because validate_data.mjs runs its whole sweep at import time and exits.

/** The clearance, in tiles: the shepherd's 4 plus 0.5 (the lead, 18 Nov). */
export const FORCE_CLEARANCE_TILES = 4.5;

/**
 * Missions excused from the rule, each with its reason. Every entry carries a demotion check in the test: when the
 * mission passes without it, the test fails and the entry is deleted.
 */
export const FORCE_CLEARANCE_EXEMPT = {
  // The two civilians at (24.5, 33.5) shelter among the starting force (inf_squad at (24, 34)): 1.03 tiles after the
  // assembly, 0.56 authored. They are walked out at t=0 and count toward `get_them_out` (5 of 8), so a passive player
  // banks two of the five. The other three must be the four hostages from (22.5, 9.5), deep in the enemy's ground,
  // and the passive control loses. Moving them is a content change for mission-author and the lead (HOLD FOR LEAD).
  beit_sahwan_4_subterranean: 'two start-line civilians among the force (GH-1438 E13, held for the lead)',
};

/** Spawn spread between bodies of one placement, tiles (`SPREAD`, mission.ts). */
const SPREAD_TILES = 1.25;

/** The origin a placement spreads from: `at` exactly, a marker at its tile centre, else the map's `player_start`. */
function originOf(p, markers, playerStart) {
  if (p.marker !== undefined) {
    const m = markers?.[p.marker];
    return m ? [m[0] + 0.5, m[1] + 0.5] : null;
  }
  if (Array.isArray(p.at)) return [p.at[0], p.at[1]];
  return Array.isArray(playerStart) ? [playerStart[0], playerStart[1]] : null;
}

/**
 * Every body of `placements` where `spawnPlacement` first puts it, before any start layout: body k at the origin plus
 * (k % 3) x 1.25 east and floor(k / 3) x 1.25 south. `keep(p)` filters placements (ground only, surface only).
 */
export function authoredBodies(placements, markers, playerStart, keep = () => true) {
  const out = [];
  for (const p of placements ?? []) {
    if (!keep(p)) continue;
    const o = originOf(p, markers, playerStart);
    if (o === null) continue; // an unknown marker is reported by the marker cross-check
    const n = typeof p.count === 'number' ? p.count : 1;
    for (let k = 0; k < n; k++) {
      out.push({ label: `${p.unit}#${k}`, x: o[0] + (k % 3) * SPREAD_TILES, y: o[1] + ((k - (k % 3)) / 3) * SPREAD_TILES });
    }
  }
  return out;
}

/** Group ids declared ONLY by civilian placements (rule (a)'s "all-civilian"). */
function civilianOnlyGroups(mission) {
  const civ = new Set();
  for (const p of mission?.civilians?.groups ?? []) if (p.group !== undefined) civ.add(p.group);
  const other = [
    ...(mission?.starting_force ?? []),
    ...(mission?.enemy?.garrison ?? []),
    ...(mission?.enemy?.waves ?? []).flatMap((w) => w.units ?? []),
    ...(mission?.triggers ?? []).flatMap((t) => t.do?.units ?? []),
  ];
  for (const p of other) if (p.group !== undefined) civ.delete(p.group);
  return civ;
}

/** Muster markers, as points: every `withdraw_to` on an all-civilian group, its `to` at the marker's tile centre. */
export function musterPoints(mission, markers) {
  const civ = civilianOnlyGroups(mission);
  const out = [];
  for (const t of mission?.triggers ?? []) {
    if (t.do?.kind !== 'withdraw_to' || !civ.has(t.do.group) || t.do.to === undefined) continue;
    const m = markers?.[t.do.to];
    if (m) out.push({ label: `muster "${t.do.to}"`, x: m[0] + 0.5, y: m[1] + 0.5 });
  }
  return out;
}

/**
 * Gate centres: every structure of a type with a `gate` block (E1), from the map grid and from `mission.structures`.
 * `types` is data/structures.json's `types` object; `map` the raw map JSON (`width`, `height`, `rows`).
 */
export function gateCentres(mission, map, types) {
  const gateTypes = Object.values(types ?? {}).filter((t) => t && typeof t.gate === 'object' && t.gate !== null);
  const out = [];
  const rows = map?.rows ?? [];
  const width = map?.width ?? 0;
  const height = map?.height ?? 0;
  for (const t of gateTypes) {
    if (typeof t.symbol !== 'string') continue;
    // parseMap's fill: a 4-connected run of the same symbol is one structure (one tile each for a per_tile type).
    const seen = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (rows[y]?.[x] !== t.symbol || seen[y * width + x] === 1) continue;
        const tiles = [];
        const stack = [[x, y]];
        seen[y * width + x] = 1;
        while (stack.length > 0) {
          const [cx, cy] = stack.pop();
          tiles.push([cx, cy]);
          if (t.per_tile === true) continue;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            if (seen[ny * width + nx] === 1 || rows[ny][nx] !== t.symbol) continue;
            seen[ny * width + nx] = 1;
            stack.push([nx, ny]);
          }
        }
        const cx = tiles.reduce((s, [tx]) => s + tx + 0.5, 0) / tiles.length;
        const cy = tiles.reduce((s, [, ty]) => s + ty + 0.5, 0) / tiles.length;
        out.push({ label: `gate ${t.id} at (${cx}, ${cy})`, x: cx, y: cy });
      }
    }
  }
  const gateIds = new Set(gateTypes.map((t) => t.id));
  for (const s of mission?.structures ?? []) {
    if (!gateIds.has(s.type) || !Array.isArray(s.at)) continue;
    const [w, h] = Array.isArray(s.size) ? s.size : [2, 2];
    const cx = s.at[0] + w / 2;
    const cy = s.at[1] + h / 2;
    out.push({ label: `gate ${s.type} at (${cx}, ${cy})`, x: cx, y: cy });
  }
  return out;
}

const fmt = (v) => (Math.round(v * 100) / 100).toString();

/**
 * The rule over positions. `force`: the ground side-0 bodies; `civilians`, `musters`, `gates`: the points to keep
 * clear. Each is `{ label, x, y }` in tiles. One failure per (unit, point) pair inside the clearance.
 */
export function forceToGateFailures({ force = [], civilians = [], musters = [], gates = [] }, file, clearance = FORCE_CLEARANCE_TILES) {
  const out = [];
  const limitSq = clearance * clearance;
  const kinds = [
    ['civilian', civilians],
    ['muster', musters],
    ['gate', gates],
  ];
  for (const u of force) {
    for (const [kind, points] of kinds) {
      for (const p of points) {
        const dx = u.x - p.x;
        const dy = u.y - p.y;
        const dSq = dx * dx + dy * dy;
        if (dSq > limitSq) continue;
        out.push(
          `${file}: ground side-0 ${u.label} at (${fmt(u.x)}, ${fmt(u.y)}) starts ${fmt(Math.sqrt(dSq))} tiles from ` +
            `${kind === 'civilian' ? `civilian ${p.label}` : p.label}, inside ${clearance} (GH-1438 E13 b) -- a passive ` +
            `player would have people walked out, or a gate opened, for free`
        );
      }
    }
  }
  return out;
}

/**
 * validate_data.mjs's reading: the authored spread, no sim. `unitsById` resolves a unit's domain (an aircraft is not
 * ground). A mission in FORCE_CLEARANCE_EXEMPT is skipped.
 */
export function authoredForceToGateFailures(mission, map, types, unitsById, file) {
  if (mission?.id !== undefined && Object.hasOwn(FORCE_CLEARANCE_EXEMPT, mission.id)) return [];
  const markers = map?.markers ?? {};
  const playerStart = mission?.map?.player_start;
  const ground = (p) => unitsById?.get?.(p.unit)?.mobility?.domain !== 'air';
  const surface = (p) => p.in_tunnel === undefined;
  return forceToGateFailures(
    {
      force: authoredBodies(mission?.starting_force, markers, playerStart, ground),
      civilians: authoredBodies(mission?.civilians?.groups, markers, playerStart, surface),
      musters: musterPoints(mission, markers),
      gates: gateCentres(mission, map, types),
    },
    file
  );
}
