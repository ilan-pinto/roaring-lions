# PA-24: First Light's dawn fill (as built)

This is the lead's ruling L3 on the #485 mock (9 Oct): fill 0.90 and sun shadow 0.70, on `beit_sahwan_breach` only. It is authored as that mission's optional `map.light` (`mission.schema.json`, checked by `validate:data`). The `dawn` preset is untouched.

[`sheet.jpg`](sheet.jpg) compares the built light with the bare dawn preset. Both are taken at the same instant:

- tick 300, with the force in the compound;
- tick 3600, mid-fight on the playtest plan's orders.

The crops are 1:1 at zoom 1, with rings and HUD off. The booted renderer reads hemisphere 0.9 and shadow 0.7. The built frames reproduce the mock's numbers for this option: shaded ground p10 59.5, highlights p90 115.5 / 116.7.

| Tick 300 / 3600 (luma) | Before | Built |
|---|---|---|
| Units in shade: contrast against the ground under them | 29.7 / 25.0 | **40.4 / 36.0** |
| In-shade unit pixels at 20 luma or more | 0.68 / 0.51 | **0.70 / 0.68** |
| Highlights p90 | 109.7 / 111.0 | 115.5 / 116.7 |

Full readings are in [`numbers.json`](numbers.json).

The darkest ground in the audit's play-22 and play-23 captures is the fog-of-war shroud, which no light setting touches.
