import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { palettePlugin } from './vite-plugin-palette';
import { cursorsPlugin } from './vite-plugin-cursors';
import { assetWatchPlugin } from './vite-plugin-asset-watch';

// The version shown in the menu and the HUD. Root package.json is the single
// source of truth; only major.minor is displayed, so a patch bump is invisible.
const pkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
) as { version: string };
const [major, minor] = pkg.version.split('.');
const GAME_VERSION = `${major}.${minor}`;

export default defineConfig({
  // The palette reaches CSS as --rl-* custom properties, from the same
  // data/palette.json the renderer and the sprite pipeline read.
  plugins: [
    palettePlugin(new URL('../../data/palette.json', import.meta.url)),
    cursorsPlugin(new URL('../../data/palette.json', import.meta.url)),
    // The GLBs live in `art/`, which is above this package and therefore
    // outside the dev server's watcher — so adding one left the mesh
    // directory listing Vite bakes into `main.ts` stale, and the app booted
    // into a GLTFLoader `<!doctype` error (GH-147). See the plugin's own
    // header; the `touch packages/app/src/main.ts` workaround is retired.
    assetWatchPlugin(),
  ],
  // Build-time constant: no runtime fetch, and it works the same on Pages.
  define: { __GAME_VERSION__: JSON.stringify(GAME_VERSION) },
  // GitHub Pages serves the app from /<repo>/, so asset URLs need that
  // prefix; local dev and the preview harness stay at the root.
  base: process.env.VITE_BASE ?? '/',
  // The preview harness assigns a port via PORT; default to 5173 otherwise.
  server: { port: Number(process.env.PORT) || 5173, strictPort: false },
  // Serve repo-root assets/ statically: assets/audio/x.ogg → /audio/x.ogg.
  // Keeps one source of truth for assets (ART_PIPELINE §9) instead of a
  // second copy under the app package.
  publicDir: fileURLToPath(new URL('../../assets', import.meta.url)),
});
