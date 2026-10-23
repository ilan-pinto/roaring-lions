# Meshy prompt -- `strike_jet`, the air strike's fly-over jet (GH-748)

Sent 2026-10-22 after the lead approved the barrage-fx proposal on GH-748 ("a new fixed-wing
jet from Meshy (35 credits planned, 55 at most, no markings)"). Written by an Opus agent at
high effort, per the lead's rule for Meshy prompts. AI-generated (Meshy), disclosed per
`CONTRIBUTING.md`; the files and their provenance are in `docs/ASSET_PROVENANCE.md`, section
GH-748. The credits are in `art/meshy/ledger.jsonl`.

Presentation only: the jet is not a unit. It has no unit JSON, no roster entry and no clips.
It is a rigid mesh moved by code over the map for about four seconds.

| item | number | source |
|---|---|---|
| class | textured vehicle path, **35** credits: preview 20 + refine 2k 10 + remesh 5; **no re-roll**, 20 of the 55 unspent | ledger `strike_jet`: preview `01a16471-cc98-7661-9529-ef31a1dbf1b4`, refine `01a16474-014f-7769-8751-cadeadc5fcaf`, remesh `01a16476-0ba2-7098-81b1-297eb7ac21b9` |
| settings | `meshy-6`, `standard`, triangle topology, preview `--polycount` 30,000, remesh target **15,000** (arrived 14,830 faces with the bake) | `art/meshy/strike-jet-20261022-01a1647{1,6}/task.json` |
| drawn size | **10.5 x 7.5 x 2.4 GLB units** (length, span, height; 3 units a tile), the lead's box: 1.2x the Lavi's bounding box, about 125 px long at zoom 1 | proposal, GH-748 |
| triangles | at most 15,000; **10,154** shipped | exporter |
| markings | none: no insignia, roundels, flags, numbers or text (the fictional Kedem layer) | GH-748 |

```
A single low-poly game-ready single-seat multirole strike jet of a fictional air force, landing gear retracted. A slim pointed nose, one bubble canopy far forward, a long fuselage blended smoothly into wide clipped-delta wings with sharply swept leading edges, an air intake under the cockpit, one round engine nozzle at the tail, two vertical tail fins canted outward, two small swept tailplanes. One large bomb under each wing on a short pylon. Real-world scale, 15 metres long, 10.7 metre wingspan. Matte grey desert camouflage of pale sand-grey and medium grey patches, dark tinted canopy, gunmetal nozzle. Plain even lighting, no baked shadows, no ground, no base, no plinth, centred, one object, facing forward. No insignia, roundels, stars, flags, numbers, text or markings of any kind.
```

793 characters. `--negative "landing gear, wheels, single vertical tail fin, propeller, rotor,
missiles, rockets, external fuel tanks, drop tanks, pilot figure, people, ground, base, stand,
text, letters, numbers, insignia, roundels, star, flag, decals, stripes, tail code"`.

Why it reads this way. The template is the house one (the Yanshuf's, section 27 of
`meshy-prompts-units.md`): features, not adjectives, and no real type named. The draft brief's
"F-16-like layout" became the features that make it: a slim nose, a bubble canopy far
forward, a fuselage blended into clipped-delta wings, a chin intake and one nozzle. "Twin
canted fins" stayed, because the lead approved it and the brief's own layout carries it. "Real-world scale, 15 metres long,
10.7 metre wingspan" gives Meshy the lead's 10.5 : 7.5 proportion (1.4) at a real fighter's
size. "Landing gear retracted" is there because the jet is only ever seen flying. "Readable
from a high three-quarter view" was dropped as an adjective, not a feature.

What the preview did NOT deliver, so the exporter does (`tools/vehicles/export_meshy_strike_jet.py`):

- **Landing gear down** (nose and both mains), although the prompt and the negative prompt
  both ruled it out. Cut in Blender.
- **Eight stores** (four under each wing, the outermost on the tip rail) where the brief asked
  for two bombs. The three outboard stores and the tip rail on each wing are cut. The inboard
  pair, the largest, stays as the two bombs. They are slender finned stores, and they read as
  bombs at gameplay size.
- **Twin engines** (two nozzles) where the prompt asked for one. Left as delivered: it is
  under the tail, and it is consistent with the twin fins.
- **Proportions 1.895 : 1.586 : 0.47** against the lead's 10.5 : 7.5 : 2.4. Scaled per axis
  to the box: the span is 0.853 of the length factor and the height 0.930.
- **Markings painted by the refine** although both prompts forbade them: a grey disc that reads
  as a roundel and a white stencil panel on the left flank, a "01" on the right flank, and
  stencils and text on the nose and spine. Fifteen marks were scrubbed in the bake (14,616
  texels, 0.348%). Each was repainted from the nearest sample in a ring around it, so the
  camouflage carries through. The first pass filled each mark with one median colour, and on
  the spine that drew two flat discs that read as roundels themselves.

The preview was judged usable rather than re-rolled: it is a jet with the brief's layout, and
both deviations are underside geometry that Blender cuts. A re-roll would have spent 20
credits on a model that would likely ignore the same negative prompt.
