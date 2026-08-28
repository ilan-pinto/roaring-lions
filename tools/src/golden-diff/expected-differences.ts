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
      'A unit type drawn as a rigged 3D mesh under three (with &mesh) has no counterpart ' +
      'shape in Pixi at all -- not a colour or edge difference, an entirely different ' +
      'silhouette.',
    mechanism:
      'Mesh units (packages/render/src/three/units/mesh-*.ts, currently inf_squad under ' +
      '?renderer=three&mesh) have no Pixi rendering path whatsoever. Pixi always draws ' +
      'the billboard sprite for that type.',
    source: 'CLAUDE.md, "Mesh units"; task prompt.',
    howToConfirm:
      'The &mesh flag was on for the three capture. Compare with the flag OFF (the ' +
      'harness default) unless deliberately testing mesh parity, which is not parity at ' +
      'all -- it is an intentionally unported feature.',
  },
  {
    id: 'tracerTtl',
    symptom:
      'Tracer/projectile visual lifetime differs between backends, most visible when a ' +
      'capture batches many sim ticks into one rendered frame (as this harness\'s ' +
      '__lions.step(n) does).',
    mechanism:
      "Pixi's tracer TTL is FRAME-COUNT based (decrements once per renderer.frame() " +
      "call); three's is TIME-based (decrements by real dtMs). The B3 outcome doc notes " +
      "these are 'identical at 60Hz' under normal per-frame play -- but __lions.step(n) " +
      "calls renderer.frame(1, lastFrameMs) exactly ONCE regardless of how many ticks n " +
      "advanced, so a tracer spawned mid-batch can read as fresh in Pixi (one frame-count " +
      "tick) while three has already advanced it by lastFrameMs of elapsed time, or vice " +
      "versa depending on when within the batch it spawned.",
    source: 'docs/superpowers/specs/2026-08-27-phase-b3-outcome.md, defect #3 ("Tracer TTL is frame-count based").',
    howToConfirm:
      'Diff region is a short line/streak (an in-flight tracer) rather than a static ' +
      'sprite or terrain tile, and the capture used step(n) with n > 1.',
  },
  {
    id: 'turretBearingIsSoft',
    symptom:
      "gun_truck and technical's turrets point a different direction between backends; " +
      "dozer_d9 or heli_peten may show a muzzle-flash-style sprite pointed at their " +
      "mission-start bearing in Pixi regardless of where they have since turned.",
    mechanism:
      "Pixi gates turret-bearing updates on `!type.isSoft` (renderer.ts), and isSoft is " +
      "derived from armour. gun_truck and technical are exactly the two types that are " +
      "BOTH soft AND ship real turret art (turretAxisPx) -- so Pixi never updates the one " +
      "sprite state that would show it turning, and it stays frozen at spawn bearing. " +
      "Conversely dozer_d9/heli_peten (non-soft, no turret art) still have Pixi update an " +
      "internal turretFacing nothing draws from -- a cosmetic double bug. Three fixed " +
      "this; the Pixi behaviour was intentionally NOT ported (filed upstream instead).",
    source: 'docs/superpowers/specs/2026-08-27-phase-b3-outcome.md, defect #4 ("Turret bearing is gated on !type.isSoft").',
    howToConfirm:
      'Roster includes gun_truck, technical, dozer_d9 or heli_peten, and combat has run ' +
      'long enough for a turret to have retargeted since spawn.',
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
