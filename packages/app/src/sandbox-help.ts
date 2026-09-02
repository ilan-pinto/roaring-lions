/**
 * What the sandbox knows about itself.
 *
 * The three opt-in flags were reachable only by reading CLAUDE.md, and a
 * misspelled one (`&tunel`) did nothing at all — silently, which reads as a
 * broken feature rather than a typo. A dev instrument whose options live only
 * in a markdown file gets used at a fraction of its value.
 *
 * One table, four callers: `readFlags` parses from it, `sandboxHelp` prints
 * from it, `unknownParams` checks against it, and `sandboxUrl` builds a launch
 * URL from it for the menu's sandbox picker. A flag documented but not parsed,
 * or parsed but not offered, is not expressible — which is the same
 * one-rule-several-callers shape `zoneContains`, `roleBucket` and `cursorKey`
 * already use.
 *
 * Pure: a URLSearchParams and some ids in, strings out. No DOM, no console.
 */

export type SandboxFlagName = 'roe' | 'tunnel' | 'sur' | 'civ' | 'ditch' | 'nomesh';

export interface UrlParam {
  name: string;
  blurb: string;
}

/** The opt-in sandbox extras. Each adds only what it names, so a check for
 *  one subsystem is not buried under three others. */
export const SANDBOX_FLAGS: readonly { name: SandboxFlagName; blurb: string }[] = [
  { name: 'roe', blurb: 'flagged no-fire ground (the map’s own, or a synthesised 4×4)' },
  { name: 'tunnel', blurb: 'a pre-dug route + two yahalom_squad to collapse it' },
  { name: 'sur', blurb: 'the four Sarim units no mission fields' },
  {
    name: 'civ',
    blurb: 'a mixed crowd of eight civilians, and a refuge to shepherd them to',
  },
  {
    name: 'ditch',
    blurb: 'an anti-tank ditch cut across the axis between the two forces',
  },
  {
    name: 'nomesh',
    blurb:
      'draw billboards instead of meshes — the diagnostic half of what &mesh used to gate',
  },
];

/** Everything main.ts reads off the query string. The flags are spread in
 *  rather than repeated, so this cannot list fewer than the table above. */
export const KNOWN_PARAMS: readonly UrlParam[] = [
  { name: 'sandbox', blurb: '<map id> — walk any shipped map, no mission needed' },
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
  { name: 'fresh', blurb: 'ignore the saved ledger' },
  { name: 'tutorial', blurb: 'replay the tutorial' },
  {
    name: 'renderer',
    // This blurb used to name a phase and a capability list ("terrain only,
    // Phase B2; no units/fog yet"), and went stale the moment the next
    // phase shipped -- twice. SANDBOX_FLAGS/KNOWN_PARAMS being "the single
    // source" only guarantees a flag is parsed and listed; it says nothing
    // about whether prose describing a DIFFERENT package (packages/render's
    // three backend) still matches that package's current state, and
    // nothing under packages/app runs when packages/render changes. So this
    // no longer states a capability list at all -- it points at the file
    // that actually is kept current in the same commit as backend work
    // (CLAUDE.md's "The three.js backend" section), which is the only
    // durable fix short of importing render internals this package is not
    // allowed to import.
    blurb:
      'three (default) | pixi — which backend draws; an explicit choice persists ' +
      'across missions (see CLAUDE.md "The three.js backend" for current parity)',
  },
  {
    name: 'mesh',
    // Accepted and does nothing. It was the opt-IN gate until meshes became
    // the default on `three`; keeping it known is what stops every bookmark,
    // doc line and habit that carries it from tripping `unknownParams` and
    // being reported as a typo. It is deliberately NOT in SANDBOX_FLAGS: the
    // banner should list what still changes something, and this no longer
    // does. `&nomesh` is the live flag now.
    blurb: 'accepted, no effect — meshes are the default; use &nomesh to turn them off',
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
  for (const f of SANDBOX_FLAGS) out[f.name] = params.has(f.name);
  return out;
}

/** The launch URL for one sandbox pick: a map, plus whichever extras are on.
 *
 *  The inverse of `readFlags`, and built by iterating the same table, so the
 *  picker cannot offer a flag the parser does not read or spell one in a form
 *  it does not accept. Flags are appended BARE (`&sur`, not `&sur=1`) because
 *  that is how they are typed by hand and what `sandboxHelp` prints — one
 *  spelling everywhere, and `unknownParams` stays silent on anything this
 *  produces.
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
  return [
    `sandbox: ${ctx.mapId}`,
    `  flags on: ${ctx.on.length > 0 ? ctx.on.join(', ') : '(none)'}`,
    `  available:`,
    flags,
    `  maps: ${ctx.mapIds.join(', ')}`,
    `  console: __lions.help() · step(n) · goto(marker) · units() · sel([id]) · cursorKey()`,
  ].join('\n');
}
