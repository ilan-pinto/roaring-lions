// The catalogue of KNOWN, DELIBERATE divergences between PixiRenderer and
// ThreeRenderer, gathered from the Phase B1-B4 outcome docs
// (docs/superpowers/specs/2026-08-2[6-8]-phase-b*-outcome.md) and
// CLAUDE.md's "The three.js backend" section.
//
// This module does NOT filter or mask pixels -- Phase D's harness measures,
// it does not adjust the thing being measured (see the task brief). What it
// gives a human triaging a diff is a checklist to read BEFORE concluding a
// diff is a bug: "does this look like one of these?" A big diff that matches
// nothing here is the interesting case.
//
// Kept as data (not comments) so `report.ts` can print it and a CI/manual
// triage step never has to go spelunking through five outcome docs to
// remember why a building looks different.

export interface ExpectedDifference {
  id: string;
  /** One line, plain description of what a human will SEE in the diff. */
  symptom: string;
  /** Why it happens -- the mechanism, not just "known issue". */
  mechanism: string;
  /** Where this was established. */
  source: string;
  /** How to tell THIS is what you're looking at, vs a real regression. */
  howToConfirm: string;
}

export const EXPECTED_DIFFERENCES: readonly ExpectedDifference[] = [
  {
    id: 'structureLastAlpha',
    symptom:
      'Every destroyed building differs between backends -- the collapse starts at a ' +
      'visibly different brightness/alpha.',
    mechanism:
      "damageStructure pushes a structureHit event for the KILLING blow BEFORE " +
      "destroyStructure, and Pixi reads live hp off that event -- so Pixi's collapse " +
      "begins at its most-battered alpha, floored to 0.55, for every ordinary combat " +
      "kill. Three's beginCollapse starts at up to alpha 1.0. The two only agree when " +
      "the kill arrives with no preceding damage event (a demolition tick, a debug " +
      "destroy) -- there Pixi also starts near 1.0.",
    source: 'docs/superpowers/specs/2026-08-27-phase-b4-outcome.md, "An expected difference for Phase D\'s harness"',
    howToConfirm:
      'Diff region overlaps a structure footprint whose hp reached 0 during the captured ' +
      'window via ordinary weapons fire (not a demolition/debug kill). Expect a brightness ' +
      '(not colour-family) difference on the collapsing structure only.',
  },
  {
    id: 'antialiasing',
    symptom: 'A thin fringe of non-matching pixels along every drawn edge -- unit ' +
      'silhouettes, terrain tile boundaries, building edges.',
    mechanism:
      'Three renders with antialias:false by design (a blended edge pixel is not a ' +
      'palette colour -- Phase 0\'s central guarantee). Pixi\'s WebGL canvas is ' +
      'antialiased by default, so it blends edge pixels toward neighbouring colours. ' +
      'The two edge-rendering strategies cannot agree pixel-for-pixel.',
    source:
      'docs/superpowers/specs/2026-08-26-phase-0-verdict.md, "Antialiasing must be off, or ' +
      'accounted for"; task prompt.',
    howToConfirm:
      'Differing pixels form a 1-2px band that traces silhouette/tile edges rather than ' +
      'solid interior regions, and the colour delta at those pixels is small (an ' +
      'interpolated blend), not a palette-to-palette jump.',
  },
  {
    id: 'meshUnits',
    symptom:
      'A unit type drawn as a rigged 3D mesh under three has no counterpart shape in ' +
      'Pixi at all -- not a colour or edge difference, an entirely different silhouette.',
    mechanism:
      'Mesh units (packages/render/src/three/units/mesh-*.ts) have no Pixi rendering ' +
      'path whatsoever. Pixi always draws the billboard sprite for that type. REWRITTEN ' +
      '2026-09-01: this entry used to say "currently inf_squad under ?renderer=three&mesh", ' +
      'and its howToConfirm told a triager to check that "the &mesh flag was on ... the ' +
      'harness default" being flag OFF. Both halves are now false and the second was ' +
      'actively harmful -- it would lead a triager to rule this entry OUT on every ' +
      'modern run. Since the mesh flip (362bde7) meshes are the DEFAULT on three for ' +
      'every type with a shipped GLB, with no flag; `&mesh` is accepted and does ' +
      'nothing; the opt-out is `&nomesh`. Scope is no longer one unit type -- it is most ' +
      'of the roster plus civilians (2ed7e7c) and vehicles.',
    source:
      'CLAUDE.md, "Mesh units"; commit 362bde7 (meshes default, &mesh becomes &nomesh); ' +
      'measured 2026-09-01, see meshBuildingsAndDecor below for the numbers.',
    howToConfirm:
      'This is the DEFAULT state of any three capture -- assume it is present unless ' +
      '`&nomesh` was on. To measure how much of a diff it accounts for, re-capture three ' +
      'with `&nomesh` appended and diff that against the same Pixi capture; the ' +
      'difference between the two percentages is this entry plus meshBuildingsAndDecor.',
  },
  {
    id: 'meshBuildingsAndDecor',
    symptom:
      'Large SOLID-INTERIOR regions -- whole buildings, compounds and vegetation -- in a ' +
      'different colour family and a different shape between backends. On ' +
      'beit_sahwan_outskirts at town_center: Pixi draws a flat cream mosque compound, a ' +
      'small tan building and round green tree canopies; three draws a terracotta mesh ' +
      'compound, a detailed walled construction site (brick coursing, rebar, tanks, ' +
      'pipes) and bare brown branching trees. Not an edge fringe -- Pixi has no ' +
      'counterpart geometry at all.',
    mechanism:
      'Building meshes (f3c9ba5) and scattered decor meshes (edf45ff, a34bca7; mesh trees ' +
      'replaced the procedural canopy in c452d5d) draw by default on three and have no ' +
      'Pixi path, exactly as meshUnits above. Pixi keeps its billboard/procedural ' +
      'rendering. This is the SAME permanent, by-design asymmetry, and it is the single ' +
      'largest contributor to every scenario the CI gate runs.',
    source:
      'Measured 2026-09-01 at HEAD 5ccdafc, headless Chromium (software GL), 1400x900, ' +
      'via a `&nomesh` A/B against the identical Pixi capture. pixi-vs-three with meshes ' +
      'ON vs with `&nomesh`: quiet 2.556% -> 0.255%, open-ground 7.094% -> 2.132%, ' +
      'vehicle 5.426% -> 1.312%, combat 11.971% -> 5.996%. With `&nomesh` all four sit ' +
      'INSIDE their SCENARIO_BUDGETS; with meshes on all four are over. Re-measured at ' +
      '431cc00 (before the 2026-09-01 renderer batch) within +/-0.03pp, so this predates ' +
      'that batch and is not a regression in it.',
    howToConfirm:
      'The diff region is a filled building/vegetation footprint, not a 1-2px outline, ' +
      'and the two captures show recognisably different ART rather than the same art ' +
      'shaded differently. Confirm quantitatively with the `&nomesh` A/B above.',
  },
  {
    id: 'turretMuzzleOriginIsSoft',
    symptom:
      "gun_truck and technical's tracer/muzzle-flash spawn point and initial bearing may " +
      "sit a few pixels off between backends, specifically while the turret sprite is still " +
      "swung away from the hull's own heading (e.g. just after acquiring a target that isn't " +
      "straight ahead). NOT a frozen or non-turning turret -- see 2026-08-28 correction below.",
    mechanism:
      "REVISED 2026-08-28 after cross-backend pixel testing (see " +
      ".superpowers/d-predictions-report.md): the original entry here (id " +
      "'turretBearingIsSoft') claimed Pixi never turns a gun_truck/technical turret sprite at " +
      "all because of an `!type.isSoft` gate. That claim is WRONG -- read against current " +
      "renderer.ts, the turret sprite's spring-physics bearing update (renderer.ts:2112-2140, " +
      "`if (atlas.turretTextures) { ... this.turretFacing[i] += ... }`) has NO isSoft gate " +
      "anywhere in it or its git history; it runs for any unit type with turret art, " +
      "unconditionally. Live-tested: staged a gun_truck against a tracked, undying target in " +
      "both backends from identical sim state, stepped ~180 ticks, and read each backend's own " +
      "internal turretFacing directly -- Pixi converged to 0.250219 turns, three to 0.250197, " +
      "both starting near 0.49 and both visibly swinging the turret sprite in matching " +
      "screenshots (mid-engagement, tracer visible, turret pointed off the hull's spawn " +
      "heading in both). The 'frozen at spawn bearing' observation that motivated the original " +
      "entry is better explained by fog-of-war: renderer.ts:1934's `if (st.side[i] !== 0 && " +
      "!this.isVisible(x, y)) continue` skips a hostile's ENTIRE per-frame draw block " +
      "(including the turret spring) whenever no friendly unit currently sees its tile -- " +
      "reproduced directly: turretFacing froze bit-identically across 8 consecutive step() " +
      "calls the instant the only spotting unit died and fog closed over the gun_truck, with " +
      "no isSoft involvement at all. What IS still real and isSoft-gated: the ONE-SHOT muzzle " +
      "point used to spawn a tracer (renderer.ts:778, `usesTurret = !type.isSoft && ...`) uses " +
      "HULL facing for gun_truck/technical specifically (the two isSoft types with turret art), " +
      "while three's equivalent (ThreeRenderer.ts:1319-1334) is gated on having turret art " +
      "loaded rather than on isSoft -- three's own doc comment there calls this 'a deliberate, " +
      "narrower condition ... strictly more correct, not merely different'. This changes where " +
      "a tracer originates and its initial angle by up to barrelLen (0.4-0.8 world tiles) " +
      "whenever turret and hull facing have not yet converged. Not independently isolated with " +
      "pixels -- in testing, gun_truck's hull auto-faced its target the instant one was " +
      "acquired (a sim-level behaviour, not a renderer one), so hull and turret facing " +
      "converged to the same value before a shot was fired, leaving no visible gap to capture. " +
      "The divergence window is real but narrow: only the interval after a NEW, off-hull-axis " +
      "target is acquired and before the turret's damped spring (renderer.ts:2125-2138) has " +
      "caught up.",
    source:
      'Originally docs/superpowers/specs/2026-08-27-phase-b3-outcome.md, defect #4; corrected ' +
      'by .superpowers/d-predictions-report.md (2026-08-28) against current renderer.ts and ' +
      'ThreeRenderer.ts, with live cross-backend turretFacing readings and matching screenshots.',
    howToConfirm:
      'Roster includes gun_truck or technical, a shot fires in the first ~1s after the unit ' +
      'acquires a target whose bearing differs from the hull\'s current heading, and the diff ' +
      'region is the tracer\'s start point/angle specifically -- NOT the turret sprite itself, ' +
      'which matches across backends once both settle (confirmed: within ~0.0001 turns).',
  },
  {
    id: 'turretFireClip',
    symptom:
      "GUNTRUCK_TURR's recoiled-barrel firing frames render under three during a shot and " +
      "never render under Pixi -- Pixi's turret looks static through its own weapon's " +
      "firing flash.",
    mechanism:
      "Pixi gates turret clip selection on the HULL's firingTimer, and no hull sheet " +
      "carrying turret art declares a fire clip of its own -- so the turret fire clip has " +
      "never rendered in Pixi, on any unit, ever. Three added an independent " +
      "turretFiringTimer and renders it. Intentional divergence, not a port gap.",
    source: 'docs/superpowers/specs/2026-08-27-phase-b3-outcome.md, defect #5 ("The turret fire clip has never rendered, in either backend").',
    howToConfirm: 'Unit is gun_truck (the only shipped turret-art type with a fire clip) and is actively firing in the captured window.',
  },
  {
    id: 'unitWreckMissingInThree',
    symptom:
      'A killed vehicle or infantry unit (any type WITHOUT mesh art, i.e. everything except ' +
      'inf_squad under &mesh) simply vanishes in three once its short death-fade finishes -- ' +
      'no wreck sprite is left on the ground. The identical kill in Pixi leaves a permanent, ' +
      'dark wreck/debris sprite at the death location that persists for the rest of the mission.',
    mechanism:
      "Confirmed 2026-08-28 (.superpowers/d-predictions-report.md), a NEW finding this " +
      "harness's own \"unit death / wreck close-up\" check turned up -- not previously in this " +
      "catalogue. `ThreeRenderer.stepDeaths` (ThreeRenderer.ts:2273-2323) is explicit in its " +
      "own doc comment that it ports Pixi's stepDeaths (renderer.ts:1230-1275) 'minus the " +
      "permanent-wreckage half': Pixi's addWreck/wreckLayer/MAX_WRECKS system (and the " +
      "isExplored fog-gate bound up with it) has no three-side counterpart for ordinary " +
      "billboard/instanced units. The comment names this outright: 'Wreckage-plus-its-fog-gate " +
      "remains a real, tracked gap; it belongs with whichever future task adds permanent " +
      "wreckage, not this one.' Structures DO get a three-side wreck (structureWreck, " +
      "ThreeRenderer.ts:1850-1860) and mesh units get their own separate wreck path when their " +
      "GLB carries a wreck clip (ThreeRenderer.ts:561-563) -- this gap is specifically ordinary " +
      "(non-mesh) UNIT wrecks, ordinary because that is every currently-shipped unit type " +
      "except inf_squad-under-&mesh. Live-tested: killed the same mbt_lavi (applyDamage, " +
      "identical dmg/by args) in both backends from identical synced sim state, stepped 15 " +
      "frame() calls (~0.75s, past DEATH_SECONDS=0.4), screenshotted the same world point in " +
      "both -- Pixi shows a dark, angular wreck (turret/hull debris pieces) at the death tile; " +
      "three shows bare, empty ground at the same tile. No wreck, no decal, nothing.",
    source: '.superpowers/d-predictions-report.md (2026-08-28), cross-referenced against ' +
      'ThreeRenderer.ts:2273-2323\'s own doc comment.',
    howToConfirm:
      'A non-mesh unit (the common case -- almost the whole roster) died more than ' +
      '~DEATH_SECONDS ago in the captured window. Diff region is a solid-interior blob (the ' +
      'wreck footprint), present in the Pixi capture and absent -- bare terrain -- in the ' +
      'three capture. Does not apply to structures (which do get a three-side wreck) or to a ' +
      'mesh unit under &mesh with its own wreck clip.',
  },
  {
    id: 'groupBadgeNumeralBand',
    symptom:
      'A control-group badge numeral may sit above or below an FX sprite (tracer, muzzle ' +
      'flash) at the same screen location differently between backends, when a grouped ' +
      'unit is also mid-firing.',
    mechanism:
      "In Pixi the badge is split across two containers: the ring draws into unitsG like " +
      "any overlay, but the numeral is a Text in spriteLayer carrying zIndex = " +
      "MAX_SAFE_INTEGER -- above every sprite in that layer but BELOW fxAboveG/unitsG/fogG. " +
      "Three's render-order.ts gives the numeral its own band (1.5, between turret and FX) " +
      "per CLAUDE.md's table. The two schemes were not proven to agree at the one point " +
      "they could visibly disagree: a numeral over FX.",
    source: 'docs/superpowers/specs/2026-08-27-phase-b4-outcome.md, "a control-group badge is split across two containers in Pixi".',
    howToConfirm:
      'A unit carrying a control-group assignment (1-9) is firing or has FX playing over ' +
      'it in the same frame the diff was captured.',
  },
  {
    id: 'vfxThreeOnly',
    symptom:
      'Any VFX present in a three capture with no counterpart at all in the matching Pixi ' +
      'capture -- not a colour/edge/timing difference on a shared effect, an effect that ' +
      'simply never plays in Pixi. First concrete instance: a moving vehicle trails a warm, ' +
      'ground-hugging dust cloud behind its hull in three (`vehicle_dust`, trigger ' +
      '`vehicle_move`) and a stationary one vents a thin grey exhaust plume ' +
      '(`vehicle_exhaust`, trigger `ambient_idle`) -- neither exists in Pixi at all, for any ' +
      'vehicle, ever.',
    mechanism:
      "Deliberate, and -- per the project lead's 2026-08-30 direction, recorded in CLAUDE.md's " +
      "'VFX are exempt from this diff as of 2026-08-30' -- no longer scoped to one effect at a " +
      "time. Cross-backend VFX parity is not a goal any more; an effect that lives only in " +
      "three is the intended end state, not a divergence pending reconciliation. Concretely for " +
      "the dust/exhaust pair: both are dispatched from `ThreeRenderer.updateVehicleAmbientFx` " +
      "(`three/units/vehicle-fx.ts` holds the pure hysteresis/geometry math), a method with no " +
      "call anywhere in `renderer.ts`, which stays frozen and byte-identical to `main` -- " +
      "Pixi's `EmitterLibrary` loads both emitter JSON (same shared `vfxEmitters` list both " +
      "backends consume) but never looks either id up via `byName`, so they are inert there by " +
      "construction, not by omission. This entry is written to generalise rather than to name " +
      "one effect, on purpose: the alternative -- adding a fresh catalogue entry every time a " +
      "future VFX task ships something three-only -- is exactly the 'accumulating per-effect " +
      "exceptions' shape the 2026-08-30 direction called out as worth avoiding by naming the " +
      "category once instead.",
    source:
      "CLAUDE.md, 'A golden-image diff between the two backends exists', the 2026-08-30 " +
      "addendum; coordinator direction on this task ('all VFX should move to three... an " +
      "effect that exists only in three is the intended end state'); " +
      '`packages/render/src/three/units/vehicle-fx.ts` and its own top comment.',
    howToConfirm:
      'The diff region is a particle-shaped blob (soft-edged, additive or translucent, ' +
      'not a hard silhouette) with NOTHING at the corresponding pixels in the Pixi capture -- ' +
      'not merely a different colour or a different fade curve on something Pixi also drew. ' +
      'For the dust/exhaust pair specifically: a moving or freshly-idled vehicle is in frame in ' +
      'the three capture.',
  },
  {
    id: 'roadRutDeadCode',
    symptom: 'NOT expected to differ -- listed to rule it out.',
    mechanism:
      "renderer.ts's rut-variation branch ((cx+cyG)%2===0 ? 5 : 7) is dead code -- every " +
      "term is even over all 16,000 checked (x,y,elevation) combinations, so rut is " +
      "always 5. Three ported this FAITHFULLY (same always-5 result), so this is NOT a " +
      "source of diff despite being a known Pixi defect.",
    source: 'docs/superpowers/specs/2026-08-27-phase-b3-outcome.md, defect #1.',
    howToConfirm: 'N/A -- included so a road-tile diff is not misattributed to this.',
  },
] as const;

export function formatExpectedDifferences(): string {
  return EXPECTED_DIFFERENCES.map(
    (d, i) =>
      `${i + 1}. **${d.id}** -- ${d.symptom}\n   Mechanism: ${d.mechanism}\n   Source: ${d.source}\n   Confirm: ${d.howToConfirm}`
  ).join('\n\n');
}
