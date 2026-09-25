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
    { name: 'pixi.js', version: '8.19', licence: 'MIT', url: 'https://pixijs.com' },
  ],
  fonts: [
    { family: 'Big Shoulders Display', licenceFile: 'OFL-BigShouldersDisplay.txt', holder: 'The Big Shoulders Project Authors' },
    { family: 'Barlow', licenceFile: 'OFL-Barlow.txt', holder: 'The Barlow Project Authors' },
    { family: 'IBM Plex Mono', licenceFile: 'OFL-IBMPlexMono.txt', holder: 'IBM Corp.' },
  ],
  assets: [
    // Verbatim from art/src/ifv_dmm08_LICENSE.html, the licensor's own page.
    {
      title: 'VEHICLE IFV DMM08',
      author: 'Mutte',
      licence: 'CC BY 3.0',
      licenceUrl: 'https://creativecommons.org/licenses/by/3.0/',
      source: 'BlendSwap #75225',
      sourceUrl: 'http://www.blendswap.com/blends/view/75225',
      useKey: 'credits.asset.namer.use',
    },
  ],
  codeLicence: 'PolyForm Noncommercial 1.0.0',
  artLicence: 'all rights reserved',
  aiDisclosure:
    'Some models were generated with Meshy and reworked in Blender. Every asset, generated or drawn, passes the same four art gates before it ships; the full provenance record is docs/ASSET_PROVENANCE.md in the repository.',
} as const satisfies {
  people: readonly string[]; libraries: readonly LibraryCredit[]; fonts: readonly FontCredit[]; assets: readonly AssetCredit[];
  codeLicence: string; artLicence: string; aiDisclosure: string;
};
