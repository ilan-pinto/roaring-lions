// `ui:shots`'s language flags (GH-1406, GH-1407; the lead's ruling D9 on PR 1474), without a browser: the parsing, the
// no-locale no-op, the URL each pass navigates to, the landed-URL check and the per-locale overflow lines. The last block
// runs the real `shoot.ts` in a child and proves the no-op leaves before a port, a server or a browser is touched.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOCALES } from "../../../packages/app/src/i18n/locales";
import {
  carriesLocaleQuery,
  overflowReport,
  planLocales,
  withLocaleQuery,
  type LocalePass,
} from "./shot-locales";

// Literals, not `LOCALES`: the oracle never takes its arguments from the code under test.
const EN_ONLY = ["en"];
const SHIPPED = ["en", "fr", "de"];

const EN: LocalePass = { label: "en", query: "", subdir: "" };

describe("planLocales", () => {
  it("with no language flag walks English once, into the old layout", () => {
    expect(planLocales(["--res=1400x900", "--out=x"], SHIPPED)).toEqual({
      kind: "run",
      passes: [EN],
    });
  });

  it("--pseudo and --pseudo=1 are the bracketed pseudo-locale, into the old layout", () => {
    const pseudo = {
      kind: "run",
      passes: [{ label: "pseudo", query: "pseudo=1", subdir: "" }],
    };
    expect(planLocales(["--pseudo"], EN_ONLY)).toEqual(pseudo);
    expect(planLocales(["--pseudo=1"], EN_ONLY)).toEqual(pseudo);
  });

  it("--pseudo=rtl is the mirrored pseudo-locale, not the plain one", () => {
    expect(planLocales(["--pseudo=rtl"], EN_ONLY)).toEqual({
      kind: "run",
      passes: [{ label: "pseudo-rtl", query: "pseudo=rtl", subdir: "" }],
    });
  });

  it("refuses a --pseudo value it does not know rather than silently walking English", () => {
    const plan = planLocales(["--pseudo=ltr"], EN_ONLY);
    expect(plan.kind).toBe("refuse");
    if (plan.kind === "refuse") expect(plan.message).toContain('"ltr"');
  });

  it("--lang=<id> is one pass per listed shipped id, each into its own directory, duplicates folded", () => {
    expect(planLocales(["--lang=fr,de,fr"], SHIPPED)).toEqual({
      kind: "run",
      passes: [
        { label: "fr", query: "lang=fr", subdir: "fr" },
        { label: "de", query: "lang=de", subdir: "de" },
      ],
    });
  });

  it("--lang=en is honoured as an explicit English pass", () => {
    expect(planLocales(["--lang=en"], SHIPPED)).toEqual({
      kind: "run",
      passes: [{ label: "en", query: "lang=en", subdir: "en" }],
    });
  });

  it("--lang=all is every shipped locale but en", () => {
    const plan = planLocales(["--lang=all"], SHIPPED);
    expect(
      plan.kind === "run" ? plan.passes.map((p) => p.label) : plan,
    ).toEqual(["fr", "de"]);
  });

  it("--lang=all with only en shipped is the no-op: nothing to photograph, one line", () => {
    const plan = planLocales(["--lang=all", "--res=1400x900"], EN_ONLY);
    expect(plan.kind).toBe("nothing");
    if (plan.kind === "nothing") {
      expect(plan.message).toContain("nothing to photograph");
      expect(plan.message).not.toContain("\n");
    }
  });

  it("refuses an id LOCALES does not list (the app would ignore it and draw English under that name)", () => {
    for (const argv of [
      ["--lang=fr"],
      ["--lang=en,xx"],
      ["--lang=pseudo"],
      ["--lang="],
    ]) {
      const plan = planLocales(argv, EN_ONLY);
      expect(plan.kind, argv.join(" ")).toBe("refuse");
      if (plan.kind === "refuse")
        expect(plan.message).toContain("not a shipped locale");
    }
  });

  it("refuses --lang with no value, --lang twice, --pseudo twice, and --pseudo with --lang", () => {
    for (const argv of [
      ["--lang"],
      ["--lang=fr", "--lang=de"],
      ["--pseudo", "--pseudo=rtl"],
      ["--pseudo", "--lang=fr"],
    ]) {
      expect(planLocales(argv, SHIPPED).kind, argv.join(" ")).toBe("refuse");
    }
  });

  it("does not mistake a flag that only starts with the same letters for --lang or --pseudo", () => {
    expect(planLocales(["--language=fr", "--pseudonym"], SHIPPED)).toEqual({
      kind: "run",
      passes: [EN],
    });
  });
});

describe("withLocaleQuery", () => {
  it("leaves the path alone for the plain English pass", () => {
    expect(withLocaleQuery("http://localhost:1", "/campaign", "")).toBe(
      "http://localhost:1/campaign",
    );
  });

  it("starts a query, or joins an existing one", () => {
    expect(withLocaleQuery("http://localhost:1", "/campaign", "lang=fr")).toBe(
      "http://localhost:1/campaign?lang=fr",
    );
    expect(
      withLocaleQuery("http://localhost:1", "/free-play/x?kit", "pseudo=rtl"),
    ).toBe("http://localhost:1/free-play/x?kit&pseudo=rtl");
  });
});

describe("carriesLocaleQuery", () => {
  const q = (s: string) => new URLSearchParams(s);

  it("holds when the landed URL keeps exactly the pass query", () => {
    expect(carriesLocaleQuery(q("lang=fr"), "lang=fr")).toBe(true);
    expect(carriesLocaleQuery(q("pseudo=rtl&accounts"), "pseudo=rtl")).toBe(
      true,
    );
    expect(carriesLocaleQuery(q(""), "")).toBe(true);
  });

  it("fails when the language was dropped, changed, or appeared from nowhere", () => {
    expect(carriesLocaleQuery(q(""), "lang=fr")).toBe(false);
    expect(carriesLocaleQuery(q("lang=de"), "lang=fr")).toBe(false);
    expect(carriesLocaleQuery(q("pseudo=1"), "pseudo=rtl")).toBe(false);
    expect(carriesLocaleQuery(q("pseudo=1"), "")).toBe(false);
  });
});

describe("overflowReport", () => {
  it("prints one line per pass, at zero too, naming every locale but the plain walk", () => {
    const fr: LocalePass = { label: "fr", query: "lang=fr", subdir: "fr" };
    expect(
      overflowReport([
        { pass: EN, total: 0 },
        { pass: fr, total: 3 },
      ]),
    ).toEqual([
      "overflow probe: 0 element(s) wider than their own box, across every shot above",
      "overflow probe [fr]: 3 element(s) wider than their own box, across every shot above",
    ]);
  });
});

describe("shoot.ts --lang=all, run for real", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const toolsDir = path.resolve(here, "../..");
  const tsx = path.join(toolsDir, "node_modules/.bin/tsx");
  // `--only=` with a value the tool refuses (exit 2, before its dev server starts) is the fence: if the no-op ever stops
  // leaving first, the child dies at that refusal instead of booting a server and a browser inside a unit test.
  const run = (args: string[]) => {
    const env = { ...process.env };
    delete env.UI_SHOTS_PORT;
    return spawnSync(
      tsx,
      [path.join(here, "shoot.ts"), ...args, "--only=__fence__", "--port=5291"],
      {
        cwd: toolsDir,
        encoding: "utf8",
        env,
        timeout: 60_000,
      },
    );
  };

  it("exits 0 with one clear line while no locale ships besides en", () => {
    const child = run(["--lang=all"]);
    const lines = child.stdout.trim().split("\n");
    if (LOCALES.every((l) => l.id === "en")) {
      expect(child.status, child.stderr).toBe(0);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(
        /^\[ui-shots\] --lang=all: .*nothing to photograph$/,
      );
    } else {
      // A locale has shipped: --lang=all now has work, so the child gets as far as the fence and stops there.
      expect(child.status).toBe(2);
      expect(child.stderr).toContain('--only="__fence__"');
    }
  }, 60_000);

  it("refuses an unshipped --lang id with exit 2 before claiming a port", () => {
    const child = run(["--lang=xx-unshipped"]);
    expect(child.status).toBe(2);
    expect(child.stderr).toContain("not a shipped locale");
  }, 60_000);
});
