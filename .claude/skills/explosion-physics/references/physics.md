# Explosion physics for game VFX: scaling, shock, fireball, fragments, craters, dust, buildings

Reference notes for a Claude skill that helps game developers make RTS explosions look physically
right. Scope: **effects and scaling only** (how big, how bright, how long, what flies where, what a
building does). Nothing here concerns making, improving, placing or initiating explosives.

Conventions used throughout:

- `W` is the charge mass in **kg of TNT equivalent**, `R` is distance in **m**, `Z = R / W^(1/3)` in
  **m/kg^(1/3)**.
- Pressures are **overpressures** above ambient (`P0 = 101.325 kPa`, `c0 = 340 m/s`, sea level). 1 psi =
  6.895 kPa.
- Every number carries a source tag `[Sn]` resolving to the Sources list at the end. **[derived]** means I
  computed it from a sourced formula (the script is described in section 0). **[estimate]** means I could
  not find a source and the number is my judgement; treat it as such.

## Contents

0. [How the numbers were computed](#0-how-the-numbers-were-computed)
1. [Scaling laws](#1-scaling-laws)
2. [The shock wave](#2-the-shock-wave)
3. [The fireball](#3-the-fireball)
4. [Fragments and debris](#4-fragments-and-debris)
5. [Craters](#5-craters)
6. [Dust and smoke](#6-dust-and-smoke)
7. [Building response](#7-building-response)
8. [Sources](#sources)

---

## 0. How the numbers were computed

The worked numbers come from a small Python script (kept in the research session's scratchpad, not
shipped) that implements:

- the Kinney-Graham free-air overpressure fit (section 2.1) [S2];
- Brode's fit as a cross-check [S2];
- the Rankine-Hugoniot shock relations from Glasstone & Dolan §3.55-3.56 [S4];
- arrival time by integrating `dt = dR / U(R)` outward from the charge surface [derived];
- a surface-burst factor of 1.8 on `W` [S3].

Where those agree with an independent published number, that is stated (section 2.3). Where they do not,
the spread is given and explained.

---

## 1. Scaling laws

### 1.1 Hopkinson-Cranz (cube-root) scaling

Two charges of the same explosive and shape, in the same atmosphere, produce **the same overpressure at
the same scaled distance**:

```
Z = R / W^(1/3)        (m / kg^(1/3))
```

Times (arrival, positive-phase duration) and impulses scale the same way, by `W^(1/3)`
(Glasstone & Dolan §3.63, §3.76-3.77) [S4]:

```
t(W, R)  = W^(1/3) · t1(Z)          I(W, R) = W^(1/3) · I1(Z)
```

**Worked example.** For a 1 kg free-air burst, 1 psi (6.9 kPa) arrives at `Z ≈ 13.4`, so `R ≈ 13.4 m`
[derived from S2]. For 8 kg (twice the cube root), the 1 psi radius doubles to about 27 m, and the
positive phase lasts twice as long. **A charge 1,000 times heavier only reaches 10 times farther.** That
is the single most important rule for sizing explosions in a game: visual reach should grow with the
cube root of the payload, never linearly.

Limits. Cube-root scaling assumes geometric similarity and ignores gravity. Crater sizes at large charges
drift below the 1/3 exponent (gravity), and cloud rise follows `W^0.25` (buoyancy), both covered below
[S7, S8].

### 1.2 TNT equivalence

A charge of explosive X is converted to an equivalent TNT mass by a relative-effectiveness (RE) factor.
The TNT-equivalent energy unit is fixed by convention at 4.184 MJ/kg [S5].

| Explosive | RE factor (Wikipedia table) [S5] | Notes |
|---|---|---|
| TNT | 1.00 | reference |
| Composition B (60/40 RDX/TNT) | 1.33 | published range **1.10-1.36**, 1.32 most cited [S39] |
| RDX | 1.60 | |
| HMX | 1.70 | |
| PETN | 1.66 | |
| Composition C-4 | 1.34 | |
| Octol (80/20 HMX/TNT) | 1.54 | |
| Tritonal (80 TNT / 20 Al) | 1.05 | aluminium burns late, so it raises impulse and fireball more than peak pressure [estimate: qualitative] |
| ANFO | 0.74 | |

**Why sources disagree.** "A single RE factor cannot be calculated", because it depends on whether you
match peak pressure or impulse, and on the distance of the gauges [S5]. DTIC equivalence studies report
different factors for pressure and for impulse, varying with scaled distance [S40]. The UFC 3-340-02
method sets equivalence by heat of detonation [S39]. For game VFX the spread (about ±15%) moves a radius
by only ±5% (the cube root), so pick one factor and move on.

### 1.3 Surface burst versus free-air burst

A charge on the ground drives a hemispherical shock. The ground reflects what would have gone downward,
so a surface burst behaves like a free-air burst of a larger charge:

```
W_effective = f · W,   f ≈ 1.8 for soil (2.0 for a perfectly rigid surface, ~1.6 over water)
```

The 1.8 for soil accounts for the reflected hemisphere minus energy lost to cratering and ground shock;
1.6 was found over water at the Pacific nuclear tests [S3]. An equivalent framing uses `2η`, with `η` from
0.55 (water) to 1 (steel) [S2]. Effect on radii: `1.8^(1/3) = 1.22`, so **a surface burst reaches about
22% farther than the same charge in free air** [derived].

---

## 2. The shock wave

### 2.1 Peak overpressure versus scaled distance

**Kinney & Graham (1985), free air, chemical explosive** (reproduced in [S2]; the KNS comparison in [S42]
uses the same form):

```
Ps / P0 = 808 · [1 + (Z/4.5)^2] / sqrt( [1 + (Z/0.048)^2] · [1 + (Z/0.32)^2] · [1 + (Z/1.35)^2] )
```

**Brode (1955), free air, Ps in MPa** [S2]:

```
Ps = 0.67 / Z^3 + 0.1                                  (Ps > 1 MPa)
Ps = 0.0975/Z + 0.1455/Z^2 + 0.585/Z^3 - 0.0019       (0.01 <= Ps <= 1 MPa)
```

(The same fit appears elsewhere in bar, atm or at, and one source prints 1.445 for 1.455; the unit
ambiguity is documented in [S38]. The MPa form above is the one in [S2].)

**Kingery-Bulmash (1984)** is the standard behind UFC 3-340-02 and ConWep. It is a polynomial in `log Z`,
valid to `Z ≤ 40` [S2]. Swisdak's 1994 simplification reproduces it within 1% [S43]. I could not open
either primary document in this session (DTIC and WBDG refused the fetch), so the KB curve itself is not
tabulated here; Kinney-Graham is used instead and checked against a KB-derived DoD number in section 2.3.

**Worked values, free air, computed** [derived from S2]:

| Z (m/kg^1/3) | Kinney-Graham (kPa) | Brode (kPa) | Shock speed U (m/s) |
|---|---|---|---|
| 1 | 1009 | 826 | 1050 |
| 2 | 208 | 156 | 565 |
| 3 | 82 | 68 | 443 |
| 5 | 29 | 28 | 380 |
| 10 | 10.0 | 9.9 | 354 |
| 20 | 4.4 | 3.4 | 346 |
| 30 | 2.9 | 1.5 | 344 |

The two fits agree within about 5% between Z = 3 and 10, which is where VFX-relevant thresholds live.
They split near the charge (Z < 1, where Brode is known to be conservative [S2]) and far out (Z > 20).

**Scaled distance of the classic thresholds** [derived from S2]:

| Overpressure | Z free air (KG) | Z free air (Brode) | Z surface burst (KG, ×1.8^1/3) |
|---|---|---|---|
| 0.15 psi (1.0 kPa) | 81 | 35 | 99 |
| 0.5 psi (3.4 kPa) | 25 | 20 | 30 |
| 1 psi (6.9 kPa) | 13.4 | 12.8 | 16.4 |
| 2 psi (13.8 kPa) | 7.9 | 8.0 | 9.6 |
| 3 psi (20.7 kPa) | 6.1 | 6.1 | 7.4 |
| 5 psi (34.5 kPa) | 4.6 | 4.4 | 5.6 |
| 10 psi (69 kPa) | 3.2 | 3.0 | 4.0 |
| 20 psi (138 kPa) | 2.4 | 2.1 | 2.9 |

Far-field values (0.15 psi) differ by a factor of two between fits: glass-breakage radii are genuinely
uncertain, and also depend on the glass. Do not trust any formula beyond Z ≈ 40.

### 2.2 Rankine-Hugoniot: shock speed, wind and dynamic pressure

For air (γ = 1.4), Glasstone & Dolan §3.55-3.56 [S4]:

```
shock front speed        U   = c0 · sqrt(1 + 6p / 7P0)
wind (particle) speed    u   = c0 · (5p / 7P0) / sqrt(1 + 6p / 7P0)
dynamic pressure         q   = (5/2) · p^2 / (7P0 + p)
reflected (normal)       p_r = 2p · (7P0 + 4p) / (7P0 + p)        -> 2p (weak) ... 8p (strong)
```

The same `U` relation is the one Díaz & Rigby use to derive shock Mach number versus scaled distance
[S3].

### 2.3 A check against a published DoD number

DoD 6055.09-M separates inhabited buildings at `D = K · W^(1/3)` (ft, lb), with K = 40 giving **1.2 psi**
and K = 50 giving **0.9 psi** (hemispherical surface burst) [S10]. K40 is 15.9 m/kg^(1/3). Kinney-Graham
with the 1.8 ground factor gives 1.04 psi there, and 0.80 psi at K50 [derived]. So **KG + 1.8 reads about
15% lower than the Kingery-Bulmash-based DoD values at 1 psi**. The KNS comparison shows the same spread:
the 6.9 kPa distance is Z = 13.44 by Kinney-Graham against 18.07 by UFC 3-340-02 [S42]. For visuals, this
is noise. For anything a player must trust (a damage ring), the sim's own number wins, not either fit.

### 2.4 The Friedlander waveform, duration and impulse

The pressure at a fixed point jumps to `Ps`, decays, goes slightly negative, and recovers. The
**modified Friedlander** form [S35]:

```
p(t) = Ps · (1 - t/td) · exp(-b · t/td)          0 <= t <= td (positive phase)
```

`b` is the waveform (decay) parameter. Rigby et al. recommend fitting `b` so that the integral matches
the measured impulse, rather than using a correlation [S35]. One correlation, Teich & Gebbeken, gives
`b ≈ 1.5 · Z^-0.38` for roughly 0.1 < Z < 30 (the range limits were garbled in the copy I saw; treat it as
indicative) [S35]. Integrating:

```
I+ = Ps · td · [1/b - (1 - e^-b) / b^2]          (b -> 0 gives the triangle Ps·td/2) [derived]
```

**Kinney-Graham duration and impulse fits.** I could not open a copy of Kinney & Graham to verify these
two fits, so they are **transcribed from the standard text from memory, and flagged**:

```
td / W^(1/3)  [ms]      = 980 [1 + (Z/0.54)^10] / ( [1 + (Z/0.02)^3] [1 + (Z/0.74)^6] sqrt(1 + (Z/6.9)^2) )
I  / W^(1/3)  [bar·ms]  = 0.067 sqrt(1 + (Z/0.23)^4) / ( Z^2 · (1 + (Z/1.55)^3)^(1/3) )
```

Sanity check: they give `td ≈ 2.5 ms·kg^-1/3` and `I ≈ 39 kPa·ms·kg^-1/3` at Z = 5, which is the right
order for free-air TNT [estimate]. The duration fit misbehaves below Z ≈ 0.7 (it dips); do not use it
there. The scaling law itself (duration ∝ W^(1/3) at fixed Z) is solid [S4].

**What this means visually.** For a 155 mm shell on the ground (6.86 kg TNT, see
`munitions-table.md`), the positive phase at 7 m lasts about **4 ms**, and at 31 m (1 psi) about **9 ms** [derived]. The
load is over before a 60 fps frame (16.7 ms) ends. Nothing "pushes" for long: what lasts is the wind of
the hot product gases and the dust they carry (section 2.6).

### 2.5 How fast the front moves (near and far)

Near the charge the front is supersonic and decelerating; far out it relaxes to the speed of sound. A
155 mm surface burst, computed by integrating `U(p(R))` [derived from S2, S4, S3]:

| Distance | Arrival | Overpressure | Front speed U | Wind u | Positive phase |
|---|---|---|---|---|---|
| 3.6 m | 2.7 ms | 54 psi (372 kPa) | 690 m/s | 440 m/s | 2 ms |
| 7.2 m | 9.7 ms | 11 psi (76 kPa) | 440 m/s | 140 m/s | 4 ms |
| 10.6 m | 18 ms | 5 psi (34 kPa) | 390 m/s | 72 m/s | 5 ms |
| 20 m | 44 ms | 1.8 psi | 357 m/s | 28 m/s | 8 ms |
| 31 m | 75 ms | 1.0 psi | 350 m/s | 16 m/s | 9 ms |
| 100 m | 275 ms | 0.3 psi | 343 m/s | 5 m/s | 10 ms |

For a 1 kg free-air charge: 0.5 ms to 1 m, 1.9 ms to 2 m, 8.9 ms to 5 m, 23 ms to 10 m, 51 ms to 20 m
[derived]. Scale times by `W^(1/3)` at the matching scaled distance.

Near the ground a reflected wave overtakes the incident one and merges into a single **Mach stem**, whose
height grows with distance (Glasstone §3.25-3.26) [S4]. For a surface burst the whole front is already a
hemisphere hugging the ground, which is why it is modelled with the 1.8 factor.

### 2.6 What is actually visible of the shock

The shock is a pressure jump in clear air. It is **invisible to the eye**, except through:

1. **A refraction shimmer.** The density jump (ratio `(7 + 6p/P0)/(7 + p/P0)`, [S4]) bends light. In
   sunlight against a textured background it reads as a thin moving distortion ring. It crosses the
   5 psi radius of a 155 in about 18 ms, a single frame at 60 fps [derived].
2. **A condensation (Wilson) cloud.** In humid air, the rarefaction behind the front cools air below its
   dew point and a short-lived cloud forms, then evaporates as pressure recovers. It is documented for
   large chemical events (Operation Sailor Hat, about 500 t of TNT; Beirut 2020), not typically for
   single shells [S27]. Use it for big bombs in humid maps only.
3. **Dust lifted from the ground.** This is the visible "ring" of most battlefield blasts. Note what the
   numbers say: at the 5 psi radius of a 155 the wind is about 70 m/s, but it lasts about 5 ms, so it
   moves air by only some 0.2-0.3 m [derived: u × td / 2]. The **shock lifts dust; it does not carry it
   far.** What spreads the dust skirt outward over the next few hundred milliseconds is the outflow of
   product gas and entrained air, which decelerates quickly [estimate: mechanism; no measured skirt
   speed found]. A dust skirt that grows over 0.2-0.5 s to about the 5 psi radius and stops is therefore
   physically defensible; a skirt that keeps racing out at shock speed is not.

---

## 3. The fireball

### 3.1 Size

The fireball of a high explosive is the hot detonation products plus the afterburn of unburnt fuel
(carbon, CO, H2) as it mixes with air. TNT is strongly oxygen-negative (oxygen balance −74%) [S32], so
much of its energy is released late, in air: complete combustion of the detonation products would add
about 233% to TNT's energy, against 70% for PBX-9501 [S1].

Published cube-root fits, all collected in Price (2005, Los Alamos) [S1]:

| Fit | Formula as published | Metric form (W kg TNT, D m) [derived] | D for 1 kg |
|---|---|---|---|
| Cooper (from a constant fireball scaled distance) | `D = 8.13 W^(1/3)` (ft, lb) | `D ≈ 3.2 W^(1/3)` | 3.2 m |
| UK HSE (propellant data, TNT-equivalent) | `D = 8.5 W^0.341` (ft, lb) | `D ≈ 3.4 W^0.341` | 3.4 m |
| Price, theoretical, complete afterburn | `D = 9.21 W^(1/3)` (ft, lb) | `D ≈ 3.6 W^(1/3)` | 3.6 m |
| A secondary Italian ordnance source | `D = 3 W^0.3` (m, kg) [S44] | same | 3.0 m |

The theoretical value is the largest because real combustion never completes before the products are
diluted [S1]. **Use `D ≈ 3.2-3.4 · W^(1/3)` m for a TNT-like charge in open air**, and smaller for
oxygen-balanced explosives (PBX-9501's theoretical constant is about 27% below TNT's [S1]).

### 3.2 Duration and growth

- Baker et al.'s form `D = a M^(1/3)`, `t = b M^(1/3)`; using HSE's "munitions" constants, Price obtains
  `t = 0.20 · M^0.35` (s, M in kg) [S1]. This is a **theoretical, unconfined, upper-bound** duration.
- Measured: in Price's JCAT tests a 5 lb (2.3 kg) charge's fireball lasted 50-100 ms by video, against
  0.26 s theoretical. Larger charges ran about 0.14-0.40 s by video, against 0.45-0.72 s theoretical
  (Table 11, partly confined bays) [S1]. So **real visible fireballs run about 25-60% of `0.2 M^0.35`**
  [derived from S1].
- Growth: high-speed video shows the fireball growing directly behind the shock at first, then
  separating from it, reaching a maximum size while the shock runs on [S1]. For a kg-scale charge, the
  maximum fireball radius (about 1.6 m) is reached when the shock is only a little beyond it, which from
  section 2.5 is **a few milliseconds** [derived; estimate of the exact moment].
- Brightness peaks late: for kg-scale TNT and nitromethane charges the radiant intensity peaks "after tens
  of milliseconds" (Goroshin et al., 2006, three-colour pyrometry) [S28], as the afterburn develops.

### 3.3 Brightness and colour over time

| Phase | Time (kg-scale charge) | What it looks like | Source |
|---|---|---|---|
| Detonation flash | well under 1 ms | white, very bright, tiny (the charge and casing) | [estimate] |
| Product expansion | 0-5 ms | fireball pops to near full size behind the shock | [S1], [derived] |
| Afterburn | ~10-100+ ms | yellow-orange turbulent ball; radiant peak after tens of ms | [S28] |
| Soot-laden fireball | ~100-400 ms | orange fading to dull red, with black soot from oxygen-negative fills | [S1], [S32] |
| Smoke | 0.3 s onward | dark grey-black (TNT), lighter for oxygen-balanced fills, plus soil dust | [estimate] |

Temperatures reported for HE fireballs: about **1,980 K** for the surface of a C-4 fireball after its
initial rise, and burning soot at about **1,900 K** in nitromethane fireballs, with gas temperatures of
about 1,100 K hundreds of milliseconds later. These came from search abstracts of OSTI reports I could not
open in full, so treat them as indicative [S28]. A blackbody near 1,900-2,000 K reads orange-yellow, which
matches the usual footage. The initial flash is hotter; I found no measured value for TNT [estimate:
roughly 3,000-4,000 K, white].

Aluminised fills (tritonal, H-6) burn the aluminium in air, which brightens and lengthens the afterburn
[estimate: qualitative; no measured comparison found]. Price notes that under-oxidised explosives give
the largest fireballs [S1].

### 3.4 The rise of the hot cloud

After the fireball cools, the hot product cloud is buoyant and rises as a thermal, dragging dust and soot
with it. The rise height is covered with the dust cloud in section 6.2.

---

## 4. Fragments and debris

### 4.1 Initial fragment speed: Gurney

For a cylinder of explosive mass `C` in a metal case of mass `M` [S12]:

```
cylinder:  V = sqrt(2E) · (M/C + 1/2)^(-1/2)
sphere:    V = sqrt(2E) · (M/C + 3/5)^(-1/2)
```

Gurney constants `sqrt(2E)`: TNT 2.44 km/s, Composition B 2.70, RDX 2.83 (one table). A Sandia/OSTI deck
gives TNT 2.37, Comp B 2.71, RDX 2.93 [S12]. The model ignores rarefaction in the gases and so
**over-predicts** speed, particularly for light cases [S12].

Worked (case masses are my estimates, removing fuze and rotating band):

| Item | C | M (estimate) | M/C | Gurney V [derived] |
|---|---|---|---|---|
| 155 mm M107 | 6.86 kg TNT | ~34 kg | ~5 | ~1.0 km/s |
| Mk 82 | 87 kg tritonal | ~134 kg | ~1.5 | ~1.7 km/s (TNT constant used) |
| Mk 84 | 429 kg tritonal | ~436 kg | ~1.0 | ~2.0 km/s (TNT constant used) |
| M67 grenade (sphere) | 0.18 kg Comp B | ~0.15 kg | ~0.8 | ~2.3 km/s (upper bound) |

Totals from [S18]; case masses are [estimate]. **Fragments leave at roughly 1-2 km/s, Mach 3-6.** At game
scale that is a tile (3 m) in about 2 ms: they are never seen in flight, only as sparks, puffs where they
strike, and holes.

### 4.2 Fragment sizes: Mott (descriptive only)

Mott and Linfoot's 1943 model for a fragmenting cylinder, still the most common way to represent such
data [S13]:

```
N(> m) = N0 · exp( -(m/μ)^(1/2) )
```

`N(> m)` is the number of fragments heavier than `m`; `μ` is a characteristic mass, described as about
half the mean fragment mass [S13] (so `N0 ≈ M / 2μ`, [derived]). Generalised forms replace the 1/2 power
with a parameter; Grady-Kipp's linear exponential suits less complete break-up [S13].

**Shape of the distribution, for VFX:** very many small fragments, few large ones. With the 1/2 power,
fragments heavier than `4μ` are `e^-2 ≈ 14%` of the count, heavier than `9μ` are 5%, heavier than `16μ`
are 2% [derived]. The M107 shell is described as producing about **1,950 fragments** [S18]; with about
34 kg of steel that is a mean near 17 g [derived, estimate: real counts include many uncounted
fines].

### 4.3 Velocity decay with drag

With a drag coefficient `Cd`, presented area `A` and mass `m`, at constant `Cd`:

```
v(x) = v0 · exp(-x / L),       L = 2m / (ρ_air · Cd · A)          [derived, standard drag law]
```

For a compact steel chunk, the mean presented area of a cube of side `s` is `1.5 s^2` (a quarter of its
surface) [derived]. With `Cd ≈ 1.0` [estimate] and air at 1.225 kg/m³:

| Fragment | L (m) | Speed after 100 m, from 1,000 m/s |
|---|---|---|
| 0.5 g | ~34 | ~50 m/s |
| 2 g | ~54 | ~160 m/s |
| 10 g | ~93 | ~340 m/s |
| 50 g | ~160 | ~530 m/s |
| 500 g | ~340 | ~750 m/s |

Small fragments are stopped by the air within tens of metres; heavy pieces carry hundreds of metres. That
is why hazard distances are set by the few large pieces.

### 4.4 Maximum fragment and debris ranges

- M67 grenade: "some fragments can travel as far as 230 m" [S18].
- Mk 84: "lethal fragmentation radius" 120 m (400 ft) [S18].
- US siting criteria: **the hazardous fragment distance (HFD) is 1,250 ft (381 m) for any explosive
  weight over 450 lb**; below that it comes from an empirical equation. HFD is the distance at which
  hazardous fragments (≥ 58 ft-lb impact energy) fall below **one per 600 ft²** [S14, S10]. The
  **maximum fragment distance** (the farthest single fragment) is a different, larger number [S14].
  Early test work found that charges between 100 and 30,000 lb "propel lethal fragments 1250 feet" [S14].

At RTS scale these distances are many screens away. A game should not try to draw them.

### 4.5 Ground ejecta (soil clods)

Soil thrown from a crater flies ballistically:

```
range = v^2 · sin(2θ) / g          apex = v^2 · sin^2(θ) / (2g)          flight = 2 v sin θ / g
```

Launch angles cluster around **45°** in the cratering literature [estimate: commonly cited value; I did
not find it stated in an accessible source this session]. Launch speed falls steeply with launch
position: in gravity-regime scaling,

```
v_ej / sqrt(g R) = K · (x / R)^(-1/μ)       (K ≈ 0.77, μ ≈ 0.46 for non-porous targets)
```

where `x` is launch radius and `R` the crater radius [S16, S17]. Ejecta velocities at similar points
scale with `sqrt(g R)`, so blankets are self-similar in crater radii [S17]. **Most ejected mass lands
within about two crater radii** as a continuous blanket [S16].

Worked, for a 155 mm crater of radius about 0.75 m [derived from S16]:

| Launch point x/R | v | Range at 45° | Apex at 45° |
|---|---|---|---|
| 1.0 (rim) | 2 m/s | 0.5 m | 0.1 m |
| 0.7 | 5 m/s | 2 m | 0.5 m |
| 0.5 | 10 m/s | 9 m | 2 m |
| 0.3 | 29 m/s | 85 m | 21 m |

So the bulk of the soil lands within a metre or two, while a small fast fraction from the crater centre
forms a column a few tens of metres high and scatters clods tens of metres out. Caveat: craters this small
are partly in the strength regime, where velocities do not scale with `sqrt(gR)` [S17]; treat the table
as the shape, not the exact numbers [estimate].

---

## 5. Craters

### 5.1 Surface bursts

- **Kinney & Graham**, from statistics of about 200 accidental above-ground explosions: apparent crater
  diameter `D = 0.8 · W^(1/3)` (m, kg), with a variation coefficient of about **30%** [S7].
- **Ambrosini, Luccioni & Danesi** (numerical, calibrated on tests): `D = 0.51 W^(1/3)` ±5% for a charge
  **lying on** the ground, `D = 0.65 W^(1/3)` ±5% when the **energy centre is at** ground level [S7].
- Test points: 1 kg → 0.58 m, 10 kg → 1.56 m, and an EMRTC test of 250 kg of TNT at ground level → a
  3.8 m crater [S7].
- **Depth is about a quarter of the diameter**, depending on soil [S7].
- Even carefully run cratering tests scatter by about 10%, and 30-40% is common [S7].

**Shells are not surface charges.** Live-fire 155 mm HE in the US DIRT tests gave mean craters of about
1.44 m diameter × 0.37 m deep (DIRT-I) and 1.73 m × 0.55 m (DIRT-II); static 155 mm detonations gave about
1.7-2.4 m × 0.4-0.57 m. Crater size grew with soil moisture and cohesiveness (small samples; trends only)
[S15]. A 155 mm (6.86 kg TNT) is predicted at 1.5 m by `0.8 W^(1/3)`, which is close [derived].

### 5.2 Buried and penetrating bursts

Cratering grows strongly with depth of burst, up to an optimum and then falls [S7]. Optimum burial for
maximum apparent radius is about **0.6-0.7 m/kg^(1/3)**: about 1.8 ft/lb^(1/3) in Alaskan silt, and about
1.6 ft/lb^(1/3) for 256 lb of TNT in desert alluvium [S40]. A delay-fuzed bomb that penetrates before it
functions gives a much larger crater than the surface formula: the Mk 84 "can form a crater 50 ft (15 m)
wide and 36 ft (11 m) deep" [S18], against about 6 m for a surface charge of its mass [derived]. That is a
factor of about 2.5 in diameter.

### 5.3 Ejecta blanket

The continuous blanket extends to about **2 crater radii** from the centre [S16] (the brief's "2-3 radii"
is consistent if the outer, discontinuous scatter is included [estimate]). Blankets are self-similar when
expressed in crater radii [S17].

### 5.4 Soil type

Wet, cohesive soil gives larger craters than dry loose soil [S15]. Rock and frozen ground give smaller,
shallower ones, and cube-root scaling holds less well there; an exponent between 1/4 and 1/3 can fit
better for larger craters in strong materials [S45]. Rough multipliers on the dry-soil diameter for game
purposes: wet clay ×1.2-1.3, sand ×1.0, rock ×0.5-0.7 [estimate].

---

## 6. Dust and smoke

### 6.1 Two populations

LLNL and Sandia separate explosion debris into **ballistic particles (> 100 µm)**, which leave the buoyant
cloud quickly, and **fine particles**, which ride the cloud up [S9]. In VFX terms: a fast dark column of
clods and grit that falls back within seconds, and a slower, lighter cloud that rises and drifts.

Settling speed of fine dust by Stokes's law, `v = ρp g d^2 / (18 μ_air)`, for soil grains (2,650 kg/m³)
[derived; Stokes law is standard]:

| Grain size | Settling speed | Time to fall 50 m |
|---|---|---|
| 100 µm | ~0.6-0.8 m/s (Stokes overestimates here) | ~1 min |
| 30 µm | ~0.07 m/s | ~12 min |
| 10 µm | ~0.008 m/s | ~1.7 h |
| 1 µm | ~0.00008 m/s | days |

**Dust hangs.** Grit falls out in a minute; the fine fraction drifts with the wind for tens of minutes to
hours, and its visible edge is set by dilution, not by settling.

### 6.2 Cloud rise height

- **Church (1969, Sandia)**: the stabilised cloud height of a chemical explosion scales with `W^0.25`:
  `H = 76 · w^0.25` m with `w` in **pounds** of TNT [S8, S9], which is **`H ≈ 92.6 · W^0.25` m with W in
  kg** [derived].
- Church is independent of atmospheric stability and **over-predicts** small charges: the Israeli Green
  Field experiments (0.25-50 kg, unstable, neutral and stable air) gave lower stabilised cloud tops for
  every stability class below 50 kg [S9]. In those series, the cloud-rise parameterisation ran to a
  `t_max` of **48 s** [S9].
- It also over-predicts very large events with water or debris in the fireball: Beirut (about 1.4 kt
  preferred yield) rose to about 1,600 m, against about 3,184 m from Church [S8].

Worked, **upper bounds** from Church [derived]: 1 kg → 93 m; 7 kg (a 155) → 150 m; 90 kg (a Mk 82) →
290 m; 450 kg (a Mk 84) → 430 m. For shells, read these as "the faint top of a thinning cloud after
30-60 s", not as a dense column.

**The visible dense column** is the ballistic phase (section 4.5): for a 155, the fast central fraction
reaches roughly 10-30 m within 1-2 s and falls back [derived from S16, estimate]. A rough game rule for that
dense early column is `H_column ≈ 10 · W^(1/3)` m [estimate: fitted by eye to the ejecta ballistics
above; I found no measured artillery dust-column heights].

### 6.3 Wind drift

Once the cloud stops rising it moves with the wind: a 5 m/s breeze carries it 300 m a minute [derived].
Fine dust keeps the shape of a widening, thinning plume downwind.

### 6.4 Colour by soil type

The dust is the dry colour of the ground it came from, lighter than the wet surface (moisture darkens
soil); the fireball adds black soot (TNT, oxygen-negative) [S32]. Rough guide [estimate: observation,
no source found]:

| Ground | Dust colour |
|---|---|
| Limestone, chalk, desert alluvium | pale buff to off-white |
| Sand | tan, yellow-brown |
| Terra rossa, laterite | red-brown |
| Dark loam, wet field | dark brown clods, little fine dust |
| Concrete and masonry (buildings) | light grey, very fine, long-lived |

---

## 7. Building response

### 7.1 Overpressure damage thresholds (side-on)

NOAA's ALOHA table, from Lees, *Loss Prevention in the Process Industries* (1980) [S6]:

| psi | kPa [derived] | Expected damage |
|---|---|---|
| 0.04 | 0.3 | loud noise (143 dB); sonic-boom glass failure |
| 0.15 | 1.0 | typical pressure for glass failure |
| 0.4 | 2.8 | limited minor structural damage |
| 0.5-1.0 | 3.4-6.9 | windows usually shattered; some frame damage |
| 0.7 | 4.8 | minor damage to house structures |
| 1.0 | 6.9 | partial demolition of houses; uninhabitable |
| 1.0-2.0 | 6.9-13.8 | corrugated metal panels fail; wood panels blown in |
| 2.0 | 13.8 | partial collapse of walls and roofs of houses |
| 2.0-3.0 | 13.8-20.7 | non-reinforced concrete or cinder-block walls shattered |
| 2.5 | 17.2 | 50% destruction of home brickwork |
| 3.0 | 20.7 | steel-frame buildings distorted and pulled from foundations |
| 5.0 | 34.5 | wooden utility poles snapped |
| 5.0-7.0 | 34.5-48 | nearly complete destruction of houses |
| 10 | 69 | probable total building destruction |

A second table, in kPa (Catovic & Kljuno 2021) [S2]: 1.0-1.5 window glass cracks; 3.4-7.6 minor damage;
7.6-12.4 metal panels deformed; 12.4-20 concrete walls damaged; over 34.5 wooden buildings demolished;
27.6-48.3 major damage to steel objects; 41.4-62.1 heavy damage to reinforced buildings; 69-82.7 probable
demolition of most buildings.

Sources disagree by a factor of 2-3 on some rows (unreinforced brick ranges from about 2.5 psi to 7-8 psi
across tables), partly because some tables give side-on pressure and some reflected [S46]. Glasstone &
Dolan give 3.5-7 kPa for typical residential window failure [S46].

**These tables come from long-duration blasts** (large accidents and nuclear tests). For small charges,
read section 7.2 before using them.

### 7.2 Pressure-impulse (P-I) diagrams

A P-I diagram is an **iso-damage curve**: every (peak pressure, impulse) pair on it gives the same damage
to one component. It splits the plane into safe and damaging regions, and has two asymptotes [S33]:

- **Impulsive regime** (load much shorter than the component's natural period `T`): damage depends on
  impulse alone. From energy balance on a single-degree-of-freedom (SDOF) model of mass `m`, stiffness
  `k`, and failure deflection `x_c`: `I^2 / 2m = k x_c^2 / 2`, so `I_crit = x_c · sqrt(k m)` [derived].
- **Quasi-static regime** (load much longer than `T`): damage depends on peak pressure alone. Equating
  work and strain energy for a step load gives `F_crit = k x_c / 2` [derived]. The response becomes
  "insensitive to impulse but very sensitive to peak pressure" [S33].
- **Dynamic regime** in between, where load shape matters [S33].

Commonly quoted boundaries (Baker et al.) are `ω·td < 0.4` impulsive and `ω·td > 40` quasi-static,
with `ω = 2π/T` [estimate: not verified against an accessible copy].

**Consequence for game-size charges.** At the 1 psi radius of a 155 the positive phase is about 9 ms
[derived]. Masonry and concrete wall panels have natural periods of order 10-50 ms [estimate], so they sit
in the impulsive or dynamic regime, where a short pulse does far less than the same peak pressure would
from a large, slow blast. **The psi tables over-predict the damage radius of small charges**; windows
(stiff, light, short periods) are the exception and do break near those pressures. Near a building,
reflection doubles or more the load on the facing wall (`p_r` in section 2.2): at 7 m from a 155 the facing
wall sees about 196 kPa reflected against 76 kPa side-on [derived].

### 7.3 Local breaching versus global collapse

- **Local response (near or contact charges): spall, breach, punching.** Spall is concrete torn off the
  far face when the compressive pulse reflects there as tension; a breach is a through-hole. Both are
  governed by the **scaled wall thickness `T / W^(1/3)`**, the variable used across spall and breach
  studies [S34]. McVay's 1988 WES report tested 40 reinforced-concrete walls and found that existing spall
  prediction methods did not predict all earlier results [S34]. Thresholds are not tabulated here
  because I could not open the primary report.
- **Global response (charges farther off): flexure of whole panels, then the frame.** A wall panel bends,
  cracks along its supports and fails as a slab. Frame damage follows from column loss.

**Which way the debris goes.** A wall loaded from outside fails **inward, away from the blast side**:
the loaded face pushes the pieces into the building and beyond. Spall leaves the far face. So from a
shooter's view, the far side of a breached wall is where the debris lands [estimate: mechanism stated
from the physics; consistent with S11's set-up, where the wall fails away from the shock tube].

**Wall debris throw (measured).** Shock-tube tests on 1.8 × 1.5 m single-leaf solid-brick walls at the
Fraunhofer EMI (reflected peaks 100 and 150 kPa, impulses about 2,000-3,000 kPa·ms; 50 kPa did not fail
the wall) [S11]:

- the **most common debris class was whole bricks** (the 2.83 kg mass class);
- fragment speeds rose with load; most acceleration came from the second pressure rise, after the wall
  had already broken up;
- mean speeds at 150 kPa were only 0.5-1 m/s above those at 100 kPa, but the 150 kPa tests included
  fragments up to about **11-12 m/s**;
- vertical launch angles were roughly normally distributed, more upward at the higher load.

An older DTIC series reported a sheetrock wall at 1.7 psi reaching about 70 mph (31 m/s) within 3 ft
[S47]. Interpret both: masonry debris leaves at **a few to tens of m/s**, so (ballistically, section
4.5) it lands **a few to tens of metres** from the wall, mostly as whole bricks and slabs [derived]. The
shock-tube loads are long, slow pulses; a close HE burst gives a shorter, sharper pulse and probably
faster, finer debris near the charge [estimate].

### 7.4 Progressive collapse

Progressive collapse is the spread of a local failure (usually lost columns) through the structure.
The Murrah Building (Oklahoma City, 1995) is the standard case: blast damage alone destroyed about **4%**
of the floor area, but blast plus progressive collapse destroyed about **42%** [S25]. The blast destroyed
or failed key columns, the transfer girder at level 3 lost support, and the floors above came down and
stacked [S25]. Lesson for a game: **the blast makes the hole; gravity makes the collapse**, and the
collapse can be ten times larger than the blast damage.

Timing [derived, free fall `t = sqrt(2h/g)`]: one 3 m storey drops in 0.78 s; a 15 m block in 1.75 s.
Real collapses are slower than free fall because each floor resists [estimate: 1.5-3x free-fall time].

### 7.5 The dust of a collapse

- Initial cloud about **twice the width** of the structure, released about **25% above its height**
  (a demolition-dust modelling rule) [S26].
- Kochi (Maradu) demolitions: the dust spread at most **100 m horizontally and 50 m high** before settling
  (regulator's figure) [S26].
- Baltimore, a 22-storey implosion: downwind PM10 peaks of 589-54,000 µg/m³; **most sites back to
  background within 15 minutes** [S26].
- Calgary (1998): the cloud travelled much farther than expected, to about 20 km [S26].
- Jordan grain silos: concentrations took 30-33 hours to return to background at most stations [S26].

So the dense, view-blocking part of a collapse cloud lasts **seconds to a minute**, a visible haze lasts
**about a quarter of an hour**, and a thin plume can travel kilometres downwind.

---

## Sources

- [S1] Price, M. A. (2005). *Effects of Cylindrical Charge Geometry and Secondary Combustion Reactions on
  the Internal Blast Loading of Reinforced Concrete Structures*. Los Alamos LA-14209-T (thesis).
  https://www.osti.gov/servlets/purl/841586 (record: https://www.osti.gov/biblio/841586). Fireball
  diameter fits (Cooper; HSE; theoretical), duration `t = 0.20 M^0.35`, Table 11, afterburn energies.
- [S2] Catovic, A. & Kljuno, E. (2021). Comparation of Analytical Models ... for Blast Wave Overpressure
  Estimation. *ASTESJ* 6(1), 748-756. https://astesj.com/publications/ASTESJ_060182.pdf. Kinney-Graham,
  Brode (MPa), Kingery-Bulmash form, 2η factor, kPa damage table.
- [S3] Díaz, J. S. & Rigby, S. E. (2022). Blast wave kinematics: theory, experiments, and applications.
  *Shock Waves*; arXiv:2110.09488. https://arxiv.org/pdf/2110.09488. Reflection factor 1.8 (soil), 1.6
  (water); Mach number of the shock front.
- [S4] Glasstone, S. & Dolan, P. J. (1977). *The Effects of Nuclear Weapons*, ch. III (§3.25-3.26 Mach
  stem; §3.55 Rankine-Hugoniot; §3.56 reflection; §3.63, §3.76-3.77 cube-root scaling of times).
  https://bkardell.com/effects-of-nuclear-math/html/chapter3.html
- [S5] Wikipedia, "TNT equivalent" (RE table; 4.184 MJ/kg; RE depends on measure).
  https://en.wikipedia.org/wiki/TNT_equivalent
- [S6] NOAA Office of Response and Restoration, ALOHA overpressure damage table (after Lees, 1980).
  https://response.restoration.noaa.gov/node/371
- [S7] Ambrosini, D., Luccioni, B. & Danesi, R. (2004). Influence of the soil properties on craters
  produced by explosions on the soil surface. *Mecánica Computacional* XXIII, 571-590.
  https://amcaonline.org.ar/ojs/index.php/mc/article/download/271/260. Kinney-Graham `D = 0.8 W^1/3`,
  0.51 and 0.65 fits, depth ≈ D/4, EMRTC 250 kg test.
- [S8] Goldstein, P. (2020). *Beirut Explosion Yield and Mushroom Cloud Height*. LLNL-TR-815803.
  https://www.osti.gov/servlets/purl/1688581. Church (1969) `H = 76 w^0.25` (lb, m); Beirut ~1,600 m vs
  3,184 m.
- [S9] Nasstrom, J. S. et al. (2011). *Radiation Dispersal Device Consequence Assessment Modeling*, RDD
  Workshop, LLNL. https://narac.llnl.gov/sites/narac/files/2024-02/LLNL-PRES-523194.pdf. Green Field
  0.25-50 kg; Church over-predicts below 50 kg; t_max 48 s; ballistic > 100 µm particles.
- [S10] Luna, A. (2018). *Protective Construction Design Roadmap*. NAVFAC EXWC, NDIA explosives safety
  seminar. https://ndia.dtic.mil/wp-content/uploads/2018/intexpsafety/Luna1Paper.pdf. DoD 6055.09-M K40
  (1.2 psi), K50 (0.9 psi), hazardous fragment ≥ 58 ft-lb, < 1 per 600 ft².
- [S11] Schneider, J., von Ramin, M., Stottmeister, A. & Stolz, A. (2019). Masonry failure and debris
  throw characteristics under dynamic blast loads. *Chem. Eng. Trans.* 77, 217-222.
  http://www.aidic.it/cet/19/77/037.pdf (DOI 10.3303/CET1977037).
- [S12] Wikipedia, "Gurney equations" (forms, constants, limitations), and the constant table and
  Sandia/OSTI alternative values as returned in search: https://en.wikipedia.org/wiki/Gurney_equations ;
  https://www.osti.gov/servlets/purl/1765626
- [S13] Mott distribution: MDPI *Materials* 16(17) 5783 (2023), "The Application of Mott's Distribution
  in the Fragmentation of Steel Coaxial Cylinders", https://mdpi.com/1996-1944/16/17/5783 (also
  https://pmc.ncbi.nlm.nih.gov/articles/PMC10488506/). Read via search abstracts only.
- [S14] Hazardous fragment distance: NDIA 2018 explosives-safety papers (Ross), as returned in search:
  https://ndia.dtic.mil/wp-content/uploads/2018/intexpsafety/Ross2Paper.pdf ; DTIC
  https://apps.dtic.mil/sti/pdfs/ADA532252.pdf. 1,250 ft above 450 lb; HFD vs MFD.
- [S15] Kennedy, B. W. (DIRT crater series), DTIC ADA111994, live-fire and static 155 mm craters, as
  returned in search (full text refused): https://apps.dtic.mil/sti/tr/pdf/ADA111994.pdf
- [S16] Luther, R. et al. (2018). EPSC2018-139 (ejecta scaling, `v/sqrt(gR) = K (x/R)^(-1/μ)`, deposits
  within two crater radii). https://meetingorganizer.copernicus.org/EPSC2018/EPSC2018-139.pdf (via
  search abstract).
- [S17] Housen, K. R., Schmidt, R. M. & Holsapple, K. A. (1983). Crater ejecta scaling laws: fundamental
  forms based on dimensional analysis. https://www.osti.gov/biblio/6268093 (via search abstract).
- [S18] Wikipedia: "M67 grenade" https://en.wikipedia.org/wiki/M67_grenade ; "Mark 82 bomb"
  https://en.wikipedia.org/wiki/Mark_82_bomb ; "Mark 84 bomb" https://en.wikipedia.org/wiki/Mark_84_bomb ;
  "M107 projectile" https://en.wikipedia.org/wiki/M107_projectile
- [S25] Murrah Building: NIST slide deck (Lew, 2002) https://www.nist.gov/document/oklahomacitylew2002pdf ;
  W. G. Corley testimony (1998) https://irp.fas.org/congress/1998_hr/h980604-corley.htm ; FEMA 277
  record https://webarchive.library.unt.edu/eot2008/20080916160402/http://www.fema.gov/rebuild/mat/mat_fema277.shtm
- [S26] Collapse dust: "The impact of a building implosion on airborne particulate matter in an urban community" (2003),
  *J. Air & Waste Manage. Assoc.*, Baltimore PM10,
  https://informahealthcare.com/doi/abs/10.1080/10473289.2003.10466275 ; Applied Science International
  dust modelling https://www.appliedscienceint.com/dust-analysis-service-featured-in-demolition-recycling-international/ ;
  Maradu (Deccan Herald) https://www.deccanherald.com/amp/story/india%2Fdust-menace-at-maradu-flats-demolition-sites-794155.html ;
  Jordan silos https://library.kab.ac.ug/Record/doaj-art-c038a6e820654937975afd68eb214f53/Description ;
  Calgary (via the Baltimore literature, search abstract).
- [S27] Wikipedia, "Condensation cloud". https://en.wikipedia.org/wiki/Condensation_cloud
- [S28] Goroshin, S. et al. (2006), three-colour pyrometry of kg-scale TNT and nitromethane fireballs,
  *Propellants, Explosives, Pyrotechnics*, DOI 10.1002/prep.200600024 (title not verified) (abstract via search,
  https://zendy.io/title/10.1002/prep.200600024). C-4 (~1,980 K) and nitromethane soot (~1,900 K) values
  from search abstracts of OSTI reports (https://www.osti.gov/servlets/purl/1905968 ,
  https://www.osti.gov/servlets/purl/1903466 , https://www.osti.gov/servlets/purl/1764346); exact
  attribution among these not verified.
- [S32] Wikipedia, "Oxygen balance" (TNT −74%). https://en.wikipedia.org/wiki/Oxygen_balance
- [S33] P-I diagrams: Li, Q. M. & Meng, H. (2002), *J. Eng. Mech.* 128(1), 87,
  https://ascelibrary.com/doi/10.1061/%28ASCE%290733-9399%282002%29128%3A1%2887%29 ; overview papers via
  search: https://www.matec-conferences.org/articles/matecconf/pdf/2018/08/matecconf_cmss2018_02016.pdf ;
  https://api.research-repository.uwa.edu.au/ws/files/1515560/11503_PID11503.pdf
- [S34] McVay, M. K. (1988). *Spall Damage of Concrete Structures*. WES TR SL-88-22, DTIC ADA199225
  (abstract via search). https://apps.dtic.mil/sti/pdfs/ADA199225.pdf
- [S35] Friedlander form and `b`: Rigby et al. (2014), *Validation of semi-empirical blast pressure
  predictions for far field explosions*, https://eprints.whiterose.ac.uk/81237/ ; Teich & Gebbeken
  correlation as cited in https://ejsei.com/EJSE/article/download/39/38 (via search).
- [S38] Rosenkiewicz (Łukasiewicz IPO), on Brode formula units:
  https://wydawnictwa.ipo.lukasiewicz.gov.pl/wp-content/uploads/2021/06/Rosenkiewicz.pdf (via search).
- [S39] Composition B TNT-equivalence range 1.10-1.36, and UFC heat-of-detonation method (via search):
  https://pmc.ncbi.nlm.nih.gov/articles/PMC12050314 ; https://eprints.whiterose.ac.uk/id/eprint/105008/1/P28-BOGOSIAN.pdf
- [S40] Equivalence varies with measure and distance: DTIC ADP005387 https://apps.dtic.mil/sti/pdfs/ADP005387.pdf ;
  crater optimum burial: CRREL Alaska frozen/unfrozen silt (ADA084702)
  https://openpolar.no/Record/ftdtic:ADA084702 and desert alluvium 256 lb TNT
  https://ntrs.nasa.gov/api/citations/19710024854/downloads/19710024854.pdf (via search).
- [S42] Shin (KNS 2026 spring, 26S-347), stand-off distance comparison (KG 13.44 vs UFC 18.07 at 6.9 kPa),
  via search: https://www.kns.org/files/pre_paper/55/26S-347-신영훈.pdf
- [S43] Swisdak, M. M. (1994). *Simplified Kingery Airblast Calculations*. DTIC ADA526744 (not opened;
  403). https://apps.dtic.mil/sti/pdfs/ADA526744.pdf
- [S44] Italian ordnance note, `D = 3 W^0.3`: https://www.earmi.it/balistica/Bombe%20ed%20evacuazioni.pdf
  (via search).
- [S45] NASA (1971) cratering report: cube-root scaling weakens in strong materials,
  https://ntrs.nasa.gov/api/citations/19710024854/downloads/19710024854.pdf (via search).
- [S46] Window-damage thresholds, Glasstone 3.5-7 kPa: https://arxiv.org/pdf/1802.07299 ; brick-wall
  spreads (Crowl & Louvar tables) via https://ejournal.undip.ac.id/index.php/reaktor/article/downloadSuppFile/82563/24814
- [S47] DTIC wall-debris test report (sheetrock at 1.7 psi, 70 mph at 3 ft), via search:
  https://apps.dtic.mil/sti/pdfs/ADA014957.pdf
- Not opened (403 or not reachable this session, cited for orientation only): UFC 3-340-02
  https://www.wbdg.org/dod/ufc/ufc-3-340-02 ; Karlos & Solomos, JRC EUR 26456 (2013)
  https://publications.jrc.ec.europa.eu/repository/handle/JRC87200 ; Kinney & Graham, *Explosive Shocks in
  Air* (Springer, 1985) https://link.springer.com/chapter/10.1007/978-3-642-86682-1_8 .
