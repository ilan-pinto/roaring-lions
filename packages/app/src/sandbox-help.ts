/**
 * What the sandbox knows about itself.
 *
 * The three opt-in flags were reachable only by reading CLAUDE.md, and a
 * misspelled one (`&tunel`) did nothing at all — silently, which reads as a
 * broken feature rather than a typo. A dev instrument whose options live only
 * in a markdown file gets used at a fraction of its value.
 *
 * One table, four callers: `readFlags` parses from it, `sandboxHelp` prints
 * from it, `unknownParams` checks against it, and `routes.sandbox`
 * (`shell/links.ts`) builds the picker's launch URL from it. A flag documented
 * but not parsed, or parsed but not offered, is not expressible — which is the same
 * one-rule-several-callers shape `zoneContains`, `roleBucket` and `cursorKey`
 * already use.
 *
 * Pure: a URLSearchParams and some ids in, strings out. No DOM, no console.
 */

export type SandboxFlagName = 'roe' | 'tunnel' | 'sur' | 'civ' | 'ditch' | 'decals' | 'rubble' | 'ragdoll' | 'kit' | 'works' | 'soft';

export interface UrlParam {
  name: string;
  blurb: string;
}

export interface SandboxFlag {
  name: SandboxFlagName;
  /** Console text for a developer: the boot banner and `__lions.help()`. */
  blurb: string;
  /** The PLAYER-facing label, as a catalogue key (`i18n/en.json`): what the
   *  Free Play picker prints beside the checkbox. Kept in this table so it
   *  stays the one place a flag is described -- a flag added here without a
   *  label is a missing key in the picker's spec, not a dev blurb on screen. */
  labelKey: string;
  /** GH-1381: an extra that adds KDF content to the PLAYER's force or kit (sappers, engineers, the kit ladder) or
   *  Sarim units to the OPPOSITION (`&sur`). Meaningful only when the player commands the KDF, so a Sarim
   *  Free play drops it (`sideFlags`) and the picker greys it out. */
  kdfOnly?: true;
  /** On in every Free play without being asked (the lead's ask of 18 Nov 2026: field works in free play), on the
   *  sides it is legal for: a `kdfOnly` one on the KDF side alone. The picker offers no box for it and states it
   *  under the side pick instead, in its `labelKey` sentence; the URL token stays a known, accepted alias that
   *  changes nothing on the KDF side, so an old link is not reported as a typo. Applied by `freePlayDefaults`,
   *  which `bootFlags` calls for a Free play boot only: a mission and a room never take it.
   *
   *  `&<name>=0` (or `=off`, `=false`: `FLAG_OFF_VALUES`, `envlight`'s grammar) turns it OFF for that boot -- the
   *  lead's ruling of 18 Nov 2026, so the visual captures keep today's frame (`tools/src/golden-diff/
   *  capture-protocol.ts` passes it). Only a default flag reads a value: every other flag stays presence-only. */
  freePlayDefault?: true;
}

/** The opt-in sandbox extras. Each adds only what it names, so a check for
 *  one subsystem is not buried under three others. */
export const SANDBOX_FLAGS: readonly SandboxFlag[] = [
  { name: 'roe', blurb: 'flagged no-fire ground (the map’s own, or a synthesised 4×4)', labelKey: 'freePlay.option.roe' },
  {
    name: 'tunnel',
    blurb: 'a pre-dug route + two Yahalom sapper squads to collapse it',
    labelKey: 'freePlay.option.tunnel',
    kdfOnly: true,
  },
  { name: 'sur', blurb: 'the four Sarim units no mission fields', labelKey: 'freePlay.option.sur', kdfOnly: true },
  {
    name: 'civ',
    blurb: 'a mixed crowd of eight civilians, and a refuge to shepherd them to',
    labelKey: 'freePlay.option.civ',
  },
  {
    name: 'ditch',
    blurb: 'an anti-tank ditch cut across the axis between the two forces',
    labelKey: 'freePlay.option.ditch',
  },
  {
    name: 'decals',
    blurb:
      'a fixed showcase of every ground mark -- craters, scorch, oil, rubble, tread and tyre -- near the friendly anchor',
    labelKey: 'freePlay.option.decals',
  },
  {
    // GH-1197 P5: the gated `rubble` scenario's witness. Sandbox only (`main.ts`): a flag must never change a mission.
    name: 'rubble',
    blurb: 'two settled building collapses -- rubble and chunks at rest -- beside the decal showcase, clear of the force',
    labelKey: 'freePlay.option.rubble',
  },
  {
    // GH-1223 slice 1: the gated `ragdoll` scenario's witness. Sandbox only (`main.ts`): a flag must never change a mission.
    name: 'ragdoll',
    blurb: 'two squads falling as ragdolls beside the decal showcase, clear of the force (raises the ragdoll cap to 16)',
    labelKey: 'freePlay.option.ragdoll',
  },
  {
    name: 'kit',
    blurb:
      'the sandbox force pre-kitted, level 1–3 by type -- the kit sign on the unit icons and the HUD card to walk',
    labelKey: 'freePlay.option.kit',
    kdfOnly: true,
  },
  {
    // On by default in a KDF Free play since the lead's ask of 18 Nov 2026 (`freePlayDefault`): `&works` is an
    // accepted alias for old links and changes nothing there. Still off on the Sarim side, in a mission and in a room.
    name: 'works',
    blurb:
      'Field works: every buildable KDF type on offer twice, logistics to pay for them, and one demolition squad to raise them -- ON in every KDF Free play (&works is an accepted alias; &works=0, =off or =false turns them off for this boot; off on the Sarim side)',
    labelKey: 'freePlay.works.on',
    kdfOnly: true,
    freePlayDefault: true,
  },
  {
    name: 'soft',
    blurb:
      'soft particles on for this boot (GH-1227): smoke fades where it meets the ground; sandbox only, off in every preset; inert on the node backend until its depth copy lands',
    labelKey: 'freePlay.option.soft',
  },
];

/** Everything the app reads off the query string — including the five keys
 *  that are PATHS now and survive only as redirects (`shell/router.ts`'s
 *  `legacyRedirect`): `sandbox`, `sandboxes`, `mission`, `campaign`, `brigade`.
 *  They stay listed because they are still accepted, and because
 *  `unknownParams` must not report a bookmark carrying one as a typo. The flags
 *  are spread in rather than repeated, so this cannot list fewer than the table
 *  above. */
export const KNOWN_PARAMS: readonly UrlParam[] = [
  { name: 'sandbox', blurb: '<map id> — walk any shipped map, no mission needed (redirects to /free-play/<map id>)' },
  {
    name: 'sandboxes',
    // The plural is the index: `?sandbox=<id>` is one sandbox, `?sandboxes`
    // is the screen that lists them. Deliberately a separate key rather than
    // a bare `?sandbox`, which has always meant "boot beit_sahwan_outskirts"
    // and still does.
    blurb: 'the sandbox picker — choose a map and its flags instead of typing a URL',
  },
  { name: 'mission', blurb: '<mission id> — run a real mission' },
  { name: 'campaign', blurb: 'open the campaign shell' },
  { name: 'brigade', blurb: 'the brigade — every KDF unit and what opens it' },
  { name: 'fresh', blurb: 'ignore the saved ledger (and switch accounts off)' },
  { name: 'accounts', blurb: 'accepted; accounts are on by default on a real host, and this opts a dev server in' },
  { name: 'google', blurb: 'on /profile, show the Google sign-in buttons while the server has not yet opened Google to players' },
  { name: 'tutorial', blurb: 'replay the tutorial' },
  { name: 'resume', blurb: 'on /mission/<id>, resume the mission saved with Save and quit (the campaign board writes it)' },
  {
    name: 'side',
    // GH-1381. A value param like `tod`, not a SANDBOX_FLAGS boolean: it names one of two sides. Free play only
    // (`sandboxSideOf`): a mission is always the KDF's, and a room's sides come from its config.
    blurb: 'kdf | sarim — the side you command in Free play (GH-1381; default kdf): sarim fields the versus Sarim force against the versus KDF force; a mission or a room ignores it',
  },
  { name: 'net', blurb: 'new | <room code> — N0: run this sandbox in a two-seat lockstep room (both seats order the KDF force)' },
  { name: 'seat', blurb: '0 | 1 — written by the app after ?net=new; informational' },
  { name: 'callsign', blurb: '<name> — the lobby name a room shows for this seat' },
  {
    name: 'renderer',
    // Accepted and does nothing, the way `mesh` is (WP-A3.3). It chose the
    // backend until the Pixi one was deleted; there is one renderer now, and
    // keeping the key known stops every bookmark and old doc link carrying
    // `?renderer=pixi` or `=three` from tripping `unknownParams` as a typo.
    blurb: 'accepted, no effect — three.js is the only renderer since the Pixi backend was retired',
  },
  {
    name: 'mesh',
    // Accepted and does nothing. It was the opt-IN gate until meshes became
    // the default on `three`; keeping it known is what stops every bookmark,
    // doc line and habit that carries it from tripping `unknownParams` and
    // being reported as a typo. It is deliberately NOT in SANDBOX_FLAGS: the
    // banner should list what still changes something, and this no longer
    // does. `&nomesh` is the live flag now.
    blurb: 'accepted, no effect — meshes are the only render path',
  },
  {
    name: 'nomesh',
    // Accepted and does nothing, like `mesh` above (WP-A3.3). It drew the
    // billboards instead of meshes until the billboard path was retired;
    // meshes are the only path now. Known so a bookmark carrying it is not
    // reported as a typo, and NOT in SANDBOX_FLAGS, so the Free play screen
    // stops offering a checkbox that does nothing.
    blurb: 'accepted, no effect — meshes are the only render path since the billboards were retired',
  },
  {
    name: 'nosw',
    // The service worker's escape hatch (level load time step 5). It belongs
    // in KNOWN_PARAMS and NOT in SANDBOX_FLAGS for the same reason `mesh`
    // does not: this is not a sandbox extra, it is a recovery switch that
    // works on any URL the game serves, including a mission and the campaign
    // shell. Listing it here is also the only place a stuck player could
    // find it -- a worker that will not stand down has no UI.
    blurb: 'unregister the service worker and purge its caches — the recovery switch if a cached build goes wrong',
  },
  {
    name: 'lang',
    // Overrides the saved `settings.language` for this load only -- it is
    // never written back to storage, so a bookmark or a shared link cannot
    // silently change what a returning player sees next time. `main.ts`
    // reads it before any screen mounts.
    blurb: '<locale id> — override the saved language for this load, without changing the setting',
  },
  {
    name: 'gpu',
    // GH-943 P0. A value flag like `tod`, sandbox-only like it, and not a SANDBOX_FLAGS boolean, so the Free play picker
    // does not offer it. `gpu-flag.ts` reads it; absent is legacy, to the bit.
    blurb: 'auto | webgpu | webgl2 | legacy — which renderer draws (GH-943; default legacy; node backends draw a bare scene pass until P1; a fallback is logged)',
  },
  {
    name: 'tod',
    // A value flag like `lang`, not a SANDBOX_FLAGS boolean --
    // `dawn | day | dusk | night` are values, not an on/off switch, so
    // `readFlags`'s `.has()` shape does not fit it. `time-of-day.ts`'s
    // `timeOfDayOf` reads it directly off `params`. A mission never reads
    // it (N-23): its own `map.time_of_day` always wins, which is why the
    // blurb says so rather than leaving that to be discovered the hard way.
    blurb: 'dawn | day | dusk | night — the sandbox’s light; a mission uses its own',
  },
  {
    name: 'engines',
    // GH-35. A value flag like `tod`, not a SANDBOX_FLAGS boolean: `a | b`
    // picks which engine-loop candidate EVERY vehicle plays, so the lead can
    // compare the two in the game. A mission never reads it -- it plays each
    // loop's own `pick` in data/audio.json (`engines-flag.ts`).
    blurb: 'a | b — which engine-loop candidate every vehicle plays (GH-35); a mission uses data/audio.json’s picks',
  },
  {
    name: 'envlight',
    // Look uplift L1 (GH-943), ON by default since 2 Nov. Not a SANDBOX_FLAGS entry: it works on a
    // mission too and it is presentation only. `=0` is the A/B switch.
    blurb: '=0 draws the pre-L1 frame: no sky environment, the shipped hemisphere, the 0.45 metal cap (GH-943; on by default)',
  },
  {
    name: 'duskread',
    // GH-1403, held for the lead: OFF by default (`dusk-read-flag.ts`). Not a SANDBOX_FLAGS entry: like `envlight` it
    // works on a mission too (a dusk mission is where it matters) and it is presentation only.
    blurb: '=1 lifts every infantry figure at dusk so posture and uniform read (GH-1403; off by default); no effect on a day or dawn map',
  },
  {
    name: 'grade',
    // Look uplift L2 (GH-943), ON by default since 2 Nov 2026; `=0` is the A/B switch. A value flag like `tod`, not a
    // SANDBOX_FLAGS boolean, and a SANDBOX flag like it: a mission never reads it (N-23). `time-of-day.ts`'s `gradeOf`
    // reads it. Day is the identity grade and has no file, so `auto` on a day map is today's frame.
    blurb: '<id>[:<strength 0-2>] | auto | 0 — the sandbox’s colour grade (GH-943; on by default): dawn, dusk, or auto for the time of day, =0 ungraded; a mission uses its own',
  },
  {
    name: 'fitbuildings',
    // Lead ruling 7 Oct. Not a SANDBOX_FLAGS entry: it works on a mission
    // too, and it is a value flag like `tod`. `building-fit-flag.ts` reads it.
    blurb: 'off | stretch | clamped | uniform — how buildings fit their footprints (default stretch; =off is the shipped size)',
  },
  {
    name: 'pseudo',
    // Wraps the `en` catalogue in the pseudo-locale transform (i18n/pseudo.ts)
    // instead of loading a real one -- the fake-translation pass a screen
    // walk uses to catch a string that never went through `t()` at all.
    blurb: 'run every screen through the pseudo-locale (accents, padding, brackets) instead of a real language; =rtl also mirrors the layout (dir=rtl) and forces the text right to left',
  },
  {
    name: 'voicetick',
    // WP-AU1 R-10. Not a SANDBOX_FLAGS entry: it is not a Free play extra,
    // it works on a mission too, and it changes nothing in the battle --
    // only what an unrecorded line sounds like, and only in a dev build.
    blurb: 'dev builds only: a synth tick per voice line class where no line is recorded yet -- never shipped as a voice',
  },
  {
    name: 'testcoins',
    // GH-317: the TEST wallet this seeded is gone (every player has a free,
    // earned wallet now). Still listed so an old link does not trip
    // `unknownParams` as a typo. Not a SANDBOX_FLAGS entry.
    blurb: 'accepted, no effect — Roar coins are earned in the campaign now; the test wallet was removed',
  },
  ...SANDBOX_FLAGS,
];

/** Which extras are on. Built by iterating SANDBOX_FLAGS, which is what ties
 *  the parser to the table the banner prints — the two cannot drift.
 *
 *  A bare `&tunnel` and an explicit `&tunnel=1` both mean on: the URL bar is
 *  typed by hand, and `has` is the only test that matches how it is typed. */
export function readFlags(params: URLSearchParams): Record<SandboxFlagName, boolean> {
  const out = {} as Record<SandboxFlagName, boolean>;
  for (const f of SANDBOX_FLAGS) out[f.name] = params.has(f.name) && !optedOut(params, f);
  return out;
}

/** The values that turn a `freePlayDefault` flag OFF (`&works=0`): `envlight`'s own grammar. */
export const FLAG_OFF_VALUES: readonly string[] = ['0', 'off', 'false'];

/** Whether the URL opts this boot out of a Free play default. A flag with no default never reads a value:
 *  `&sur=0` is still ON, as it always was (see `sandboxUrl`). */
function optedOut(params: URLSearchParams, f: SandboxFlag): boolean {
  if (f.freePlayDefault !== true) return false;
  const raw = params.get(f.name);
  return raw !== null && FLAG_OFF_VALUES.includes(raw);
}

/** GH-1381: the side the player commands in Free play. */
export type SandboxSide = 'kdf' | 'sarim';

/** The picker's two sides, in the order it draws them. KDF first: it is the default, and every link
 *  that names no side is the KDF's. The label is `versus.faction` (the side's name), so the side is
 *  called what the versus lobby calls it. */
export const SANDBOX_SIDES: readonly SandboxSide[] = ['kdf', 'sarim'];

/**
 * Which side a boot commands (GH-1381), from `&side=`. Absent or `kdf` is the KDF, which is every
 * link that existed before: the default draws today's battle to the byte. Free play only -- a
 * mission is the KDF's, and a room's sides come from the config both machines share (a side one
 * player typed would put the two on different worlds) -- so anywhere else the value is ignored and
 * said so, as an unknown one is.
 */
export function sandboxSideOf(params: URLSearchParams, freePlay: boolean): { value: SandboxSide; warning?: string } {
  const raw = params.get('side');
  if (raw === null) return { value: 'kdf' };
  if (!freePlay) return { value: 'kdf', warning: `&side=${raw} is ignored: only Free play picks a side` };
  if (raw === 'kdf' || raw === 'sarim') return { value: raw };
  return { value: 'kdf', warning: `&side=${raw} is not a side (kdf | sarim); playing the KDF` };
}

/** The extras a side can take (GH-1381): every flag for the KDF, and none marked `kdfOnly` for
 *  Sarim. A dropped flag the URL asked for is named, as `roomFlags` names one a room drops. */
export function sideFlags<K extends SandboxFlagName>(
  flags: Readonly<Record<K, boolean>>,
  side: SandboxSide,
  warn: (flag: K) => void,
): Record<K, boolean> {
  const out = { ...flags } as Record<K, boolean>;
  if (side === 'kdf') return out;
  for (const f of SANDBOX_FLAGS) {
    if (f.kdfOnly !== true || !Object.hasOwn(out, f.name)) continue;
    const k = f.name as K;
    if (out[k]) warn(k);
    out[k] = false;
  }
  return out;
}

/** The extras a Free play takes without being asked (`freePlayDefault`): each such flag on, on the sides it is
 *  legal for (a `kdfOnly` one on the KDF alone), unless the URL opts out (`&works=0`, `FLAG_OFF_VALUES`). Silent:
 *  nothing the URL asked for is dropped. The caller decides that this boot IS a Free play (`bootFlags`); a mission
 *  or a room never calls it. */
export function freePlayDefaults<K extends SandboxFlagName>(
  flags: Readonly<Record<K, boolean>>,
  side: SandboxSide,
  params: URLSearchParams,
): Record<K, boolean> {
  const out = { ...flags } as Record<K, boolean>;
  for (const f of SANDBOX_FLAGS) {
    if (f.freePlayDefault !== true || !Object.hasOwn(out, f.name)) continue;
    if (f.kdfOnly === true && side !== 'kdf') continue;
    if (optedOut(params, f)) continue;
    out[f.name as K] = true;
  }
  return out;
}

/** The LEGACY launch URL for one sandbox pick: a map, plus whichever extras
 *  are on.
 *
 *  **No production caller** since Task 1 -- the picker builds `routes.sandbox`
 *  (`shell/links.ts`), a real path, `/free-play/<map>?tunnel&sur`. Minor 2 in
 *  the final review asked for this to be kept or dropped DELIBERATELY rather
 *  than left ambiguous, and it is kept, for a reason the tests make load-
 *  bearing: `?sandbox=` is still a URL the app accepts (`legacyRedirect`,
 *  `shell/router.ts`, turns one into that path on boot and on click), it is
 *  the spelling CLAUDE.md documents and a dev types by hand, and
 *  `sandbox-help.test.ts` uses it as the generator that feeds `unknownParams`
 *  -- i.e. as the executable statement of what a legacy sandbox URL looks
 *  like. `shell/links.test.ts` pins `routes.sandbox` against it by name, so
 *  the new path spelling and the old query spelling cannot drift apart in
 *  which flags they emit or in what order.
 *
 *  The inverse of `readFlags` for every flag but a `freePlayDefault` one, and
 *  built by iterating the same table, so it cannot spell a flag in a form the
 *  parser does not accept. It cannot spell field works OFF: an absent `works`
 *  is ON in a KDF Free play (`freePlayDefaults`), and only `&works=0` turns it
 *  off, which this never writes. It has no production caller. Flags are appended
 *  BARE (`&sur`, not `&sur=1`) because that is how they are typed by hand and
 *  what `sandboxHelp` prints — one spelling everywhere, and `unknownParams`
 *  stays silent on anything this produces.
 *
 *  A flag whose value is false is absent rather than `&sur=0`: `readFlags`
 *  tests `has`, so `&sur=0` would read as ON. */
export function sandboxUrl(
  mapId: string,
  on: Partial<Record<SandboxFlagName, boolean>> = {}
): string {
  const extras = SANDBOX_FLAGS.filter((f) => on[f.name] === true)
    .map((f) => `&${f.name}`)
    .join('');
  return `?sandbox=${encodeURIComponent(mapId)}${extras}`;
}

/** Parameters present in the URL that nothing reads.
 *
 *  This is the one that catches `&tunel`. A typo'd flag is otherwise
 *  indistinguishable from a feature that does not work. */
export function unknownParams(params: URLSearchParams): string[] {
  const known = new Set(KNOWN_PARAMS.map((p) => p.name));
  return [...new Set(params.keys())].filter((k) => !known.has(k));
}

export interface HelpContext {
  mapId: string;
  mapIds: readonly string[];
  on: readonly string[];
  /** GH-1381: the side this boot commands; absent reads as the KDF. */
  side?: SandboxSide;
}

/** The boot banner, and the body of `__lions.help()`.
 *
 *  Returned as a string rather than logged here so it can be asserted in a
 *  node-environment test — the point of the banner is its content, and a
 *  spy on console.info would prove only that something was printed. */
export function sandboxHelp(ctx: HelpContext): string {
  const width = Math.max(...SANDBOX_FLAGS.map((f) => f.name.length));
  const flags = SANDBOX_FLAGS.map(
    (f) => `    &${f.name.padEnd(width)}  ${f.blurb}`
  ).join('\n');
  // `tod` is a value flag, not a SANDBOX_FLAGS boolean (see its own entry's
  // comment) -- printed as its own line rather than folded into the table
  // above, which the four callers all read as "on or off".
  const tod = KNOWN_PARAMS.find((p) => p.name === 'tod');
  // `engines` likewise (GH-35): a value, printed on its own line.
  const engines = KNOWN_PARAMS.find((p) => p.name === 'engines');
  // `side` likewise (GH-1381): a value, on its own line, and the side this boot commands under the map.
  const side = KNOWN_PARAMS.find((p) => p.name === 'side');
  return [
    `sandbox: ${ctx.mapId}`,
    `  side: ${ctx.side ?? 'kdf'}`,
    `  flags on: ${ctx.on.length > 0 ? ctx.on.join(', ') : '(none)'}`,
    `  available:`,
    flags,
    ...(tod ? [`    &tod=<value>${' '.repeat(Math.max(0, width - 3))}  ${tod.blurb}`] : []),
    ...(engines ? [`    &engines=<a|b>${' '.repeat(Math.max(0, width - 5))}  ${engines.blurb}`] : []),
    ...(side ? [`    &side=<kdf|sarim>${' '.repeat(Math.max(0, width - 8))}  ${side.blurb}`] : []),
    `  maps: ${ctx.mapIds.join(', ')}`,
    `  console: __lions.help() · step(n) · goto(marker) · units() · sel([id]) · cursorKey() · voiceLog() · engines() · contentDigest()`,
  ].join('\n');
}
