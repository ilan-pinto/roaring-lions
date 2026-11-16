// GH-1406: a non-English CHROME catalogue (packages/app/src/i18n/<id>.json, beside en.json) must carry exactly en.json's keys and the
// same message SHAPE in every value: the same {placeholders}, and for an ICU `plural` / `select` the same argument, kind and option
// keys. A translator may reorder placeholders and translate the text around and inside the options; nothing else.
//
// Pure function over plain data, like validate_narrative.mjs, so a test can call it against a bare fixture. validate_data.mjs runs it
// for every catalogue it finds. (Mission and unit text carry source hashes against an English edit, `validate_narrative.mjs`; chrome
// strings do not, so an English edit after translation is a text-freeze matter, not something this can see.)

/** The shape of one message: a sorted list of `name` for a simple argument and `name:kind[opt,opt]{...inner shapes}` for ICU. */
export function messageShape(msg) {
  const out = [];
  const walk = (s, into) => {
    let i = 0;
    while (i < s.length) {
      if (s[i] !== '{') { i += 1; continue; }
      let depth = 1;
      let j = i + 1;
      while (j < s.length && depth > 0) {
        if (s[j] === '{') depth += 1;
        else if (s[j] === '}') depth -= 1;
        j += 1;
      }
      if (depth !== 0) { into.push('!unbalanced'); return; }
      const body = s.slice(i + 1, j - 1);
      const m = /^\s*([A-Za-z0-9_]+)\s*(?:,\s*(plural|select)\s*,([\s\S]*))?$/.exec(body);
      if (m === null) into.push(`!unparsed:${body}`);
      else if (m[2] === undefined) into.push(m[1]);
      else {
        // options: key {text} key {text} ...
        const opts = [];
        const rest = m[3];
        let k = 0;
        while (k < rest.length) {
          const km = /^\s*([^\s{]+)\s*\{/.exec(rest.slice(k));
          if (km === null) break;
          const start = k + km[0].length;
          let d = 1;
          let e = start;
          while (e < rest.length && d > 0) {
            if (rest[e] === '{') d += 1;
            else if (rest[e] === '}') d -= 1;
            e += 1;
          }
          const inner = [];
          walk(rest.slice(start, e - 1), inner);
          const hashes = (rest.slice(start, e - 1).match(/#/g) ?? []).length > 0 ? '#' : '';
          opts.push(`${km[1]}${hashes}${inner.length ? `(${inner.sort().join(',')})` : ''}`);
          k = e;
        }
        into.push(`${m[1]}:${m[2]}[${opts.sort().join('|')}]`);
      }
      i = j;
    }
  };
  walk(msg, out);
  return out.sort();
}

/** Failure strings; `[]` when `tr` has exactly `en`'s keys, each a non-empty string of the same shape. */
export function chromeCatalogueFailures(file, en, tr) {
  const out = [];
  if (tr === null || typeof tr !== 'object' || Array.isArray(tr)) return [`${file}: not a JSON object of key -> text`];
  for (const key of Object.keys(en)) {
    if (!(key in tr)) { out.push(`${file}: missing key "${key}"`); continue; }
    const v = tr[key];
    if (typeof v !== 'string' || v.trim() === '') { out.push(`${file}: "${key}" is not a non-empty string`); continue; }
    const want = messageShape(en[key]).join(' ');
    const got = messageShape(v).join(' ');
    if (want !== got) out.push(`${file}: "${key}" has the wrong placeholders (English: ${want || 'none'}; here: ${got || 'none'})`);
  }
  for (const key of Object.keys(tr)) if (!(key in en)) out.push(`${file}: "${key}" is not a key of en.json`);
  return out;
}
