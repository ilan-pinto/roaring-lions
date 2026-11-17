// GH-1417 S1: the source guard for the chat inbox. Every received line reaches the screen through `ChatInbox.deliver`, in the lobby log
// and in the match's HUD feed; a third place that reads a raw line, or a sink that stops going through the inbox, fails here. It reads the
// app's source (not the built bundle), so a new sink is caught the day it is written.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');
const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });

interface Hit { file: string; line: number; text: string }
function scan(re: RegExp): Hit[] {
  const out: Hit[] = [];
  for (const p of sources(SRC)) {
    const lines = readFileSync(p, 'utf8').split('\n');
    lines.forEach((text, i) => {
      // comments and doc blocks may name these; code may not
      const code = text.replace(/\/\/.*$/, '');
      if (/^\s*\*/.test(text) || /^\s*\/\*/.test(text)) return;
      if (re.test(code)) out.push({ file: relative(SRC, p), line: i + 1, text: code.trim() });
    });
  }
  return out;
}

describe('the chat inbox is the only door (GH-1417 S1)', () => {
  it('the transport\'s onChat hook is set in exactly the lobby and the battlefield, and each goes through `.deliver(`', () => {
    const hits = scan(/\bonChat\b/);
    const files = [...new Set(hits.map((h) => h.file))].sort();
    // connect.ts only clears the hook; net-chat.ts names it in prose already filtered; nothing else may read a raw line
    expect(files).toEqual(['main.ts', 'net/connect.ts', 'ui/versus.ts']);
    for (const h of hits.filter((x) => x.file !== 'net/connect.ts')) expect(h.text, `${h.file}:${h.line}`).toContain('.deliver(');
    for (const h of hits.filter((x) => x.file === 'net/connect.ts')) expect(h.text, `${h.file}:${h.line}`).toMatch(/onChat:\s*undefined/);
    // not vacuous: both sinks were found
    expect(hits.some((h) => h.file === 'main.ts')).toBe(true);
    expect(hits.some((h) => h.file === 'ui/versus.ts')).toBe(true);
  });

  it('`chatFeedLine` and `NetChat.receive` are called only from inside a `.deliver(` callback', () => {
    const feed = scan(/\bchatFeedLine\(/).filter((h) => !/export function chatFeedLine/.test(h.text));
    expect(feed.length, 'the feed sink exists').toBeGreaterThan(0);
    for (const h of feed) expect(h.text, `${h.file}:${h.line}`).toContain('.deliver(');
    const receive = scan(/[cC]hat\??\.receive\(/);
    expect(receive.length, 'the lobby sink exists').toBeGreaterThan(0);
    for (const h of receive) expect(h.text, `${h.file}:${h.line}`).toContain('.deliver(');
  });

  it('both sinks take their inbox from `inboxOf` on the room\'s transport, so a lobby mute holds in the match', () => {
    const versus = readFileSync(join(SRC, 'ui/versus.ts'), 'utf8');
    const main = readFileSync(join(SRC, 'main.ts'), 'utf8');
    expect(versus).toMatch(/inboxOf\(room\.transport,/);
    expect(versus).toMatch(/inboxOf\(r\.transport,/);
    expect(main).toMatch(/inboxOf\(room,/);
  });

  it('nothing but the settings module reads or writes `lions.settings`, and the chat setting is read through the settings object', () => {
    const hits = scan(/lions\.settings/).map((h) => h.file);
    expect(new Set(hits)).toEqual(new Set(['settings.ts']));
    const main = readFileSync(join(SRC, 'main.ts'), 'utf8');
    expect(main).toContain('settingsDeps.get().chat.enabled');
    expect(main).toContain('req.settings.get().chat.enabled');
  });

  it('GH-1417 S2: both sinks hand the inbox the mask setting, read through the settings object, and this player\'s seat (CR4: its own echo is not masked); nothing names a hide setting', () => {
    const versus = readFileSync(join(SRC, 'ui/versus.ts'), 'utf8');
    const main = readFileSync(join(SRC, 'main.ts'), 'utf8');
    expect(main).toContain('inboxOf(room, () => req.settings.get().chat.enabled, () => req.settings.get().chat.mask, netSeat)');
    expect(main).toContain('chatMask: () => settingsDeps.get().chat.mask');
    expect(versus).toMatch(/inboxOf\(room\.transport, deps\.chatEnabled \?\? \(\(\) => true\), deps\.chatMask, room\.seat\)/);
    expect(versus).toMatch(/inboxOf\(r\.transport, deps\.chatEnabled \?\? \(\(\) => true\), deps\.chatMask, r\.seat\)/);
    // every call names a seat: one left without it would mask this player's own lines on whichever screen asked last
    expect(versus.match(/inboxOf\(/g)?.length).toBe(2);
    expect(main.match(/inboxOf\(/g)?.length).toBe(1);
    expect(scan(/chat\.hide\b/)).toEqual([]);
  });

  it('GH-1417 S2: the filter builds no regular expression, and every seat name is made through it in seat-label.ts', () => {
    const filter = readFileSync(join(SRC, 'ui/chat-filter.ts'), 'utf8')
      .split('\n')
      .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l))
      .join('\n');
    expect(filter).not.toMatch(/RegExp|\.replace\(|\.match\(|\.matchAll\(|\.test\(|\.search\(|\.split\(/);
    const label = readFileSync(join(SRC, 'net/seat-label.ts'), 'utf8');
    expect(label).toContain('const shown = (raw: string): string => shownName(raw);');
    expect(label).toContain("import { shownName } from '../ui/chat-filter-gate';");
    expect(label.match(/shown\(/g)?.length, 'the model, member, bot, guest and fallback names').toBe(5);
  });
});
