// Reads an `en.json` message the way a PLAYER does: ICU placeholders and
// plural/select syntax stripped, the branch text kept, HTML tags dropped.
// Shared by the wording tests (`player-wording.test.ts`,
// `fire-support-wording.test.ts`); it lives here rather than in either so a
// test never imports another test file.

/** The text of an ICU message as a reader sees it, plus its argument names. */
export function playerText(msg: string): { text: string; args: string[] } {
  const args: string[] = [];
  const readUntil = (s: string, i: number, stops: string): number => {
    while (i < s.length && !stops.includes(s[i])) i++;
    return i;
  };
  const parse = (s: string, start: number, nested: boolean): [string, number] => {
    let out = '';
    let i = start;
    while (i < s.length) {
      const ch = s[i];
      if (ch === '}' && nested) return [out, i + 1];
      if (ch === '{') {
        const j = readUntil(s, i + 1, ',}');
        args.push(s.slice(i + 1, j).trim());
        if (s[j] !== ',') {
          out += ' ';
          i = j + 1;
          continue;
        }
        const k = readUntil(s, j + 1, ',}');
        if (s[k] !== ',') {
          out += ' ';
          i = k + 1;
          continue;
        }
        // plural / select branches: `selector {text}` until the closing brace
        i = k + 1;
        for (;;) {
          while (i < s.length && /\s/.test(s[i])) i++;
          if (i >= s.length) break;
          if (s[i] === '}') {
            i++;
            break;
          }
          const open = readUntil(s, i, '{');
          const [branch, next] = parse(s, open + 1, true);
          out += ` ${branch} `;
          i = next;
        }
        continue;
      }
      out += ch === '#' ? ' ' : ch;
      i++;
    }
    return [out, i];
  };
  const [raw] = parse(msg, 0, false);
  return { text: raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), args };
}
