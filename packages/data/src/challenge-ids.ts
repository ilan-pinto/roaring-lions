// GH-1395: the challenge index and the ledger key, apart from the challenge catalogue (`challenges.ts`) and its JSON,
// for the reason `posture-ids.ts` is apart from the applier: `@lions/economy` (the coin table, the ledger sanitiser) is
// on the app's entry chunk and needs only these, while the catalogue is loaded lazily with
// packages/app/src/challenge.ts. Importing them from `challenges.ts` put the whole pilot's JSON in the entry's static
// closure, over the `webgpu:bundle` ceiling. `challenges.test.ts` pins this list to `missionChallenges` and the files.

/** The missions with a challenge (the six-mission pilot, ruling D9), sorted. The coin rules pay a challenge only for
 *  a mission in here, whatever a client reports. */
export const challengeMissionIds: readonly string[] = [
  'beit_sahwan_1_recon',
  'beit_sahwan_2_foothold',
  'beit_sahwan_3_clearance',
  'beit_sahwan_4_subterranean',
  'beit_sahwan_breach',
  'umm_zeitoun_2_buildup',
];

export function hasChallenge(missionId: string): boolean {
  return challengeMissionIds.includes(missionId);
}

/** The campaign-ledger key the challenge MARK lives under (§5.2): best-of per mission, this campaign only, so
 *  "New campaign" clears it. The COINS live on the wallet's lifetime record, never here. */
export const CHALLENGE_LEDGER_KEY = 'campaign.challenge_results';
