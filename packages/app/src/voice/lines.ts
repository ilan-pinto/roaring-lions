/**
 * The voice vocabulary (WP-AU1 §3, §4, §6): which pool a unit answers from,
 * which language its faction speaks, and the ONE key grammar the director
 * asks for and data/audio.json declares. Pure: no DOM, no audio, no sim.
 */
export type VoiceClass = 'infantry' | 'crew' | 'engineer' | 'air';
export const VOICE_CLASSES: readonly VoiceClass[] = ['infantry', 'crew', 'engineer', 'air'];

/** What a gesture can mean to the voice: the cursor's ranked verbs, plus the
 *  two `winningVerb` has no rung for (`move`, and the keyboard's `halt`). */
export type OrderVerb = 'move' | 'attack' | 'demolish' | 'charge' | 'garrison' | 'mount' | 'dismount' | 'smoke' | 'halt';
export const ORDER_VERBS: readonly OrderVerb[] = [
  'move', 'attack', 'demolish', 'charge', 'garrison', 'mount', 'dismount', 'smoke', 'halt',
];

/** The six verbs every class answers with one shared line (spec §4). */
export const COMMON_VERBS = ['garrison', 'smoke', 'mount', 'dismount', 'halt', 'charge'] as const;
export type CommonVerb = (typeof COMMON_VERBS)[number];

/** Calls, not verbs (GH-262): reactions the director volunteers on its own
 *  reading of the world, never a rung `winningVerb` ranks for a gesture. */
export const COMMON_CALLS = ['pinned', 'broken', 'immobilised', 'gunout'] as const;
export type CommonCall = (typeof COMMON_CALLS)[number];
export type LineTrigger = 'move' | 'attack' | 'death' | 'task' | 'ack' | 'announce' | CommonVerb | CommonCall;

/** `<lang>.common.<call>` (pass C2/C4, A1): a unit of ours reporting its own
 *  state on the radio -- broken, immobilised, its gun knocked out. */
export const callLineKey = (lang: string, call: CommonCall): string => `${lang}.common.${call}`;

/** `<lang>.common.pinned` (GH-262 §2.4): the one key the pinned branch asks
 *  data/audio.json for, in every language. */
export const pinnedLineKey = (lang: string): string => `${lang}.common.pinned`;

/** Spec §3's defaults, plus `eod` (R-15), which the table did not name. */
const ROLE_VOICE: Readonly<Record<string, VoiceClass>> = {
  infantry: 'infantry', at_team: 'infantry', sniper: 'infantry', support: 'infantry', artillery: 'infantry',
  mbt: 'crew', ifv: 'crew', apc: 'crew', technical: 'crew', recon: 'crew', aa: 'crew',
  engineer: 'engineer', eod: 'engineer',
  drone: 'air', gunship: 'air',
};

const isVoiceClass = (v: unknown): v is VoiceClass =>
  typeof v === 'string' && (VOICE_CLASSES as readonly string[]).includes(v);

/** The unit's own `voice` field when it names a class, else its role's. A role
 *  with no class is a data error and throws, naming the unit: a silent default
 *  would voice a new role as whatever came first. */
export function voiceClassOf(u: { readonly id: string; readonly role: string; readonly voice?: unknown }): VoiceClass {
  if (isVoiceClass(u.voice)) return u.voice;
  const c = ROLE_VOICE[u.role];
  if (c === undefined) throw new Error(`voice: unit "${u.id}" has role "${u.role}", which no voice class covers`);
  return c;
}

/** Null for a faction the manifest does not map: civilians (D10). */
export function languageOf(faction: string, languages: Readonly<Record<string, string>>): string | null {
  const l: unknown = Object.prototype.hasOwnProperty.call(languages, faction) ? languages[faction] : undefined;
  return typeof l === 'string' && l.length > 0 ? l : null;
}

export function orderLineKey(lang: string, speaker: VoiceClass, verb: OrderVerb): string {
  switch (verb) {
    case 'move':
      return `${lang}.${speaker}.move`;
    case 'attack':
      // Engineers answer `attack` from the infantry pool (spec §4).
      return `${lang}.${speaker === 'engineer' ? 'infantry' : speaker}.attack`;
    case 'demolish':
      return `${lang}.engineer.task`;
    default:
      return `${lang}.common.${verb}`;
  }
}

/** `<lang>.common.announce_<event>` (GH-110): the line an announcement's
 *  `audio` names once it is recorded. Not one of `allLineKeys`: the director
 *  never asks for it, the announcement table does. */
export const announceLineKey = (lang: string, event: string): string => `${lang}.common.announce_${event}`;

export const deathLineKey = (lang: string, cls: VoiceClass): string => `${lang}.${cls}.death`;
export const ackLineKey = (lang: string): string => `${lang}.common.ack`;

export function lineTriggerOf(verb: OrderVerb): LineTrigger {
  if (verb === 'demolish') return 'task';
  return verb;
}

/** Every key the director can ever ask for, in these languages. Task 3's
 *  test holds data/audio.json to exactly this set. */
export function allLineKeys(langs: Iterable<string>): string[] {
  const out: string[] = [];
  for (const lang of [...new Set(langs)].sort()) {
    for (const c of VOICE_CLASSES) {
      out.push(`${lang}.${c}.move`);
      if (c !== 'engineer') out.push(`${lang}.${c}.attack`);
      out.push(`${lang}.${c}.death`);
    }
    out.push(`${lang}.engineer.task`);
    for (const v of COMMON_VERBS) out.push(`${lang}.common.${v}`);
    out.push(`${lang}.common.ack`);
    for (const c of COMMON_CALLS) out.push(callLineKey(lang, c));
  }
  return out;
}

/** The languages a roster can speak (N16): only these are decoded. */
export function rosterLanguages(
  roster: Iterable<string>,
  factionOf: (unitId: string) => string | undefined,
  languages: Readonly<Record<string, string>>
): string[] {
  const out = new Set<string>();
  for (const id of roster) {
    const f = factionOf(id);
    const l = f === undefined ? null : languageOf(f, languages);
    if (l !== null) out.add(l);
  }
  return [...out].sort();
}
