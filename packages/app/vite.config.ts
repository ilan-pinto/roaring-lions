import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
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
