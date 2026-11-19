// GH-1418 desktop spike: the `app://` scheme's resolver (`tools/desktop/resolve.mjs`, used by `main.mjs`'s `serve`).
// The versus lobby POSTs `${location.origin}/api/match` with no host gate, so `/api/...` must be a 404 and never the
// SPA shell's 200. Literals only: the oracle is these paths, not anything the resolver computes.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveRequest } from '../desktop/resolve.mjs';

const HOST = 'roaring-lions.local';
const WEB = path.join(path.sep, 'bundle', 'web');
// The files the fake bundle holds.
const FILES = new Set([path.join(WEB, 'index.html'), path.join(WEB, 'draco', 'draco_decoder.wasm')]);
const opts = { host: HOST, webRoot: WEB, isFile: (f: string) => FILES.has(f) };
const at = (p: string) => resolveRequest(`app://${HOST}${p}`, opts);

describe('desktop scheme resolver', () => {
  it('answers / with index.html', () => {
    expect(at('/')).toEqual({ status: 200, file: path.join(WEB, 'index.html') });
  });

  it('answers a screen path with the SPA shell', () => {
    expect(at('/free-play')).toEqual({ status: 200, file: path.join(WEB, 'index.html') });
  });

  it('serves a real file', () => {
    expect(at('/draco/draco_decoder.wasm')).toEqual({ status: 200, file: path.join(WEB, 'draco', 'draco_decoder.wasm') });
  });

  it.each(['/api/match', '/api/match/ABCD/join', '/api/account/open', '/api', '/%61pi/match'])('answers %s with a 404', (p) => {
    expect(at(p)).toEqual({ status: 404, reason: 'api' });
  });

  it('does not treat a screen that merely starts with "api" as the API', () => {
    expect(at('/apiary')).toEqual({ status: 200, file: path.join(WEB, 'index.html') });
  });

  it('refuses a missing file with an extension, another host and an escape', () => {
    expect(at('/meshes/nope.glb')).toEqual({ status: 404, reason: 'missing' });
    expect(resolveRequest('app://evil.local/', opts)).toEqual({ status: 404, reason: 'host' });
    expect(at('/..%2F..%2Fetc%2Fpasswd')).toEqual({ status: 404, reason: 'escape' });
  });
});
