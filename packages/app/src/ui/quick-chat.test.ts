// GH-1417 S1b: the quick-chat phrases are exactly the protocol's ids, each with words in the catalogue.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { QUICK_CHAT_IDS, quickChatText } from './quick-chat';

const en = JSON.parse(readFileSync(join(__dirname, '..', 'i18n', 'en.json'), 'utf8')) as Record<string, string>;

describe('quick chat phrases', () => {
  it('every protocol id has a non-empty, distinct, short phrase in en.json', () => {
    const phrases = QUICK_CHAT_IDS.map((id) => quickChatText(id));
    for (const [i, p] of phrases.entries()) {
      expect(p.trim().length, QUICK_CHAT_IDS[i]).toBeGreaterThan(0);
      expect(p.length, QUICK_CHAT_IDS[i]).toBeLessThanOrEqual(40);
      expect(p, QUICK_CHAT_IDS[i]).not.toMatch(/^net\.quick\./); // a missing key would come back as itself
    }
    expect(new Set(phrases).size).toBe(QUICK_CHAT_IDS.length);
  });
  it('en.json holds a net.quick.<id> for every id and no other net.quick phrase (a stray one would be a menu line nobody can send)', () => {
    const keys = Object.keys(en).filter((k) => k.startsWith('net.quick.') && k !== 'net.quick.label' && k !== 'net.quick.prompt').sort();
    expect(keys).toEqual(QUICK_CHAT_IDS.map((id) => `net.quick.${id}`).sort());
  });
});
