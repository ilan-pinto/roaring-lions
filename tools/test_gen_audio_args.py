"""Guards gen_audio.py's command line: a typo must never regenerate the library.

Run: python3 tools/test_gen_audio_args.py
Exits non-zero on failure. Dependency-free beyond gen_audio's own numpy,
matching test_dimetric.py.

Why it exists (garage uplift final review, parked item (b)): the argument loop
matched `--only=` and silently ignored everything else, so `--help` -- and a
typo such as `--onyl=ui_purchase` -- ran the FULL generator, re-encoding all
31 clips and rewriting every Ogg stream serial. Nothing here may ever reach
the encoder, so the test replaces `encode` with a tripwire and points the
output and the manifest at a scratch directory before calling `main()`: on a
broken argument loop the tripwire fires on the first clip, before a byte is
written anywhere.
"""
import contextlib
import importlib.util
import io
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


class WouldGenerate(Exception):
    pass


def load():
    spec = importlib.util.spec_from_file_location("gen_audio", os.path.join(HERE, "gen_audio.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    def tripwire(*_args, **_kwargs):
        raise WouldGenerate("the generator reached encode()")

    mod.encode = tripwire
    scratch = tempfile.mkdtemp(prefix="gen_audio_args_")
    mod.OUT = os.path.join(scratch, "audio")
    mod.MANIFEST = os.path.join(scratch, "audio.json")
    return mod, scratch


def run(mod, argv):
    """(exit code, stdout, stderr), or 'GENERATED' if it reached the encoder."""
    out, err = io.StringIO(), io.StringIO()
    saved = sys.argv
    sys.argv = ["gen_audio.py", *argv]
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                code = mod.main()
            except SystemExit as e:
                code = e.code
    except WouldGenerate:
        return "GENERATED", out.getvalue(), err.getvalue()
    finally:
        sys.argv = saved
    return code, out.getvalue(), err.getvalue()


def main():
    mod, scratch = load()
    failures = []

    def check(label, argv, want_code, want_in_out=None, want_in_err=None):
        code, out, err = run(mod, argv)
        ok = code == want_code
        if ok and want_in_out is not None:
            ok = want_in_out in out
        if ok and want_in_err is not None:
            ok = want_in_err in err
        print(f"{'ok  ' if ok else 'FAIL'} {label}: {argv} -> {code}")
        if not ok:
            failures.append(f"{label}: {argv} -> {code!r}, stdout={out!r}, stderr={err!r}")

    check("--help prints usage and exits 0", ["--help"], 0, want_in_out="usage:")
    check("-h prints usage and exits 0", ["-h"], 0, want_in_out="usage:")
    check("--help wins over anything beside it", ["--only=ui_purchase", "--help"], 0, want_in_out="usage:")
    check("a misspelt flag exits 2", ["--onyl=ui_purchase"], 2, want_in_err="unknown argument")
    check("a bare word exits 2", ["ui_purchase"], 2, want_in_err="unknown argument")
    check("--only with no '=' exits 2", ["--only", "ui_purchase"], 2, want_in_err="unknown argument")
    check("an unknown set exits 2", ["--only=not_a_set"], 2, want_in_err="unknown set")

    # Nothing may have been written there either: `main()` makes the set's
    # directory before it synthesises, so an empty scratch is a second proof.
    wrote = [os.path.join(d, f) for d, _, fs in os.walk(scratch) for f in fs]
    if wrote:
        failures.append(f"files written: {wrote}")
    shutil.rmtree(scratch, ignore_errors=True)

    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    print("gen_audio.py arguments: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
