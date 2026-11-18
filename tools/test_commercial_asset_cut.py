"""Guards tools/commercial_asset_cut.py (GH-1415 part c, report only).

Run: python3 tools/test_commercial_asset_cut.py
Exits non-zero on failure. Dependency-free: every case but the last builds a
register, a file list and two manifests as literals here, so the expected
answers are literals too and nothing is read from the code under test. The
last case runs the real records and checks one invariant (every file the
audio gate leaves out is in the cut), not a count that moves with each
clearance.
"""
import importlib.util
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


def load():
    spec = importlib.util.spec_from_file_location("commercial_asset_cut", os.path.join(HERE, "commercial_asset_cut.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


HEADER = "| Files | What it is | Made from | Tool | AI-generated | Rights | Record |\n|---|---|---|---|---|---|---|\n"
REGISTER = (
    "intro\n<!-- register:start -->\nprose\n\n" + HEADER +
    "| `assets/audio/voice/x_01a.{ogg,m4a}` | voice | ElevenLabs | ElevenLabs | Yes | Declared `LicenseRef-owned`; ElevenLabs commercial licence NOT confirmed (D5, item 2) | r |\n"
    "| `assets/audio/music/theme.mp3` | theme | a generator | ? | Yes | Declared CC-BY-4.0; generator terms unrecorded (item 3) | r |\n"
    "| `assets/audio/music/theme_calm.ogg` | a slice of the theme | recut | ffmpeg | Yes | Declared CC-BY-4.0, as the theme; **inherits the theme's open question (item 3)** | r |\n"
    "| `assets/audio/sfx/boom_01.ogg`<br>`assets/audio/sfx/only_audio_01.ogg` | boom | ElevenLabs SFX | ElevenLabs | Yes | Declared `LicenseRef-owned`; commercial use cleared: paid plan (item 2) | r |\n"
    "| `art/textures/a_tile.png`<br>`assets/textures/a_tile.jpg` | tile | supplied image | Blender | Yes | ARR as claimed; image origin pending (item 7) | r |\n"
    "| `assets/ui/icon.png` | emblem | supplied | ? | Unrecorded | Unrecorded (item 5) | r |\n"
    "| `assets/brand/g.svg` | sign-in mark | brand guidelines | hand | No | Google's brand terms, NOT the project licence | r |\n"
    "\n" + HEADER +
    "| `art/meshes/tank.glb` | tank | Ledger `tank` | Meshy CLI | Yes | ARR; Meshy output owned, paid plan (item 1 closed) | r |\n"
    "| `art/meshes/bad.glb` | crate | supplied image | Meshy web export | Yes | ARR as claimed; image origin pending (item 7) | r |\n"
    "| `assets/meshes/**/*.glb` | the Draco twins | encode | glTF-Transform | Same as its source row | Same as its source row | the art rows |\n"
    "<!-- register:end -->\n"
    "| `assets/after/end.png` | outside the markers: not a row | x | x | x | Unrecorded | x |\n"
)
FILES = [
    "assets/audio/voice/x_01a.ogg", "assets/audio/voice/x_01a.m4a",
    "assets/audio/music/theme.mp3", "assets/audio/music/theme_calm.ogg",
    "assets/audio/sfx/boom_01.ogg", "assets/audio/sfx/only_audio_01.ogg",
    "art/textures/a_tile.png", "assets/textures/a_tile.jpg",
    "assets/ui/icon.png", "assets/brand/g.svg",
    "art/meshes/tank.glb", "art/meshes/bad.glb", "assets/meshes/tank.glb", "assets/meshes/bad.glb",
    "assets/stray.bin",
]
AUDIO = {
    "sets": {
        "voice": {"variants": [{"file": "voice/x_01a.ogg", "alt": "voice/x_01a.m4a", "source": "ElevenLabs, commercial licence not yet confirmed"}]},
        "boom": {"variants": [
            {"file": "sfx/boom_01.ogg", "source": "ElevenLabs SFX, paid plan"},
            {"file": "sfx/only_audio_01.ogg", "source": "licence not confirmed"},
        ]},
    },
    "music": {"tracks": [{"file": "music/theme.mp3", "source": "a generator, CC-BY-4.0"}]},
}
VIDEO = {"files": {"video/a.mp4": {"commercial": "unrecorded"}, "video/b.mp4": {"commercial": "confirmed"}}}


def main():
    mod = load()
    bad = []

    def expect(label, got, want):
        if got != want:
            bad.append(f"{label}:\n    got  {got!r}\n    want {want!r}")

    cut = mod.commercial_cut(REGISTER, FILES, AUDIO, VIDEO)
    expect("the shipped files cut", sorted(cut["excluded"]), [
        "assets/audio/music/theme.mp3",
        "assets/audio/music/theme_calm.ogg",
        "assets/audio/sfx/only_audio_01.ogg",
        "assets/audio/voice/x_01a.m4a",
        "assets/audio/voice/x_01a.ogg",
        "assets/meshes/bad.glb",
        "assets/stray.bin",
        "assets/textures/a_tile.jpg",
        "assets/ui/icon.png",
        "assets/video/a.mp4",
    ])
    expect("the art sources flagged", sorted(cut["sources"]), ["art/meshes/bad.glb", "art/textures/a_tile.png"])
    expect("the two audio records disagree", cut["disagree"], [
        ("assets/audio/music/theme.mp3", "register only"),
        ("assets/audio/music/theme_calm.ogg", "register only"),
        ("assets/audio/sfx/only_audio_01.ogg", "data/audio.json only"),
    ])
    expect("a file both records flag carries both reasons", [r.split(":")[0] for r in cut["excluded"].get("assets/audio/voice/x_01a.ogg", [])],
           ["register line 7", "data/audio.json"])
    expect("a twin takes its source row's reason", cut["excluded"].get("assets/meshes/bad.glb"),
           ["register line 18: ARR as claimed; image origin pending (item 7)"])
    expect("a file with no row", cut["excluded"].get("assets/stray.bin"), ["register: no row covers assets/stray.bin"])
    expect("a video not confirmed", cut["excluded"].get("assets/video/a.mp4"), ['data/video.json: commercial is "unrecorded", not "confirmed"'])
    for kept in ("assets/brand/g.svg", "assets/audio/sfx/boom_01.ogg", "assets/meshes/tank.glb"):
        expect(f"{kept} is cleared and ships", kept in cut["excluded"], False)

    # The Rights column is found by its header, wherever it stands.
    moved = REGISTER.replace("| AI-generated | Rights | Record |", "| Rights | AI-generated | Record |").replace(
        "| Yes | Declared CC-BY-4.0; generator terms unrecorded (item 3) | r |", "| Declared CC-BY-4.0; generator terms unrecorded (item 3) | Yes | r |")
    moved = moved.replace("| Yes | ARR as claimed; image origin pending (item 7) | r |\n| `assets/ui", "| ARR as claimed; image origin pending (item 7) | Yes | r |\n| `assets/ui")
    moved_cut = mod.commercial_cut(moved, FILES, {}, {})
    expect("a reordered table: the theme still cut", "assets/audio/music/theme.mp3" in moved_cut["excluded"], True)
    expect("a reordered table: the tile still cut", "assets/textures/a_tile.jpg" in moved_cut["excluded"], True)

    # Nothing flagged, nothing cut: a clean register and empty manifests.
    clean = "<!-- register:start -->\n" + HEADER + "| `assets/a.png` | a | b | c | No | ARR, project original | r |\n<!-- register:end -->\n"
    expect("a clean record cuts nothing", mod.commercial_cut(clean, ["assets/a.png"], {}, {"files": {}}), {"excluded": {}, "sources": {}, "disagree": []})

    try:
        mod.commercial_cut("no markers here", FILES, {}, {})
        bad.append("a register with no markers was read")
    except ValueError:
        pass

    with tempfile.TemporaryDirectory() as d:
        os.makedirs(os.path.join(d, "audio", "voice"))
        with open(os.path.join(d, "audio", "voice", "x_01a.ogg"), "wb") as fh:
            fh.write(b"12345")
        expect("in_dist maps assets/x to DIR/x", mod.in_dist(["assets/audio/voice/x_01a.ogg", "assets/ui/icon.png"], d),
               {"assets/audio/voice/x_01a.ogg": 5, "assets/ui/icon.png": None})

    # The real records: every file the audio gate leaves out is in the cut.
    root = mod.register_mod.repo_root()
    real_audio = json.load(open(os.path.join(root, "data/audio.json"), encoding="utf-8"))
    real = mod.commercial_cut(
        open(os.path.join(root, "docs/ASSET_PROVENANCE.md"), encoding="utf-8").read(),
        mod.register_mod.tracked(root, ["art", "assets"]),
        real_audio,
        json.load(open(os.path.join(root, "data/video.json"), encoding="utf-8")),
    )
    gate = {"assets/audio/" + f for f in mod.audio_mod.commercial_manifest(real_audio)[1]}
    expect("the audio gate's files are all cut", sorted(gate - set(real["excluded"])), [])

    if bad:
        print("test_commercial_asset_cut: FAIL\n  " + "\n  ".join(bad))
        return 1
    print("test_commercial_asset_cut: all cases pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
