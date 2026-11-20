// GH-1438 E8: the authoring guards on a `do.kind: abduct` trigger (docs/campaign/civilian-drama.md §10.2 E8). The
// runtime (`MissionRuntime.stepAbductions`) holds a captive while he is within six tiles of the escort's leader, the
// lowest-id living side-1 member of `group`, and takes him when he stands in `zone`. Each rule below is a way an abduct
// passes the schema and then quietly takes nobody, or counts the taken as saved.
//
// 1. Captives: `captives` is a group some `civilians.groups` placement declares (one on a soldier would lead soldiers).
// 2. Escort: `group` is an ENEMY group: declared by `enemy.garrison`, a wave or a `spawn` trigger, and by no
//    `starting_force`, `reinforce` or `civilians.groups` placement. Only a side-1 member leads, so a player or
//    civilian escort fires, latches and holds nobody (`start()` refuses the same at load for the bodies standing then).
// 3. `to` inside `zone`: the escort stops at `to`, so a `to` outside the exit zone parks the column beside it and the
//    captives are held round it forever. The refuge rule's twin (`evacuate_before`'s refuge marker, `start()`).
// 4. Start gap and reachability. The escort PACES to its captives (`MissionRuntime.stepAbductPace`: it halts while a
//    held captive is more than three tiles off and walks on once every one is within two), so no route is too long
//    and the route-length cap PR 1655 carried (R <= (6 - d0) x v_escort / (v_escort - v_captive) - 2, about 36 tiles
//    at the shipped `militia_cell` 0.95 t/s over `civilians` 0.8) is retired with it, and so is every use of the units'
//    speeds here. What pacing cannot mend is a captive who is never held at all, or an escort that cannot walk there:
//    captives that start more than six tiles off are refused, the gap being the largest authored distance between
//    an escort body and a captive body (`authoredBodies`, the placement spread) over EVERY pair, so a spread escort
//    whose actual leader (the lowest id) stands beside the captives can be refused on a far member's distance
//    (conservative, by design); and a `to` no walk reaches is refused. The walk is an octile shortest path (1 a step,
//    sqrt 2 a diagonal, no corner cutting) over the map's foot-passable tiles (every tile but `^` and a structure
//    symbol) from each escort body's tile to the `to` tile. Both are measured from the PLACEMENT: an escort that
//    patrols, or that an earlier order moves, before the trigger fires starts somewhere else, and placed gates in
//    mission `structures[]` are read as open ground. The sim pins the pacing at the shipped speeds
//    (packages/sim/src/abduct-pace.test.ts: taken on 60- and 120-tile routes, never more than 3.2 tiles behind).
// 5. Evacuation zones (a WARNING, report-only): a held captive standing in an `evacuate_before` zone is counted out
//    by `CivilianFlight.collect` as evacuated, a rescue that never happened. Warned when a tile of the walk in rule
//    4 (the shortest path, ties broken by scan order, so the sim's own field may pass beside it) lies in one.
//
// Its own module because validate_data.mjs runs its whole sweep at import time and exits.
import { authoredBodies } from './validate_force_to_gate.mjs';

/** The release radius, tiles: `ABDUCT_RELEASE_SQ = 36 * 65536` in packages/sim/src/mission.ts (pinned by the test). */
export const ABDUCT_RELEASE_TILES = 6;

const inRect = (z, x, y) => Array.isArray(z) && x >= z[0] && x < z[0] + z[2] && y >= z[1] && y < z[1] + z[3];

/** Placements by side, top level and their passengers (who spawn with the carrier's side and origin). */
function sidedPlacements(mission) {
  const enemy = [
    ...(mission?.enemy?.garrison ?? []),
    ...(mission?.enemy?.waves ?? []).flatMap((w) => (w.units ?? []).map((u) => (u.from !== undefined ? { ...u, marker: u.from } : u))),
    ...(mission?.triggers ?? []).flatMap((t) => (t.do?.kind === 'spawn' ? (t.do.units ?? []) : [])),
  ];
  const other = [
    ...(mission?.starting_force ?? []),
    ...(mission?.triggers ?? []).flatMap((t) => (t.do?.kind === 'reinforce' ? (t.do.units ?? []) : [])),
    ...(mission?.civilians?.groups ?? []),
  ];
  const withRiders = (list) =>
    list.flatMap((p) => [p, ...(p.passengers ?? []).map((q) => ({ ...q, at: p.at, marker: p.marker }))]);
  return { enemy: withRiders(enemy), other: withRiders(other) };
}

/**
 * Octile shortest-path distance, in tiles, from every foot-passable tile to `goal` (Dijkstra; `Infinity` where none),
 * and the next tile toward the goal. Diagonals may not cut a blocked corner.
 */
function routeField(map, blockedSyms, goal) {
  const rows = map.rows ?? [];
  const h = rows.length;
  const w = h > 0 ? rows[0].length : 0;
  const open = (x, y) => x >= 0 && y >= 0 && x < w && y < h && rows[y][x] !== '^' && !blockedSyms.has(rows[y][x]);
  const dist = new Float64Array(w * h).fill(Infinity);
  const next = new Int32Array(w * h).fill(-1);
  if (!open(goal[0], goal[1])) return { dist, next, w };
  const heap = []; // [d, index], a binary min-heap
  const push = (d, i) => {
    heap.push([d, i]);
    for (let k = heap.length - 1; k > 0; ) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      for (let k = 0; ; ) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  const g = goal[1] * w + goal[0];
  dist[g] = 0;
  push(0, g);
  while (heap.length > 0) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx === 0 && dy === 0) || !open(x + dx, y + dy)) continue;
        if (dx !== 0 && dy !== 0 && (!open(x + dx, y) || !open(x, y + dy))) continue;
        const j = (y + dy) * w + (x + dx);
        const nd = d + (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
        if (nd < dist[j]) {
          dist[j] = nd;
          next[j] = i;
          push(nd, j);
        }
      }
    }
  }
  return { dist, next, w };
}

/**
 * Every abduct trigger's authoring faults (`failures`) and its evacuation-zone crossing (`warnings`).
 * `blockedSyms` is the map symbols a foot soldier cannot enter besides `^` (the structure catalogue's symbols).
 */
export function abductFailures(mission, map, blockedSyms, file) {
  const failures = [];
  const warnings = [];
  const triggers = mission?.triggers ?? [];
  const markers = map?.markers ?? {};
  const zones = map?.zones ?? {};
  const { enemy, other } = sidedPlacements(mission);
  for (const [i, t] of triggers.entries()) {
    if (t.do?.kind !== 'abduct') continue;
    const name = t.id ?? `trigger_${i}`;
    const head = `${file}: abduct trigger "${name}"`;
    // Rule 1.
    const civ = (mission?.civilians?.groups ?? []).filter((p) => p.group !== undefined && p.group === t.do.captives);
    if (civ.length === 0) {
      failures.push(`${head} names captives "${t.do.captives}", which no civilians.groups placement declares`);
    }
    // Rule 2. An escort no placement declares at all is the shared "names group ... which no placement declares".
    const escort = enemy.filter((p) => p.group !== undefined && p.group === t.do.group);
    if (t.do.group !== undefined && other.some((p) => p.group === t.do.group)) {
      failures.push(
        `${head} escort group "${t.do.group}" is declared by a starting_force, reinforce or civilians placement; ` +
          `only an enemy (side 1) member leads, so it would hold nobody`
      );
    }
    // Rule 3.
    const to = t.do.to !== undefined ? markers[t.do.to] : undefined;
    const exit = t.do.zone !== undefined ? zones[t.do.zone] : undefined;
    if (to !== undefined && exit !== undefined && !inRect(exit, to[0], to[1])) {
      failures.push(
        `${head} marker "${t.do.to}" is outside zone "${t.do.zone}": the escort stops there and nobody is ever taken`
      );
    }
    // Rule 4 (and 5). Needs a `to`, an escort and captives to measure; their absence is reported above or elsewhere.
    if (to === undefined || escort.length === 0 || civ.length === 0) continue;
    const eb = authoredBodies(escort, markers, map?.player_start);
    const cb = authoredBodies(civ, markers, map?.player_start);
    let gap = 0;
    for (const e of eb) for (const c of cb) gap = Math.max(gap, Math.hypot(e.x - c.x, e.y - c.y));
    const field = routeField(map, blockedSyms, to);
    if (eb.length === 0) continue;
    const starts = eb.map((e) => Math.floor(e.y) * field.w + Math.floor(e.x));
    let route = 0;
    for (const s of starts) route = Math.max(route, field.dist[s] ?? Infinity);
    if (route === Infinity) {
      failures.push(`${head}: no walking route from escort "${t.do.group}" to marker "${t.do.to}"`);
      continue;
    }
    if (gap > ABDUCT_RELEASE_TILES) {
      failures.push(
        `${head}: its captives start ${gap.toFixed(1)} tiles from escort "${t.do.group}", past the ` +
          `${ABDUCT_RELEASE_TILES}-tile release: none would ever be held`
      );
    }
    // Rule 5: walk each escort body's path to the goal; one warning a trigger.
    const evac = (mission?.objectives ?? [])
      .filter((o) => o.type === 'evacuate_before' && zones[o.target] !== undefined)
      .map((o) => o.target);
    let crossed = null;
    for (const s of starts) {
      for (let k = s; k >= 0 && crossed === null && evac.length > 0; k = field.next[k]) {
        const x = k % field.w;
        const y = (k - x) / field.w;
        const hit = evac.find((z) => inRect(zones[z], x, y));
        if (hit !== undefined) crossed = { hit, x, y };
      }
    }
    if (crossed !== null) {
      warnings.push(
        `${head}: the escort's route to "${t.do.to}" crosses evacuate_before zone "${crossed.hit}" at ` +
          `(${crossed.x}, ${crossed.y}); a held captive standing there is counted out as evacuated`
      );
    }
  }
  return { failures, warnings };
}
