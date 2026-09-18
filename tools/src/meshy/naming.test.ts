/**
 * Slug/date/dir naming and the base64 data-URI encoding of a local image.
 * The PNG this writes to a temp dir is a 1x1 fixture, not a real asset.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fileToDataUri, formatYyyymmdd, isHttpUrl, resolveImageUrl, slugify, taskDirName } from './naming';

describe('slugify', () => {
  it('lower-cases and hyphenates', () => {
    expect(slugify('A Desert Watchtower')).toBe('a-desert-watchtower');
  });

  it('collapses runs of non-alphanumerics into one hyphen', () => {
    expect(slugify('rusty   old!!  jeep')).toBe('rusty-old-jeep');
  });

  it('strips leading/trailing hyphens', () => {
    expect(slugify('--edge case--')).toBe('edge-case');
  });

  it('strips diacritics', () => {
    expect(slugify('café façade')).toBe('cafe-facade');
  });

  it('caps length and drops a trailing partial hyphen', () => {
    const long = 'a very long prompt describing an entire fortified compound with many details';
    const slug = slugify(long, 20);
    expect(slug.length).toBeLessThanOrEqual(20);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('falls back to "untitled" for input with no alphanumerics', () => {
    expect(slugify('!!!')).toBe('untitled');
    expect(slugify('   ')).toBe('untitled');
    expect(slugify('')).toBe('untitled');
  });
});

describe('formatYyyymmdd', () => {
  it('formats in UTC, zero-padded', () => {
    expect(formatYyyymmdd(new Date(Date.UTC(2026, 8, 18, 23, 59)))).toBe('20260918');
    expect(formatYyyymmdd(new Date(Date.UTC(2026, 0, 5)))).toBe('20260105');
  });
});

describe('taskDirName', () => {
  it('joins slug, date, and the first 8 chars of the task id', () => {
    const date = new Date(Date.UTC(2026, 8, 18));
    expect(taskDirName('Watchtower', '018f1a2b-cccc-dddd-eeee-ffffffffffff', date)).toBe('watchtower-20260918-018f1a2b');
  });

  it('slugifies the name/prompt input', () => {
    const date = new Date(Date.UTC(2026, 8, 18));
    expect(taskDirName('A Rusty Old Jeep!', 'abcdefgh12345678', date)).toBe('a-rusty-old-jeep-20260918-abcdefgh');
  });
});

describe('isHttpUrl', () => {
  it('accepts http/https', () => {
    expect(isHttpUrl('https://example.com/a.png')).toBe(true);
    expect(isHttpUrl('http://example.com/a.png')).toBe(true);
  });

  it('rejects a local path', () => {
    expect(isHttpUrl('/tmp/a.png')).toBe(false);
    expect(isHttpUrl('a.png')).toBe(false);
  });
});

// A minimal valid 1x1 transparent PNG, used only to exercise the encoder.
const ONE_PIXEL_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a4944415478da6360000002000155bce2210000000049454e44ae426082',
  'hex'
);

describe('fileToDataUri / resolveImageUrl', () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('encodes a .png as a base64 data URI', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'meshy-naming-test-'));
    const file = path.join(dir, 'source.png');
    writeFileSync(file, ONE_PIXEL_PNG);
    const uri = fileToDataUri(file);
    expect(uri.startsWith('data:image/png;base64,')).toBe(true);
    const b64 = uri.slice('data:image/png;base64,'.length);
    expect(Buffer.from(b64, 'base64').equals(ONE_PIXEL_PNG)).toBe(true);
  });

  it('treats .jpg and .jpeg as image/jpeg', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'meshy-naming-test-'));
    const jpg = path.join(dir, 'a.jpg');
    const jpeg = path.join(dir, 'b.jpeg');
    writeFileSync(jpg, ONE_PIXEL_PNG);
    writeFileSync(jpeg, ONE_PIXEL_PNG);
    expect(fileToDataUri(jpg).startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(fileToDataUri(jpeg).startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('refuses an unsupported extension', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'meshy-naming-test-'));
    const file = path.join(dir, 'source.gif');
    writeFileSync(file, ONE_PIXEL_PNG);
    expect(() => fileToDataUri(file)).toThrow(/unsupported image extension/);
  });

  it('resolveImageUrl passes an http(s) URL through unchanged', () => {
    expect(resolveImageUrl('https://example.com/a.png')).toBe('https://example.com/a.png');
  });

  it('resolveImageUrl encodes a local path', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'meshy-naming-test-'));
    const file = path.join(dir, 'source.png');
    writeFileSync(file, ONE_PIXEL_PNG);
    expect(resolveImageUrl(file).startsWith('data:image/png;base64,')).toBe(true);
  });
});
