/**
 * What the sandbox knows about itself.
 *
 * The three opt-in flags were reachable only by reading CLAUDE.md, and a
 * misspelled one (`&tunel`) did nothing at all — silently, which reads as a
 * broken feature rather than a typo. A dev instrument whose options live only
 * in a markdown file gets used at a fraction of its value.
 *
 * One table, three callers: `readFlags` parses from it, `sandboxHelp` prints
 * from it, and `unknownParams` checks against it. A flag documented but not
 * parsed, or parsed but not documented, is not expressible — which is the
 * same one-rule-several-callers shape `zoneContains`, `roleBucket` and
 * `cursorKey` already use.
 *
 * Pure: a URLSearchParams and some ids in, strings out. No DOM, no console.
 */

export type SandboxFlagName = 'roe' | 'tunnel' | 'sur' | 'mesh';

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
  { name: 'mesh', blurb: 'inf_squad as a rigged 3D mesh — needs ?renderer=three' },
];

/** Everything main.ts reads off the query string. The flags are spread in
 *  rather than repeated, so this cannot list fewer than the table above. */
export const KNOWN_PARAMS: readonly UrlParam[] = [
  { name: 'sandbox', blurb: '<map id> — walk any shipped map, no mission needed' },
  { name: 'mission', blurb: '<mission id> — run a real mission' },
  { name: 'campaign', blurb: 'open the campaign shell' },
  { name: 'fresh', blurb: 'ignore the saved ledger' },
  { name: 'tutorial', blurb: 'replay the tutorial' },
  {
    name: 'renderer',
    // `three` now draws terrain — ground, elevation, decor, grain — as real
    // geometry (Phase B2); units, fog and VFX are still B3/B4. Said here
    // because the previous wording ("clear colour only, Phase B1") went
    // stale the moment terrain landed and would otherwise read as a finished
    // second backend one phase too early, or an unfinished one one phase too
    // late.
    blurb: 'pixi (default) | three — which backend draws (three: terrain only, Phase B2; no units/fog yet)',
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
