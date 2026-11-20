// GH-1438 E13 rules (a) and (c), the muster and sealed-compound rules (docs/campaign/civilian-drama.md §10.2 E13,
// §1.1 "why the muster is the anti-passive rule"). Rule (b), the force-to-gate clearance, is
// tools/validate_force_to_gate.mjs (PR 1604).
//
// A MUSTER is the `to` of a `withdraw_to` trigger whose group is ALL civilian (a group declared by at least one
// `civilians.groups` placement and by no placement of any other side: `civilianOnlyGroups`, shared with rule (b)).
// At about t=2 the crowd runs there and waits. Only a KDF ground unit within 4 tiles (the shepherd rule) or an open
// gate plus a shepherd should move it the rest of the way. Two ways a mission breaks that, and lets a passive player
// win `evacuate_before`:
//
//   (a) the muster marker's tile lies INSIDE an `evacuate_before` zone: the crowd runs into its own refuge and
//       `CivilianFlight.collect` counts it in. Checked against EVERY evacuate_before zone of the mission, whatever its
//       `group` (E3): a person standing in any active evacuation's zone is that zone's to count.
//   (c) a SEALED COMPOUND that is not sealed: on a mission with a gate (a structure whose type carries E1's `gate`
//       block, in the map grid or in `structures[]`), a flood from the muster tile over the foot-passable ground, every
//       gate tile blocked, reaches the refuge. Fire landing near a civilian sends him to the refuge (the flight rule,
//       `civilians.ts`), so a crowd that can walk round the gate leaks in for a player who never moves.
//       "Reaches the refuge" = the flood touches the `civilians.refuge` marker's tile OR any tile of any
//       `evacuate_before` zone (`collect` counts on the zone, and `start()` refuses a refuge outside its zone, so the
//       zone tiles are the honest target; the refuge tile alone would miss a zone that pokes outside the wall).
//
// The flood: 4-connected over every tile that is not `^`, not a structure symbol of `types` (data/structures.json's
// `types`; a gate's own symbol included) and not inside a mission `structures[]` footprint (`at` + `size`, default
// [2,2], as `raiseMissionStructures` raises it; a placed gate included). The flow field steps diagonally only when
// both orthogonal companions are open (no corner cutting, flowfield.ts), so its reachable set is exactly the
// 4-connected one. `b`, `d` and `~` are open: civilians are on foot. What the flood does NOT see: a tunnel (a
// civilian does not take one on his own), a structure destroyed in play (a breach the player or the enemy makes is not
// the passive case), and elevation (it changes cost, never whether a tile is passable).
//
// SCOPE of (c), a reading: a mission with NO gate has no compound to seal, and rule (c) is silent there. The doc's own
// musters include "a wadi mouth, a road junction" (§1.1) with no gate at all, S0 and S1 (§10.1.9) ship the crowd with
// the gate as a 2-wide gap, and Beit Sahwan IV (PR 1610) ships four gate-less musters whose crowds can walk to its
// collection point (tools/src/validate_muster.test.ts pins that). Applied to them, the rule would refuse the design.
//
// Its own module because validate_data.mjs runs its whole sweep at import time and exits.
import { civilianOnlyGroups, gateCentres } from './validate_force_to_gate.mjs';

const inRect = (z, x, y) => Array.isArray(z) && x >= z[0] && x < z[0] + z[2] && y >= z[1] && y < z[1] + z[3];

/** Every muster: `{ trigger, marker, tile }` for each withdraw_to on an all-civilian group whose `to` is a known marker. */
export function musters(mission, markers) {
  const civ = civilianOnlyGroups(mission);
  const out = [];
  for (const t of mission?.triggers ?? []) {
    if (t.do?.kind !== 'withdraw_to' || !civ.has(t.do.group) || t.do.to === undefined) continue;
    const m = markers?.[t.do.to];
    if (Array.isArray(m)) out.push({ trigger: t.id ?? '(unnamed)', marker: t.do.to, tile: [m[0], m[1]] });
  }
  return out;
}

/** The `evacuate_before` zones of a mission, `{ objective, zone, rect }`, resolved against the map's zones. */
function evacuationZones(mission, map) {
  const out = [];
  for (const o of mission?.objectives ?? []) {
    if (o.type !== 'evacuate_before') continue;
    const rect = map?.zones?.[o.target];
    if (Array.isArray(rect)) out.push({ objective: o.id, zone: o.target, rect });
  }
  return out;
}

/** Rule (a): one failure per muster whose marker tile is inside an evacuate_before zone. */
export function musterZoneFailures(mission, map, file) {
  const out = [];
  const zones = evacuationZones(mission, map);
  for (const m of musters(mission, map?.markers)) {
    for (const z of zones) {
      if (!inRect(z.rect, m.tile[0], m.tile[1])) continue;
      out.push(
        `${file}: withdraw_to "${m.trigger}" musters the crowd at "${m.marker}" (${m.tile[0]}, ${m.tile[1]}), inside ` +
          `evacuate_before "${z.objective}"'s zone "${z.zone}" -- the crowd would run into its own refuge and count ` +
          `itself in (GH-1438 E13 a)`
      );
    }
  }
  return out;
}

/**
 * The foot mask at mission start, every gate shut: 1 = a civilian cannot stand there. `types` is data/structures.json's
 * `types`; `map` the raw map JSON (`rows`).
 */
export function footBlocked(mission, map, types) {
  const rows = map?.rows ?? [];
  const h = rows.length;
  const w = h > 0 ? rows[0].length : 0;
  const syms = new Set(['^']);
  for (const t of Object.values(types ?? {})) if (typeof t?.symbol === 'string') syms.add(t.symbol);
  const blocked = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (syms.has(rows[y][x])) blocked[y * w + x] = 1;
  for (const s of mission?.structures ?? []) {
    if (!Array.isArray(s.at)) continue;
    const [sw, sh] = Array.isArray(s.size) ? s.size : [2, 2];
    for (let y = s.at[1]; y < s.at[1] + sh; y++) {
      for (let x = s.at[0]; x < s.at[0] + sw; x++) if (x >= 0 && y >= 0 && x < w && y < h) blocked[y * w + x] = 1;
    }
  }
  return { blocked, w, h };
}

/**
 * Where each muster's crowd can walk, every gate shut: `{ muster, reached }` per muster, `reached` the first refuge or
 * evacuation-zone tile the flood meets (breadth-first, so the nearest in steps), or null. No gate scope here: rule (c)
 * applies it; the test reads the raw reach on gate-less missions.
 */
export function musterReach(mission, map, types) {
  const { blocked, w, h } = footBlocked(mission, map, types);
  const targets = new Uint8Array(w * h);
  const what = new Map();
  const mark = (x, y, label) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (targets[i] === 1) return;
    targets[i] = 1;
    what.set(i, label);
  };
  const refuge = mission?.civilians?.refuge;
  const rm = refuge !== undefined ? map?.markers?.[refuge] : undefined;
  if (Array.isArray(rm)) mark(rm[0], rm[1], `the refuge "${refuge}"`);
  for (const z of evacuationZones(mission, map)) {
    const [zx, zy, zw, zh] = z.rect;
    for (let y = zy; y < zy + zh; y++) for (let x = zx; x < zx + zw; x++) mark(x, y, `evacuate_before "${z.objective}"'s zone "${z.zone}"`);
  }
  const out = [];
  for (const m of musters(mission, map?.markers)) {
    const [sx, sy] = m.tile;
    let reached = null;
    if (sx >= 0 && sy >= 0 && sx < w && sy < h && blocked[sy * w + sx] === 0) {
      const seen = new Uint8Array(w * h);
      const queue = [sy * w + sx];
      seen[queue[0]] = 1;
      for (let q = 0; q < queue.length && reached === null; q++) {
        const i = queue[q];
        if (targets[i] === 1) {
          reached = { x: i % w, y: (i - (i % w)) / w, what: what.get(i) };
          break;
        }
        const x = i % w;
        const y = (i - x) / w;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (seen[j] === 1 || blocked[j] === 1) continue;
          seen[j] = 1;
          queue.push(j);
        }
      }
    }
    out.push({ muster: m, reached });
  }
  return out;
}

/** Rule (c): on a mission with a gate, one failure per muster whose crowd reaches the refuge with every gate shut. */
export function sealedCompoundFailures(mission, map, types, file) {
  if (gateCentres(mission, map, types).length === 0) return [];
  const out = [];
  for (const { muster: m, reached } of musterReach(mission, map, types)) {
    if (reached === null) continue;
    out.push(
      `${file}: withdraw_to "${m.trigger}" musters the crowd at "${m.marker}" (${m.tile[0]}, ${m.tile[1]}), and with ` +
        `every gate shut it can still walk to ${reached.what} at (${reached.x}, ${reached.y}) -- the compound is not ` +
        `sealed, so a passive player's crowd leaks in (GH-1438 E13 c)`
    );
  }
  return out;
}
