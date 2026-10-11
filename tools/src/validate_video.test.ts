// The data gate's video provenance and size checks (tools/validate_video.mjs),
// against fixtures it must reject and against the shipped tree, which it must
// pass in the default mode, and in commercial mode fail exactly once per
// unconfirmed entry (the two Tel Marum files that were unconfirmed were
// removed 2026-10-11, ASSET_PROVENANCE.md item 4; the fixtures below carry
// the unconfirmed and over-budget cases now).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, MAX_TOTAL_BYTES, videoFailures } from '../validate_video.mjs';

const ROOT = join(__dirname, '..', '..');

const confirmed = {
  what: 'Tel Marum backdrop',
  generator: { tool: 'Gemini API', model_id: 'veo-3.1-fast-generate-preview', plan: 'paid tier (Cloud Billing)' },
  source: 'docs/cinematics/stills/tel_marum.jpg',
  license: 'ARR; Gemini API Additional Terms (no ownership claimed)',
  terms_read: '2026-10-11',
  audio: 'none',
  commercial: 'confirmed',
  record: 'ASSET_PROVENANCE.md "Cinematics"; art/video/takes/tel_marum/final-x.json',
};
const unknown = { ...confirmed, generator: 'unrecorded', source: 'unrecorded', license: 'unrecorded', terms_read: null, audio: 'unrecorded', commercial: 'unconfirmed' };
const one = (bytes = 1_500_000) => [{ path: 'video/a.mp4', bytes }];

describe('videoFailures', () => {
  it('passes a confirmed entry, and an honest unconfirmed one outside commercial mode', () => {
    expect(videoFailures({ files: { 'video/a.mp4': confirmed } }, one(), ['video/a.mp4'])).toEqual([]);
    expect(videoFailures({ files: { 'video/a.mp4': unknown } }, one(), [])).toEqual([]);
    expect(videoFailures({ files: { 'video/a.mp4': confirmed } }, one(), [], { commercial: true })).toEqual([]);
  });

  it('passes the empty state: no files, no entries, no mission naming a video', () => {
    expect(videoFailures({ files: {} }, [], [])).toEqual([]);
    expect(videoFailures({ files: {} }, [], [], { commercial: true })).toEqual([]);
    // ... and a mission still naming a video refuses, which is what the Tel Marum removal had to avoid
    expect(videoFailures({ files: {} }, [], ['video/gone.mp4']).some((x) => x.includes('no provenance entry'))).toBe(true);
  });

  it('refuses a file with no entry, and an entry with no file', () => {
    const f = videoFailures({ files: {} }, one(), []);
    expect(f.some((x) => x.includes('assets/video/a.mp4: no provenance entry'))).toBe(true);
    const g = videoFailures({ files: { 'video/a.mp4': confirmed, 'video/gone.mp4': confirmed } }, one(), []);
    expect(g.some((x) => x.includes('"video/gone.mp4": no such file'))).toBe(true);
  });

  it('refuses a mission naming a video the manifest does not describe', () => {
    const f = videoFailures({ files: { 'video/a.mp4': confirmed } }, one(), ['video/b.mp4']);
    expect(f.some((x) => x.includes('briefing_video "video/b.mp4": no provenance entry'))).toBe(true);
  });

  it('refuses a missing field, by name', () => {
    const noAudio: Record<string, unknown> = { ...confirmed };
    delete noAudio.audio;
    const f = videoFailures({ files: { 'video/a.mp4': noAudio } }, one(), []);
    expect(f.some((x) => x.includes('missing "audio"'))).toBe(true);
  });

  it('refuses a "confirmed" claim with anything unrecorded, naming what', () => {
    const f = videoFailures({ files: { 'video/a.mp4': { ...confirmed, generator: 'unrecorded', terms_read: null } } }, one(), []);
    expect(f.some((x) => /commercial "confirmed" with generator, terms_read unrecorded/.test(x))).toBe(true);
    const g = videoFailures({ files: { 'video/a.mp4': { ...confirmed, generator: { tool: 'Gemini API', model_id: '', plan: 'paid' } } } }, one(), []);
    expect(g.some((x) => x.includes('generator must be'))).toBe(true);
  });

  it('commercial mode refuses every unconfirmed entry', () => {
    const f = videoFailures({ files: { 'video/a.mp4': unknown } }, one(), [], { commercial: true });
    expect(f).toEqual([expect.stringContaining('cannot ship in a commercial build')]);
  });

  it('refuses a file over the per-file budget, and a directory over the total', () => {
    expect(videoFailures({ files: { 'video/a.mp4': confirmed } }, one(MAX_FILE_BYTES), [])).toEqual([]);
    const f = videoFailures({ files: { 'video/a.mp4': confirmed } }, one(MAX_FILE_BYTES + 1), []);
    expect(f.some((x) => x.includes('per-file budget'))).toBe(true);
    const many = Array.from({ length: 4 }, (_, i) => ({ path: `video/v${i}.mp4`, bytes: 4 * 1024 * 1024 }));
    const files = Object.fromEntries(many.map((m) => [m.path, confirmed]));
    expect(videoFailures({ files }, many, []).some((x) => x.includes('in all is over'))).toBe(true);
    expect(MAX_TOTAL_BYTES).toBe(15 * 1024 * 1024);
  });

  it('refuses a non-video file in assets/video/', () => {
    const f = videoFailures({ files: { 'video/a.gif': confirmed } }, [{ path: 'video/a.gif', bytes: 10 }], []);
    expect(f.some((x) => x.includes('only .mp4 and .webm'))).toBe(true);
  });
});

describe('the shipped tree', () => {
  const manifest: unknown = JSON.parse(readFileSync(join(ROOT, 'data/video.json'), 'utf8'));
  const dir = join(ROOT, 'assets/video');
  // The directory is absent while no video ships (git keeps no empty dir).
  const onDisk = (existsSync(dir) ? readdirSync(dir) : [])
    .filter((f) => !f.startsWith('.'))
    .map((f) => ({ path: `video/${f}`, bytes: statSync(join(dir, f)).size }));
  const referenced = readdirSync(join(ROOT, 'data/missions'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => (JSON.parse(readFileSync(join(ROOT, 'data/missions', f), 'utf8')) as { briefing_video?: string }).briefing_video)
    .filter((v): v is string => typeof v === 'string');

  it('passes the default gate', () => {
    expect(videoFailures(manifest, onDisk, referenced)).toEqual([]);
  });

  it('fails the commercial gate once for each unconfirmed entry (none today)', () => {
    const files = (manifest as { files: Record<string, { commercial: string }> }).files;
    const unconfirmed = Object.entries(files).filter(([, e]) => e.commercial !== 'confirmed');
    expect(videoFailures(manifest, onDisk, referenced, { commercial: true })).toHaveLength(unconfirmed.length);
  });
});
