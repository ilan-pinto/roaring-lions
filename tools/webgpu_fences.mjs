// GH-943 WebGPU-primary (P1 T1): the standing import fences, in ONE place, so the ratchet block can ADD to them.
//
// Flat config keeps ONE `no-restricted-imports` option object and ONE `no-restricted-syntax` list per file, and a later block
// REPLACES an earlier one's. The P0 ratchet block therefore stripped a ported file of the roar-wallet fence and of the
// `@lions/app|data` fence (PR 1041 review). eslint.config.mjs imports these constants for the standing blocks and the ratchet
// builds its block from RATCHET_BASE, so the two cannot drift: change a fence here and both move.

/** GH-317 (gate G-V2): the Roar-coin wallet is single-player. */
export const ROAR_FENCE = {
  group: ['**/roar-wallet', '**/roar-wallet.ts', '**/roar-earn', '**/roar-earn.ts', '**/account-view', '**/account-view.ts', '@lions/economy', '@lions/economy/*', '**/economy/src', '**/economy/src/*'],
  message:
    'The Roar-coin wallet (GH-317) is single-player: keep roar-wallet, roar-earn, account-view or @lions/economy out of the sim, ' +
    'the renderer, the net package and packages/app/src/net. A versus room is handed its claim; it never reads the wallet.',
};

/** Dependency direction: app -> render -> sim, data a leaf. */
export const RENDER_DEP_SELECTOR = {
  selector: 'ImportDeclaration[source.value=/^@lions\\u002F(app|data)/]',
  message: '@lions/render may import @lions/sim only (CLAUDE.md dependency direction).',
};

/**
 * Everything a ported file (always under packages/render/src/three/**) already has from the standing blocks: the
 * `no-restricted-syntax` entries of the render dependency block, and the `no-restricted-imports` options of the
 * `packages/render/src/three/**` ROAR block. The ratchet block is these PLUS its own bans.
 */
export const RATCHET_BASE = {
  syntax: [RENDER_DEP_SELECTOR],
  imports: { patterns: [ROAR_FENCE] },
};
