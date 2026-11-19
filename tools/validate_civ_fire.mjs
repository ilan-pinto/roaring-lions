// GH-1438 E6 (docs/campaign/civilian-drama.md §10.2 E6; the lead's ruling D18, Option A): `fires_on_civilians` is an
// ENEMY placement's flag (garrison, wave unit, `spawn` trigger). The shared placement schema (`$defs/placement`) also
// carries `civilians.groups` and every `reinforce` trigger's units, so the schema alone would let a civilian or a player
// placement carry it. Refuse it there: on a player placement it would make the player's own men fire on the crowd, and
// on a civilian one it means nothing. The runtime throws on the same thing at load (`MissionRuntime.start`).
//
// Its own module because validate_data.mjs runs its whole sweep at import time and exits.

export function civFireFailures(mission, file) {
  const out = [];
  const check = (list, where) => {
    for (const p of list ?? []) {
      if (p?.fires_on_civilians !== undefined) {
        out.push(`${file}: ${where} ${p.unit} carries fires_on_civilians, which only an enemy placement takes (GH-1438 E6)`);
      }
    }
  };
  check(mission?.starting_force, 'starting_force');
  check(mission?.civilians?.groups, 'civilians.groups');
  for (const [i, t] of (mission?.triggers ?? []).entries()) {
    if (t?.do?.kind === 'reinforce') check(t.do.units, `trigger "${t.id ?? `trigger_${i}`}" reinforce`);
  }
  return out;
}
