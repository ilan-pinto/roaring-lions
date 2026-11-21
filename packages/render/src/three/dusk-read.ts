/**
 * GH-1403, "Make dusk read as well as day": the DUSK FIGURE READ. Pure: numbers and palette keys, no `three`.
 *
 * The audit of 15 Nov 2026 (dimension D7) found that at dusk units read "mostly by their rings": the dusk sun is 1.8 at 18
 * degrees against day's 2.6 at 55 (`time-of-day.ts`), so flat ground and a figure standing on it take about 40% of day's
 * irradiance, and a figure in a building's long dusk shadow takes the fill alone. Through ACES that puts both in the toe,
 * where a figure and the grass behind it are a few levels apart, so the posture a pinned squad huddles in (GDD 5.5: the
 * suppression read IS the posture) and the uniform a side wears stop reading at gameplay zoom.
 *
 * The read is the rain treatment's mechanism, with dusk's own numbers: every infantry FIGURE's albedo is multiplied by
 * `DUSK_READ_EXPOSURE` (capped at 1) and raised to `DUSK_READ_CONTRAST` BEFORE lighting, so the figure is lit as it was,
 * from a brighter body, and keeps its own shading, camouflage and colour (a flat emissive lift drew the rain's "pale
 * ghosts" and was rejected; this is not one). The view-angle rim (`DUSK_READ_RIM_GAIN`) stays in the shader as a knob.
 * `units/rain-rim.ts` holds the GLSL, the shared uniforms (one set per flavour) and the node twin's maths.
 *
 * Every faction's figures take it at dusk (friend, foe and civilian alike), but its EFFECT is not symmetric: it scales
 * the albedo, so it visibly lifts the tan Sarim and militia figures and barely moves the dark KDF camouflage (x2 of a dark
 * texel is still dark). The clean Metal capture (`tools/src/perf/dusk-read-captures.ts`, run 2, 20 Nov 2026: tick 118 on
 * every page, repaint control 0 px) measured the share of figure pixels at dE >= 15.6 against the ground per squad: x2 lifts
 * four of seven squads (the two spotters +9 and +6 points, the militia +8.5, the pinned rifles +1) and loses on three (the
 * rifle squad on lit grass -7, the pinned militia -1, the RPG team -2): a figure darker than the ground moves toward it, the
 * rain read's finding again. The rim at 0.4 adds +3 to +7 points on three KDF squads over x2 alone and -2 on the rifle squad;
 * it is the lead's option, kept at 0 here until he judges it. The numbers below are the lead's to judge. Vehicles do not take it: they
 * are large, they read at dusk, and the Lavi carries its own team mark.
 *
 * The lead's ruling of 20 Nov 2026 chose option B instead, the brighter dusk TEAM ring (`units/hdr-gains.ts`'s
 * `duskTeamRing`), so this read stays switched off and is kept only as an opt-in look.
 *
 * OPT-IN, and the default is OFF: `RendererOptions.duskRead` (the app's `&duskread` switch) and only on a dusk renderer
 * that is not raining (rain has its own read, and rain wins). Off, `surfaceTableFor` returns the shipped tables by
 * identity, so no clone, cache key, program or uniform differs from today's: day, and the gated `graded` frame (which is
 * dusk), do not move. Turning it on by default moves `graded` and is the lead's call (the PR says so).
 *
 * Presentation only. Nothing here is read by the sim; `time_of_day` is read by the app (`timeOfDayOf`), never the sim.
 */

/** The albedo multiplier (capped at 1 per channel). 1 is the identity. */
export const DUSK_READ_EXPOSURE = 2;
/** The gamma after the exposure; 1 is the identity (the rain read uses 1.5 to put back darks its x6 washed out). */
export const DUSK_READ_CONTRAST = 1;
/** The rim's gain: 0, OFF (a knob, like the rain rim's since the lead's ruling of 1 Nov 2026). */
export const DUSK_READ_RIM_GAIN = 0;
/** The rim's power, the rain rim's 3. */
export const DUSK_READ_RIM_POWER = 3;
/** The rim's colour: the dusk sun's own key (`TIME_OF_DAY_PRESETS.dusk.sunKey`), so a rim, when on, reads as that light. */
export const DUSK_READ_RIM_KEY = 'dust.0';
