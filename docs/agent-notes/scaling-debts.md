# Known scaling debts: full record

Moved verbatim from `CLAUDE.md` (origin/main `f946bb16`, 2026-10-25) when that file was slimmed to its rules.
The rules distilled from these passages stay in `CLAUDE.md`; this file keeps the measurements, history,
reasoning and superseded statements behind them, unedited. Nothing here has been pruned yet.

<!-- CLAUDE.md lines 2237-2339, section "Known scaling debts" -->

## Known scaling debts

- **`roster.surviving_units` is CUMULATIVE since the motivation-layer branch, and it
  grows every mission.** `checkEnd` used to rebuild the roster from `playerIds` alone, so
  a pool entry no placement fielded was silently deleted; it now writes the fielded
  survivors and then appends every unfielded pool entry unchanged (spec §4.7). The
  consequence nobody asked for is arithmetic: a mission's survivors include units that
  were never in the pool -- every `starting_force` placement without `from_ledger` spawns
  fresh, and whatever lives writes a NEW entry -- so the pool APPENDS rather than
  replaces, and a replay appended again until roster rule R-2 (below). Measured in
  `pnpm playtest`: the Beit
  Sahwan chain's final roster went **10 -> 23** and Umm Zeitoun's **12 -> 26** (re-measured
  2026-09-11: 23 and 26 stand, with `beit_sahwan_1_recon` already at 17). Nothing in the
  sim scans the roster per tick, so this is not a tick cost -- it is a SAVE that grew
  without bound and a deploy panel that would have named a force three times the size of
  the one on the map. The panel is fixed (`broughtFor` scopes to this mission's own
  `from_ledger` draws and prints the rest as one `N in reserve` line). **The roster is
  capped now, and a replay no longer appends -- both in the APP's victory write
  (`applyRosterCarryover`, `packages/app/src/roster-carryover.ts`), not in `checkEnd`,
  which still only appends the unfielded pool as described above.** `ROSTER_CAP = 150`
  (WP-G-E2, `roster-cap.ts`, about 5x the ladder maximum `pnpm playtest` measures) stands
  the overflow down to `roster.reserve` in a fixed order (veterancy, then `missions`,
  then `kills`, newest place first) and deletes nothing. Roster rule R-2 (the lead, 7 Oct
  2026, GH-417; `isReplayed`): every fresh body is stamped `enlisted` with the mission
  that brought it home, and winning that mission again replaces the earlier bodies it
  enlisted that were not fielded this time and have served nowhere else
  (`missions <= 1`), in the roster and in `roster.reserve`. A veteran who fought in
  another mission stays, as does anything another mission enlisted; a defeat writes
  nothing, so it replaces nothing. A save from before R-2 carries no `enlisted` stamp,
  so its earlier duplicates stay until they fall or the cap stands them down.
- Detection is O(N²) pairs per tick. **The "~150 units" figure this line used to
  carry was a guess and it was wrong by an order of magnitude** — measured
  2026-08-30 (`docs/PERFORMANCE.md`, "Sim tick cost"), the 300-unit GDD target
  runs at **2.08 ms, 4.2% of the 50 ms budget**, and the budget is not crossed
  until ~1,700–2,100 living units. Nothing needs staggering today.
  Two corrections worth carrying when it eventually does. **`selectTarget`
  (`sim.ts:2603`) is a SECOND O(N²) scan** — every living shooter scans every
  entity for every weapon slot, every tick — and together with `stepDetection`
  it owns 85–95% of tick cost at every checkpoint. Those two are the targets,
  not the trail scan below. And **every per-tick scan bounds on `this.count`,
  the LIFETIME spawn count, never decremented** — so a freshly-spawned
  2,100-unit world costs 58 ms where the same `this.count` battle-worn costs
  39 ms. Attrition makes the sim faster, and a long mission with heavy churn
  keeps paying for units that died an hour ago.
- Rigged mesh units cap out around **420-460** of the same infantry type, measured
  against a real export on a real `WebGLRenderer` with hardware acceleration
  confirmed, across repeated runs. That clears the GDD's 300-unit target with
  margin, so it is not blocking. The bottleneck is **draw-call submission**
  (74-84% of `renderer.render()`), NOT `AnimationMixer` update and NOT
  bone-matrix computation — which matters, because it means vertex count is
  comparatively cheap (the rifle went 144 → 612 verts for zero new draw calls)
  and the remedy is fewer submissions rather than simpler geometry. `SkinnedMesh`
  does **not** instance in three.js: `InstancedMesh` and skinning do not compose,
  so N units is N × (meshes per team) draw calls. The known remedy for pushing
  past the ceiling is a vertex animation texture — bake clips into a texture,
  drop runtime skinning, use `InstancedMesh` with a per-instance time offset;
  VRAM cost is small (~22-130 MB against the existing 584 MB sprite budget).
  **Unresolved before VAT could ship:** R0's "no band crawl" result was measured
  against continuous real-time skinning, not against VAT's baked-and-lerped
  normals, and the toon ramp is indexed BY NORMAL — so that finding needs
  re-verifying, not assuming. Harness: `tools/src/perf/three-units.ts`.
  **Re-measured 2026-08-30 against this branch's HEAD** (three.js now the
  default renderer; vehicle/building meshes, rigged infantry, and continuous
  vehicle dust/exhaust FX all draw) — see `docs/PERFORMANCE.md`, which is now
  the durable home for this evidence (the prior report lived only in a
  gitignored `.superpowers/` file, unreachable outside the session that
  produced it — `docs/superpowers/specs/2026-08-29-phase-d-todo.md` item #11).
  Same stand-in harness, real hardware GPU confirmed via
  `WEBGL_debug_renderer_info` (headless Chromium defaults to software
  SwiftShader rendering and must be launched with explicit ANGLE/Metal args to
  avoid it — a confound that cost one full mismeasurement while producing this
  note, recorded in the doc as a worked example of "state capture conditions
  with every number"), reproduced across two runs: the render budget is
  crossed around **~1,150 figures**, not lower than 420-460 — the original
  figure holds, with more margin than previously recorded, not less. (That
  run's billboard-vs-mesh comparison -- a quarter of a mixed roster swapped to
  meshes, +~1 ms p95 at 320 -- is history: since WP-A3.3 the harness loads
  every roster type's GLB, and that all-mesh curve read render p95 30.0 ms at
  266 living / 39.7 ms at 320 on ANGLE/Metal M3 Pro, `docs/PERFORMANCE.md`.)
- **The flow-field pool is bounded, since 2026-09-15** (group formations,
  `MAX_FLOW_FIELDS = 128`, `sim.ts`): `fieldFor` reuses the least-recently-issued
  field no living unit still follows once the pool is full, with a same-tick
  guard (`evictableField`) so a field created earlier in the current tick can
  never be evicted out from under the order that just created it — without it,
  a mixed-domain order (air before ground in one command) could recompute the
  ground unit's own just-issued field for the air goal before it was stamped
  into anyone's `fieldRef`. `fields` never shrinks, so a same-tick spike that
  pushes the pool past the cap is a permanent watermark, not a transient one.
  The compute heap is shared module-wide rather than per-field: on a 48×48 map
  (2304 cells) a `FlowField` instance fell from 158,976 B (dirs + cost + its
  own 8×4 B/cell heap arrays) to 11,520 B (dirs + cost only), with the 147,456 B
  scratch heap allocated once and reused by every field's `compute` call — so
  the pool at its cap costs ~1.41 MiB (128 × 11,520 B) plus that one-time
  ~144 KiB — arithmetically, 128 × the OLD 158,976 B per-field size (each
  carrying its own heap) would have been ~19.4 MiB for the same 128 distinct
  goals, unbounded and still growing.
  A group order costs at most one field per unit ordered — measured on
  `tel_marum_2_foothold`'s 9-unit force ordered into the open basin,
  `sim.flowFieldCount` went 0 → 9 (`tools/src/formation_walk.test.ts`). The 128
  cap is a FLOOR, not a hard ceiling: `packages/sim/src/sim.test.ts`'s
  `flow-field cache` tests pin that the pool may still exceed it when every
  field is live, or when the only unreferenced fields were issued this tick.
  No shipped mission has been measured to reach it.

<!-- CLAUDE.md lines 2486-2492, section "Known scaling debts" -->

- The trail-detection scan is O(routes × living units × sight²) per tick
  (`trailStrengthFor`), on top of detection's existing O(N²) — and `markerSeeingRoute`
  is the same shape again for `mark_tunnel` carriers, though it stops scanning a
  route once identified. At the largest authored
  mission (65 units) that is ~10⁵ extra array probes a tick — immaterial now, real at the
  GDD's 300-unit target, and it wants staggering at the same time detection does.
  `drawTrail` is O(width × height × routes) at 5 Hz and belongs in the same sweep.
