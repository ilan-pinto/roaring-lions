// Which languages one `pnpm ui:shots` run photographs (GH-1406, GH-1407; the lead's ruling D9 on PR 1474: "add
// `ui:shots --lang=<id>` (CI only) before the first translation lands"). Pure, so the parsing and the no-locale no-op are
// tested without a browser, a port or a dev server (`shot-locales.test.ts`); `shoot.ts` calls `planLocales` BEFORE it
// claims a port, so a run with nothing to photograph never starts anything.
//
// The flags, and what each puts on every navigation:
//   (none)              English, no query: the walk as it has always been, into <out>/<WxH>/.
//   --pseudo, --pseudo=1  `?pseudo=1`, the bracketed pseudo-locale (`i18n/pseudo.ts`), into <out>/<WxH>/ as before.
//   --pseudo=rtl        `?pseudo=rtl`, the same forced right-to-left (`dir="rtl"`, `qps-plocm`), into <out>/<WxH>/.
//   --lang=<id>[,<id>]  `?lang=<id>`, each shipped locale in turn, into <out>/<id>/<WxH>/.
//   --lang=all          every shipped locale but `en` (the plain walk already photographs `en`). With none shipped -- every
//                       day until the first translation lands -- the run is a clean no-op: one line, exit 0.
//
// "Shipped" is `LOCALES` in `packages/app/src/i18n/locales.ts`, and nothing else, because that table is what the app's
// own `resolveLang` honours: a `?lang=` it does not list is IGNORED and the screen comes up in English. Photographing that
// under a `fr/` directory would be a mislabelled English capture, so an unlisted id is refused (exit 2), never shot.
// `--pseudo` with `--lang` is refused too: the app lets the pseudo-locale win (`pseudoMode ?? lang` in `main.ts`), so the
// pictures would not be the language the directory names.
//
// The overflow probe stays a REPORT per locale (`overflowReport`), never a gate: an ellipsis can be the design.

/** One pass of the whole walk in one language. */
export interface LocalePass {
  /** What the log and the overflow report call it: `en`, `pseudo`, `pseudo-rtl` or a locale id. */
  label: string;
  /** The query every navigation carries, without its `?`/`&`; `''` for the plain English walk. */
  query: string;
  /** Directory under `--out` the pass's `<WxH>/` folders go in; `''` keeps the old layout. */
  subdir: string;
}

export type LocalePlan =
  | { kind: "run"; passes: LocalePass[] }
  | { kind: "nothing"; message: string }
  | { kind: "refuse"; message: string };

const PSEUDO_FLAG = "--pseudo";
const LANG_FLAG = "--lang";

function flagValues(
  argv: readonly string[],
  flag: string,
): { bare: number; values: string[] } {
  let bare = 0;
  const values: string[] = [];
  for (const a of argv) {
    if (a === flag) bare += 1;
    else if (a.startsWith(`${flag}=`)) values.push(a.slice(flag.length + 1));
  }
  return { bare, values };
}

/**
 * The passes a run makes, the no-op, or the refusal (with the line to print). `shipped` is the app's `LOCALES` ids, passed
 * in so the test can name a world with translations in it.
 */
export function planLocales(
  argv: readonly string[],
  shipped: readonly string[],
): LocalePlan {
  const pseudo = flagValues(argv, PSEUDO_FLAG);
  const lang = flagValues(argv, LANG_FLAG);
  const pseudoCount = pseudo.bare + pseudo.values.length;
  const langCount = lang.bare + lang.values.length;
  if (pseudoCount > 1)
    return {
      kind: "refuse",
      message: `${PSEUDO_FLAG} was given ${pseudoCount} times; give it once`,
    };
  if (langCount > 1)
    return {
      kind: "refuse",
      message: `${LANG_FLAG} was given ${langCount} times; list the ids in one flag (--lang=a,b)`,
    };
  if (pseudoCount > 0 && langCount > 0) {
    return {
      kind: "refuse",
      message: `${PSEUDO_FLAG} and ${LANG_FLAG} cannot be combined: the app lets the pseudo-locale win, so the pictures would not be the language named`,
    };
  }
  if (lang.bare > 0)
    return {
      kind: "refuse",
      message: `${LANG_FLAG} needs a value: --lang=<id>[,<id>...] or --lang=all`,
    };

  if (pseudoCount > 0) {
    const value = pseudo.values[0] ?? "1";
    if (value === "1")
      return {
        kind: "run",
        passes: [{ label: "pseudo", query: "pseudo=1", subdir: "" }],
      };
    if (value === "rtl")
      return {
        kind: "run",
        passes: [{ label: "pseudo-rtl", query: "pseudo=rtl", subdir: "" }],
      };
    return {
      kind: "refuse",
      message: `${PSEUDO_FLAG}="${value}" is not recognised; use --pseudo (or --pseudo=1) or --pseudo=rtl`,
    };
  }

  const value = lang.values[0];
  if (value === undefined)
    return { kind: "run", passes: [{ label: "en", query: "", subdir: "" }] };

  const shippedList = shipped.length > 0 ? shipped.join(", ") : "(none)";
  let ids: string[];
  if (value === "all") {
    ids = shipped.filter((id) => id !== "en");
    if (ids.length === 0) {
      return {
        kind: "nothing",
        message: `--lang=all: no locale ships besides en (LOCALES in packages/app/src/i18n/locales.ts lists ${shippedList}), so there is nothing to photograph`,
      };
    }
  } else {
    ids = value.split(",");
    const unknown = ids.filter((id) => !shipped.includes(id));
    if (unknown.length > 0) {
      const named = unknown.map((id) => `"${id}"`).join(", ");
      return {
        kind: "refuse",
        message: `--lang: ${named} is not a shipped locale (LOCALES lists ${shippedList}); the app ignores an unlisted ?lang= and would draw English, so it is not photographed under that name`,
      };
    }
  }
  const unique = [...new Set(ids)];
  return {
    kind: "run",
    passes: unique.map((id) => ({
      label: id,
      query: `lang=${encodeURIComponent(id)}`,
      subdir: id,
    })),
  };
}

/** `base` + the app path `p` + the pass's query, joined with `?` or `&` as `p` needs. */
export function withLocaleQuery(
  base: string,
  p: string,
  query: string,
): string {
  if (query === "") return `${base}${p}`;
  return `${base}${p}${p.includes("?") ? "&" : "?"}${query}`;
}

/** The two sticky locale keys the router carries forward (`STICKY_QUERY_KEYS` in `shell/router.ts`). */
const LOCALE_KEYS = ["lang", "pseudo"] as const;

/**
 * Whether a landed URL still carries exactly the pass's locale query: the same `lang` and `pseudo` values, and neither
 * when the pass has none. The escape-from-briefing check reads this, so a navigation that dropped the language (and
 * would photograph English from there on) says UNEXPECTED.
 */
export function carriesLocaleQuery(
  landed: URLSearchParams,
  query: string,
): boolean {
  const expected = new URLSearchParams(query);
  return LOCALE_KEYS.every((key) => landed.get(key) === expected.get(key));
}

/**
 * The overflow probe's bottom lines, one per pass, stated even at zero ("no overflow" and "the probe never ran" look
 * the same in a log that only speaks on a hit). The plain English pass keeps the line it has always printed; any other
 * pass names its locale. A report, never a gate.
 */
export function overflowReport(
  totals: readonly { pass: LocalePass; total: number }[],
): string[] {
  return totals.map(({ pass, total }) => {
    const tag = pass.query === "" ? "" : ` [${pass.label}]`;
    return `overflow probe${tag}: ${total} element(s) wider than their own box, across every shot above`;
  });
}
