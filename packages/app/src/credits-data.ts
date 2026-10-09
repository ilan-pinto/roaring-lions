// packages/app/src/credits-data.ts
/**
 * What the credits screen says. Pinned by credits-data.test.ts against the
 * package.json files, the fonts directory and LICENSE, so a dependency or a
 * font cannot ship uncredited and the licence line cannot drift from the file.
 * Asset attributions come from docs/ASSET_PROVENANCE.md; the entries here are
 * the ones whose licence REQUIRES a credit. AI-generated assets are disclosed
 * as a class, per CONTRIBUTING.md.
 */
export interface LibraryCredit { name: string; version: string; licence: string; url: string }
export interface FontCredit { family: string; licenceFile: string; holder: string }
/**
 * One third-party work whose licence requires a credit. The fields are exactly
 * what Creative Commons Attribution 3.0 section 4(b) asks a credit to carry:
 * the author, the work's own title as its licensor published it, the URI the
 * licensor associated with it, and -- because every such work here was
 * adapted -- a line identifying how it is used (`useKey`, an en.json key,
 * since that line is prose rather than a name). Section 4(a) adds the licence's
 * own URI, which is `licenceUrl`.
 */
export interface AssetCredit {
  title: string;
  author: string;
  /** Short licence name, e.g. 'CC BY 3.0'. */
  licence: string;
  licenceUrl: string;
  /** Short label for where the work was published, e.g. 'BlendSwap #75225'. */
  source: string;
  /** The licensor's own URI for the work, verbatim from its licence page. */
  sourceUrl: string;
  useKey: string;
}

export const CREDITS = {
  people: ['Ilan Pinto and the Roaring Lions contributors'],
  libraries: [
    { name: 'three', version: '0.170', licence: 'MIT', url: 'https://threejs.org' },
  ],
  fonts: [
    { family: 'Big Shoulders Display', licenceFile: 'OFL-BigShouldersDisplay.txt', holder: 'The Big Shoulders Project Authors' },
    { family: 'Barlow', licenceFile: 'OFL-Barlow.txt', holder: 'The Barlow Project Authors' },
    { family: 'IBM Plex Mono', licenceFile: 'OFL-IBMPlexMono.txt', holder: 'IBM Corp.' },
  ],
  // Empty on purpose. The only entry was the Namer's (Mutte, CC BY 3.0), for
  // sprite sheets that were deleted in A3.3 -- the Namer is a Meshy model now,
  // and nothing shipped derives from the credited work. The lead's ruling
  // (audit L4 / PA-29): remove it. The history stays in the provenance table
  // (docs/ASSET_PROVENANCE.md). A future work whose licence requires a credit
  // goes here and is rendered by ui/credits.ts without any other change.
  assets: [] as readonly AssetCredit[],
  codeLicence: 'PolyForm Noncommercial 1.0.0',
  artLicence: 'all rights reserved',
  // The AI-generated disclosure (CONTRIBUTING.md), one paragraph per key, as
  // en.json keys so it goes through t() like every other chrome string. AU-10
  // added the audio: the generated theme and the mission music cut from it
  // (PR 493), the ElevenLabs placeholder voices and their exclusion from a
  // commercial build (D5, A3), and the synthesised cues and effects. The
  // record behind every line is docs/ASSET_PROVENANCE.md.
  aiDisclosure: ['credits.ai.models', 'credits.ai.audio', 'credits.ai.record'],
} as const satisfies {
  people: readonly string[]; libraries: readonly LibraryCredit[]; fonts: readonly FontCredit[]; assets: readonly AssetCredit[];
  codeLicence: string; artLicence: string; aiDisclosure: readonly string[];
};
