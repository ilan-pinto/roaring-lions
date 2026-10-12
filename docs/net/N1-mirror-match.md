# N1 · The mirror match

**What it is:** two seats, two KDF forces, one map. Seat 0 commands side 0 at
the map's friendly camp, seat 1 commands side 1 at the hostile camp, and each
sees only its own fog. N1b adds the lobby; until then a room is opened by URL.

The deterministic half of the claim is a CI test, not a human run: the
`versus` block of `tools/src/net/two-client.test.ts` runs two simulated
clients on opposite sides over one frame stream for 1,000 ticks (hash-equal on
every tick, and a crafted cross-side command dropped identically on both).
This protocol is the part CI cannot see: two real windows, the real room, the
real fog and draw gate.

## Open a match

1. Window A: `/free-play/beit_sahwan_outskirts?net=new&mode=versus&callsign=A`.
   The URL rewrites to `?net=<CODE>&seat=0`.
2. Window B: `/free-play/beit_sahwan_outskirts?net=<CODE>&callsign=B`. Do not
   add `&seat`, and do not paste window A's rewritten URL: a URL that already
   carries `seat` is a reload and is refused (N0 ruling R42). The guest takes
   whatever mode the room was created with.
3. Keep both windows side by side and visible: a hidden tab stalls the room.

## What to check

- Each window sees its own force in the friendly colour at its own camp, and
  the other force only where its own units can see.
- Clicking an enemy hidden in fog selects nothing. In a versus room, enemy
  fire out of sight draws no tracer or flash; you still hear it.
- A building the enemy garrisons shows no holder badge (the house and its
  pips) while it is in fog; the badge appears once one of its tiles is in
  sight. Your own garrisons always show theirs.
- An enemy vehicle in fog leaves no trace on your screen: no tread or tyre
  prints, no dust, no idle exhaust, no damage smoke, and a helicopter no
  rotor wash. Each appears again while the vehicle is in sight.
- Hovering a garrison-capable selection over a building in fog shows the
  doorway arrow whether or not the enemy has filled it.
- Select an enemy while it is in sight, then let it walk into fog: it drops
  from your selection, and its unit card goes with it.
- At the end, before either window closes, run `__lions.net()` in both
  consoles and paste both on the N1 issue. Pass: `desyncTick: null` on both,
  and `hashOk.count` near `tickCount / 20`.
