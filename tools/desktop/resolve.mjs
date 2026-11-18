// GH-1418 desktop spike: which bundled file (if any) the `app://` scheme answers a request with.
//
// Pure, so it can be tested without Electron (`tools/src/desktop_serve.test.ts`): `main.mjs` imports it, and
// `build-local.mjs` copies it into the staging app next to `main.mjs`. The only I/O is the injected `isFile`.

import path from 'node:path';

/**
 * Resolve a request URL against the bundled build.
 *
 * Returns `{ status: 404, reason }` or `{ status: 200, file }` (an absolute path under `webRoot`).
 *
 * @param {string} requestUrl
 * @param {{ host: string, webRoot: string, isFile: (file: string) => boolean }} opts
 */
export function resolveRequest(requestUrl, { host, webRoot, isFile }) {
  const url = new URL(requestUrl);
  if (url.host !== host) return { status: 404, reason: 'host' };
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return { status: 404, reason: 'encoding' };
  }
  // The Worker's API is not in the bundle. The versus lobby POSTs `${location.origin}/api/match` with no host gate,
  // so without this an extension-less `/api/...` would fall through to the SPA shell and answer index.html with a 200.
  // A 404 makes the lobby fail cleanly. Checked BEFORE the SPA fallback, on the decoded path.
  if (rel === '/api' || rel.startsWith('/api/')) return { status: 404, reason: 'api' };
  const file = path.normalize(path.join(webRoot, rel));
  // Never serve outside the bundled build.
  if (file !== webRoot && !file.startsWith(webRoot + path.sep)) return { status: 404, reason: 'escape' };
  if (isFile(file)) return { status: 200, file };
  // The router's screens are PATHS (`/campaign`, `/mission/<id>`): a path with no extension is a screen, and gets the
  // SPA shell, as the Worker's asset fallback does. A missing file with an extension is a real 404.
  if (path.extname(rel) !== '') return { status: 404, reason: 'missing' };
  return { status: 200, file: path.join(webRoot, 'index.html') };
}
