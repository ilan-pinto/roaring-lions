// GH-1394: the posture ids and the ledger key, apart from the applier (`overlays.ts`) and its catalogue JSON. The
// ledger sanitiser (`@lions/economy` ledger-shape) needs only these two, and it is on the app's entry chunk: importing
// them from `overlays.ts` pulled the whole applier and `postures.json` into the entry's static closure (+2.7 KB over the
// `webgpu:bundle` ceiling). The applier itself is loaded lazily with `packages/app/src/posture.ts`.

/** The three postures (lead ruling D1), in picker order. */
export const POSTURE_IDS = ['easier', 'standard', 'harder'] as const;
export type PostureId = (typeof POSTURE_IDS)[number];

/** The campaign-ledger key the posture lives under (design §6). Read from the ledger ONLY: no URL
 *  flag reaches it, so no dev flag can change how a campaign mission scores. */
export const DIFFICULTY_LEDGER_KEY = 'campaign.difficulty';

/** The posture a campaign ledger names (here, beside the key, so the board, the brigade screen and the resume check can
 *  read it without pulling the applier into their chunk): `easier`, `standard` or `harder`; anything else (absent, an unknown
 *  string, a wrong type: an old save, a hand-edited one) reads as Standard (ruling D2). */
export function postureOf(ledger: Readonly<Record<string, unknown>> | null | undefined): PostureId {
  const v = ledger?.[DIFFICULTY_LEDGER_KEY];
  return typeof v === 'string' && (POSTURE_IDS as readonly string[]).includes(v) ? (v as PostureId) : 'standard';
}
