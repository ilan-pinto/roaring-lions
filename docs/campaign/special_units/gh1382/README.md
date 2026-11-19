# GH-1382: three new Sarim units, staged (no art yet), 2026-11-19

Design: `docs/superpowers/specs/2026-11-17-sarim-roster-design.md` (§2.3 is the JSON, §2.5 the curve reading, §5 the
gates, §7 slices S2-S4). The lead approved the design on 19 Nov 2026. These three files are that section's JSON, byte
for byte in content:

| file | name | role | logistics / build s / pop |
|---|---|---|---|
| `sarim_carrier.json` | Tracked Carrier | apc (tracks; armour 130 / 70 / 45; 2 seats) | 445 / 26 / 2 |
| `hmg_team.json` | Heavy MG Team | support (`support_weapon`; tripod 12.7 mm) | 290 / 16 / 1 |
| `observer_team.json` | Observer Team | recon (14 tiles of sight, signature 0.35) | 255 / 14 / 1 |

## Why they are here and not in `data/units/enemy/`

`tools/src/mesh_roster.test.ts` fails if any `data/units` id has no GLB, and none of the three has art yet. So they are
staged (CLAUDE.md, "Adding content"): fitted on the cost curve on CI by `validate_balance.py --also
docs/campaign/special_units/gh1382` (all three of CI's staged invocations: plain, and max tier on `--branch=1` and
`--branch=2`), and guarded by `tools/src/e5_staged.test.ts` (the generic staging block and the GH-1382 block).

**Each file moves to `data/units/enemy/` in the same commit that adds its art**: the GLB under `art/meshes/`, its source,
its `mesh-catalogue.ts` entry, its portraits, and the rest of the §5 seam (registered LAST in `@lions/data`'s `units`,
the `formation-template.test.ts` row, the en.json unit catalogue, the versus pins moved once). The guard's half-landed pin
fails if an id is in both places.

## The lead's rulings (19 Nov 2026) that bind these files

- **Q3:** the carrier is the HMG Tracked Carrier: front 130, side 70, rear 45; 2 seats; 445 logistics on the curve.
- **Q4:** the HMG team and the Observer team use the shipped B3 figure.
- **Q5:** the carrier gets an L3 team mark, in the art PR.
- **Q7:** the units land UNBUYABLE. No doctrine menu names them until GH-1381's probe ruling (slice S5). The guard pins it.
- **Q9:** descriptive names.
- **Q10:** no mission places them.

They carry no `unlock`: they are priced in logistics on the curve, like every opposition unit, not bought with credits.
