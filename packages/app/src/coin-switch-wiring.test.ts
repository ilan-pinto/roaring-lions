// E13 review F3 (GH-1415): the guest coin Buy in `main.ts` is gated by `buyWithCoins`' DEFAULT argument alone, which is
// `COINS_COSMETIC_ONLY`. A fifth argument there (a literal `false`, say) would keep the guest power lane open after the
// flip, and no behaviour test can see it: the Stores hide the coin Buy when the switch is on, so the handler is never
// reached in a test. This is the source guard. It also holds the signed-in wiring (`account/boot.ts`'s `spendFlow`) and
// the garage's Stores tab in `main.ts` to the default: neither may name `cosmeticOnly`.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(resolve(__dirname, rel), 'utf8');

/** The top-level arguments of every call `name(...)` in `src`, split at depth-0 commas (strings and comments in the
 *  argument lists here are plain, so bracket depth is enough). */
function callArgs(src: string, name: string): string[][] {
  const out: string[][] = [];
  const re = new RegExp(`\\b${name}\\(`, 'g');
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    const args: string[] = [];
    let depth = 0;
    let cur = '';
    for (let i = m.index + m[0].length; i < src.length; i++) {
      const c = src[i];
      if (depth === 0 && c === ')') break;
      if ('([{'.includes(c)) depth++;
      if (')]}'.includes(c)) depth--;
      if (depth === 0 && c === ',') {
        args.push(cur.trim());
        cur = '';
      } else cur += c;
    }
    if (cur.trim() !== '') args.push(cur.trim());
    out.push(args);
  }
  return out;
}

describe('the coin switch reaches production through its default', () => {
  it('main.ts: the guest Buy calls buyWithCoins with four arguments, so the fifth is COINS_COSMETIC_ONLY', () => {
    const calls = callArgs(read('main.ts'), 'buyWithCoins');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(4);
    expect(calls[0][3]).toBe('Date.now()');
  });

  it('main.ts and account/boot.ts never name the switch, so the Stores tab and the spend flow read the constant', () => {
    for (const f of ['main.ts', 'account/boot.ts']) expect(read(f), f).not.toMatch(/cosmeticOnly|COINS_COSMETIC_ONLY/);
  });

  it('the guard can see a fifth argument (the splitter is not vacuous)', () => {
    expect(callArgs('buyWithCoins(a(1, 2), { b: [3, 4] }, c, d, false)', 'buyWithCoins')).toEqual([['a(1, 2)', '{ b: [3, 4] }', 'c', 'd', 'false']]);
  });
});
