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
export interface AssetCredit { what: string; author: string; licence: string; source: string }

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
    { what: 'Namer IFV model (sprite sheets NAMER_HULL, NAMER_TURR)', author: 'Mutte', licence: 'CC BY 3.0', source: 'BlendSwap #75225' },
  ],
  codeLicence: 'MIT License',
  artLicence: 'all rights reserved',
  aiDisclosure:
    'Some models were generated with Meshy and reworked in Blender. Every asset, generated or drawn, passes the same four art gates before it ships; the full provenance record is docs/ASSET_PROVENANCE.md in the repository.',
} as const satisfies {
  people: readonly string[]; libraries: readonly LibraryCredit[]; fonts: readonly FontCredit[]; assets: readonly AssetCredit[];
  codeLicence: string; artLicence: string; aiDisclosure: string;
};
