# How combat vehicles move: dynamics, steering, suspension

Reference notes for Roaring Lions developers. Public sources only, for presentation and
gameplay realism. Every number carries a source tag `[n]` (list at the end). A number with
no public source is marked **(estimate)** and says how it was reached. Where sources
disagree, the range is given with the reason.

Game units used throughout (from the repository, see `vehicles-and-game.md` §7):
**1 tile = 3 m**, **1 sim tick = 50 ms (20 Hz)**, **1 elevation level = 0.766 m**.
Conversions: 1 m/s = 0.333 tiles/s; 10 km/h = 2.78 m/s = 0.93 tiles/s.

## Contents

1. [Vehicle dynamics](#1-vehicle-dynamics)
   - 1.1 [Acceleration](#11-acceleration)
   - 1.2 [Braking](#12-braking)
   - 1.3 [Weight transfer: nose dip, squat, settle](#13-weight-transfer-nose-dip-squat-settle)
   - 1.4 [Speed limits: road, cross-country, slope](#14-speed-limits-road-cross-country-slope)
   - 1.5 [Gradient, side slope, step, trench](#15-gradient-side-slope-step-trench)
   - 1.6 [Soft ground: ground pressure, VCI, NRMM, tracks vs wheels](#16-soft-ground-ground-pressure-vci-nrmm-tracks-vs-wheels)
2. [Steering](#2-steering)
   - 2.1 [Skid steering of tracked vehicles](#21-skid-steering-of-tracked-vehicles)
   - 2.2 [Pivot (neutral) turns](#22-pivot-neutral-turns)
   - 2.3 [Speed loss, slip, dust and spoil in turns](#23-speed-loss-slip-dust-and-spoil-in-turns)
   - 2.4 [Wheeled steering: Ackermann, multi-axle, three-point turns, reversing](#24-wheeled-steering-ackermann-multi-axle-three-point-turns-reversing)
   - 2.5 [Turret slew and stabilisation against hull motion](#25-turret-slew-and-stabilisation-against-hull-motion)
3. [Suspension and body motion](#3-suspension-and-body-motion)
   - 3.1 [Suspension types](#31-suspension-types)
   - 3.2 [Road wheel travel](#32-road-wheel-travel)
   - 3.3 [Body bounce, pitch and roll frequencies](#33-body-bounce-pitch-and-roll-frequencies)
   - 3.4 [Visual cues](#34-visual-cues)
   - 3.5 [Settling after a stop](#35-settling-after-a-stop)
4. [Sources](#sources)

---

## 1. Vehicle dynamics

### 1.1 Acceleration

**Physics.** The general framework is Wong's ([1]). Below the speed where engine power
runs out, acceleration is limited by traction. Above it, acceleration is limited by power:

```
traction-limited:  a_max ≈ g (mu - f - sin θ)
power-limited:     a(v) ≈ eta P / (delta m v) - g (f cos θ + sin θ)
```

Here `mu` is the adhesion coefficient, `f` the rolling-resistance coefficient, θ the slope,
`eta` the drive-train efficiency, and `delta` the rotating-mass factor. Milićević et al.
give `delta = 1.2 + 0.0025 i_tr²` for tracked vehicles, with `i_tr` the total gear ratio
([8], eq. 16). A heavy tracked vehicle is power-limited above walking pace, so **hp/t is the
number that orders acceleration**.

**Measured 0-32 km/h (0-20 mph) times.** These are the only published values found:

| Vehicle | Mass | hp/t | 0-32 km/h | Mean acceleration | Source |
|---|---|---|---|---|---|
| M1 Abrams (base) | 60 short t (54.4 t) | 25 hp/short ton | 7.0 s | 1.27 m/s² (0.13 g) | [2] |
| M1A1 Abrams | 63 short t (57.2 t) | 23.8 hp/short ton | 7.2 s | 1.24 m/s² | [2] |
| K2 Black Panther (MTU MT883) | ~55 t | 27.3 hp/t | 7.47 s | 1.19 m/s² | [4] |
| K2 (Doosan DV27K) | ~55 t | lower | 8.77 s | 1.01 m/s² | [4] |
| Leopard 2 "Modern" | 55-64 t | ~24-27 hp/t | 6-7 s | 1.3-1.5 m/s² | [5b] (secondary article; unconfirmed) |

GlobalSecurity's table gives 7 s for the M1 and 7.2 s for a later variant; spec mirrors
repeat the split ([2], [3]). Treat the time as variant-dependent.

**Worked numbers.**

- 0-32 km/h in 7.2 s at constant acceleration covers `d = v t / 2 = 8.89 × 7.2 / 2 ≈ 32 m`,
  which is **about 11 tiles**. A real MBT needs about a tank-gun's game range just to reach
  32 km/h.
- An energy-only bound for the M1A1, with `eta = 0.6` (see 1.4), is
  `t = m v² / (2 eta P) = 57,200 × 79 / (2 × 0.6 × 1.119 MW) ≈ 3.4 s`. The measured 7.2 s is
  about twice that. Gear changes, torque-converter slip, rolling resistance and turbine
  spool take the rest. Use the measured times, not the energy bound.
- **Merkava Mk 4** (65 t, 1,501 hp, 23.1 hp/t [27]). Scaling the K2's 7.47 s by
  power-to-weight (27.3 / 23.1) gives **about 8.8 s to 32 km/h (estimate)**. The K2 uses the
  same MTU 883 engine family as the Merkava 4.
- **Namer** (1,200 hp, 60-63.5 t, about 19-20 hp/t [28]). The same scaling gives **about
  10.5 s (estimate)**.

**Shape of the curve.** Acceleration is highest in the first second and falls as speed
rises (`a ∝ 1/v`). A launch therefore reads as a hard shove that fades. It does not read as
a constant ramp. (This follows from the formula above; no source gives a measured trace.)

### 1.2 Braking

**What is specified.** The M60A3 acceptance specification (MIL-T-45379) requires the tank,
"operated at 20 mph on dry, level, hard-surfaced roads", to stop "within the specified 60 ft
braking distance". Lateral drift must not exceed 4 ft per 60 ft, averaged over three stops
([6a]). That is a **floor**:

```
a = v² / (2 d) = 8.94² / (2 × 18.3 m) = 2.18 m/s²  (0.22 g); stopping time v/a ≈ 4.1 s
```

**What is physically possible.** The ceiling is adhesion: `a ≈ mu g`. A Battelle study of
laden trucks found an average dry 20-mph stop of 0.39 g, with weak brakes ([7]). No
published tracked-vehicle deceleration in g was found. A tracked vehicle on dry dirt or
asphalt has `mu` of roughly 0.5-0.8, so a **hard tactical stop of about 0.4-0.6 g (4-6 m/s²)
is plausible (estimate)**. Loose sand and mud lower it.

**Worked numbers (estimate, 0.5 g):** from 30 km/h, the stop takes 1.7 s over 7.1 m
(2.4 tiles). From 60 km/h it takes 3.4 s over 28 m.

**Takeaway for animation.** Braking deceleration is **3-5 times** the mean launch
acceleration (0.13 g against 0.4-0.6 g). A stop should look harder and shorter than a
start. An asymmetric pitch (a deeper dip than squat) is the physical result. See 1.3.

### 1.3 Weight transfer: nose dip, squat, settle

**Physics.** Under a longitudinal acceleration `a`, the load moving between the front and
rear road wheels is `ΔW = m a h / L`. Here `h` is the CG height above the ground-contact
plane and `L` the track contact length. The suspension resists the pitch with a stiffness
`K_θ = I_y ω_p²`. With `I_y = m r_y²`, the steady pitch angle is:

```
θ ≈ a h / (r_y² ω_p²)                       (radians; nose down under braking)
peak under a sudden step ≈ θ × (1 + exp(-ζπ/√(1-ζ²)))
2 % settling time t_s ≈ 4 / (ζ ω_p)
```

**Worked example: Merkava-sized MBT (estimate).** Inputs: `h ≈ 1.3 m` (0.45 m ground
clearance [27] plus hull mass; estimate). `r_y ≈ 2.2 m`, the radius of gyration of a uniform
7.6 m hull, 7.6/√12. `f_pitch` 1.0-2.4 Hz: one study of a military tracked vehicle measured
2.43 Hz in pitch [29], and heavy MBTs are probably softer. Damping `ζ ≈ 0.3`.

| Case | a | f_pitch 1.0 Hz | 1.5 Hz | 2.4 Hz |
|---|---|---|---|---|
| Hard stop, steady | 4.9 m/s² (0.5 g) | 1.9° | 0.85° | 0.33° |
| Hard stop, peak (ζ 0.3, ×1.37) | | **2.6°** | **1.2°** | **0.45°** |
| Launch, peak | 1.2 m/s² | 0.6° | 0.3° | 0.1° |
| Settling time (2 %) | | 2.1 s | 1.4 s | 0.9 s |

So a hard stop dips the nose **about 0.5-2.5°** and settles in **about 1-2 s**, with one
visible overshoot past level. A launch squats **about 0.1-0.6°**, a quarter of the dip. All
values are estimates from the formula. No source publishes a measured MBT dive angle.

Drive-torque reaction adds to the launch squat. It depends on whether the sprocket is at the
front (Merkava) or the rear (Abrams). It is not quantified in any public source found.

### 1.4 Speed limits: road, cross-country, slope

**Road vs cross-country (published):**

| Vehicle | Road | Cross-country | Ratio | Source |
|---|---|---|---|---|
| Merkava Mk 4 | 64 km/h | 55 km/h | 0.86 | [27] |
| M1A1 / M1A2 | 72 / 67 km/h (governed) | 40 km/h (Wikipedia); 30 mph = 48 km/h (FAS, M1) | 0.56-0.67 | [3], [2] |
| Leopard 2 | 72 km/h | 45 km/h max; **40 km/h average** | 0.56-0.63 | [5] |
| K2 | 70 km/h | 50 km/h | 0.71 | [4] |

"Cross-country maximum" is a burst on good going. NRMM-style mobility models predict an
average **speed made good** off-road, limited by ride, obstacles and visibility. That average
is lower again (concept: [14]; Leopard's 40 km/h "average cross-country" [5] is a
manufacturer number for the same idea).

**Speed vs slope (power-limited).** Setting `a = 0` in the power equation gives:

```
v_slope = eta P / (m g (sin θ + f cos θ))
```

The equation can be checked against the M1 figures in FAS [2] (1,500 hp = 1.119 MW,
`f = 0.04` (estimate), `eta` fitted):

| | 10 % slope (5.7°) | 60 % slope (31°) |
|---|---|---|
| FAS, M1 (54.4 t) | 20 mph = 32 km/h | 4.5 mph = 7.2 km/h |
| Formula, M1, `eta = 0.60` | 32.5 km/h | 8.3 km/h |
| FAS, M1A1 (57.2 t) | 17 mph = 27 km/h | 4.1 mph = 6.6 km/h |
| Formula, M1A1, `eta = 0.55` | 28 km/h | 7.2 km/h |

The fit gives a drive-train efficiency of **about 0.55-0.6 at the sprocket (fitted)**. It
reproduces both slopes to about 15 %. Applied to the **Merkava Mk 4** (65 t, `eta = 0.55`,
estimate): **25 km/h on 10 %, 11 km/h on 30 %, 6.3 km/h on 60 %**.

**Rule of thumb (estimate from the table above):** a tank keeps about 40 % of road speed on a
10 % grade and about 10 % on a 60 % grade. On a slope, speed falls before traction does.

### 1.5 Gradient, side slope, step, trench

**Traction limit on gradient:** `tan θ_max ≈ mu - f`. A 60 % grade (31°) needs `mu ≈ 0.64`
or better. That is why 60 % is the near-universal tracked-vehicle requirement: it sits just
inside the adhesion of tracks on firm ground.

| Vehicle | Gradient | Side slope | Vertical step | Trench | Source |
|---|---|---|---|---|---|
| M60A3 (acceptance test) | 60 % | 30 % | n/s | n/s | [6a] |
| M1 Abrams | 60 % | 40 % | 49 in (1.24 m) M1; 42 in (1.07 m) M1A1 | 9 ft (2.74 m) | [2], [3s] |
| K2 | 60 % (31°) | n/s | 1.3 m | n/s | [4] |
| M113 | 60 % | n/s | 0.6 m | 1.7 m | [13] |
| Stryker ICV (8x8) | 60 % | 30 % | 0.58 m | 2.0 m | [19] |
| HMMWV M1151 (at GCW) | 40 % | 30 % | 0.30 m (12 in) | n/s | [18] |

Sources disagree on the M1's vertical step. FAS gives 49 in and 42 in for different variants
[2], and AFV Database gives about 1.2 m [3s]. The difference is variant weight and the
idler-height change.

**Side slope is the binding limit off-road.** Tracked vehicles are rated at 30-40 % and
wheeled ones at 30 %. Above that the vehicle slides sideways or rolls. It is half or less of
the gradient limit.

**Game check.** One elevation level is 0.766 m. A rise of 1 level per tile is a 25.5 %
grade (14.3°), 2 levels per tile is 51 % (27°), and 3 levels per tile is 77 % (37.5°). That
last is steeper than any tank can climb. A one-level step (0.77 m) is above an M113's 0.6 m
step and below an MBT's 1.0-1.3 m.

### 1.6 Soft ground: ground pressure, VCI, NRMM, tracks vs wheels

**Nominal ground pressure** is weight over contact area (`W / (2 b L)` for tracks). Approximate
values ([12] unless noted):

| Object | kPa |
|---|---|
| Average person standing, flat shoes | 17 |
| M113 (by variant) | 50-54 [13] |
| Leopard 2 | 81 (0.83 kg/cm²) [5] |
| M1 Abrams | 103 (15 psi); FAS gives 13.1-15.4 psi = 90-106 kPa by variant [2] |
| Toyota 4Runner / Hilux Surf (1993) | 170 |
| Passenger car | 205 |

A **Merkava Mk 4 at about 105 kPa (estimate)** comes from 65 t on two tracks about 0.64 m
wide with about 4.7 m contact. Both dimensions are estimates.

**Why nominal pressure misleads.** On soft soil, the pressure peaks under each road wheel.
Rowland's **mean maximum pressure (MMP)** averages those peaks. For tracks it is usually
written `MMP = 1.26 W / (2 n b √(p d))` (kPa, with `W` in kN, `n` road wheels per side, `b`
track width, `p` track pitch, `d` road-wheel diameter). That coefficient is quoted from
secondary literature and was **not verified against Rowland 1972** in this research [15].
Later reviews warn that MMP "does not actually represent the ground pressure accurately". It
is best used to compare vehicles [15].

**Vehicle cone index (VCI) and NRMM.** The US Army / NATO Reference Mobility Model
soft-soil method compares two numbers:

- the soil's **rating cone index**, `RCI = CI × RI`: the cone penetrometer index times a
  remoulding index, which measures how traffic weakens the soil;
- the vehicle's **VCI1** (one pass) or **VCI50** (fifty passes, i.e. a column).

A vehicle is "go" when `RCI ≥ VCI`. A **lower VCI means better soft-soil mobility** [14].

| Vehicle | VCI1 | VCI50 | Source |
|---|---|---|---|
| M1A1 Abrams | 25 | 58 | [14] (example assumption in a paper using the FM method) |
| HMMWV at 15,500 lb | ~31 | n/s | [16] (Navy SBIR topic text; page not re-fetched, search snippet) |
| M113 (MEXA field test) | n/s | 15 (the paired one-pass value, about 29, may be misread) | [17] (search snippet of the DTIC report) |

**The headline:** a 57 t M1A1 has a lower one-pass VCI (25) than a heavily loaded HMMWV (31).
**The tank goes where the truck bogs**, even though its nominal pressure is similar.

**Why tracks keep going where wheels sink (mechanism).**

- **Contact length.** A track spreads load over five to seven wheel stations and a long belt.
  A wheel loads one short patch.
- **Rolling resistance by compaction.** A sinking wheel climbs out of its own rut all the
  time. That compaction and bulldozing resistance rises steeply with sinkage ([8], eq. 12:
  `R_m = R_r + R_c + R_b`).
- **Grouser shear.** Track grousers shear a long soil block, so the thrust available is
  higher at the same slip.
- **Multi-pass.** Each following wheel of a convoy meets weaker, remoulded soil. That is why
  **VCI50 is roughly double VCI1** (M1A1: 25 against 58) and why a column ruins a route that
  one vehicle crossed cleanly.

The Wong and Huang paper "Wheels vs. tracks" (J. Terramechanics, 2006) is the standard
comparison. It is cited by the papers above but was not retrieved here.

---

## 2. Steering

### 2.1 Skid steering of tracked vehicles

**Kinematics (no slip).** With outer and inner track speeds `v_o` and `v_i`, and `B` the
distance between track centres:

```
R = (B/2) (v_o + v_i) / (v_o - v_i)        turn radius of the hull centre
ω = (v_o - v_i) / B                         yaw rate
v = (v_o + v_i) / 2                         forward speed
```

**With slip,** the real radius is larger and the yaw rate lower. One simulation study found
the turning radius **about 1.5×** the no-slip value, and the turning angular speed **about
67 %** of it, in a skid-steer turn [10] (search snippet).

**Turning resistance.** The ground resists the hull rotating. For a uniform pressure
distribution on firm ground ([8], eqs. 17-19, after Wong [1]):

```
M_r = mu_t W l / 4                                  (l = track contact length)
mu_t = mu_max / (a + (1 - a) R / (B/2))            a = 0.85 or 0.925 by steering mechanism
                                                   (with a = 0.925 this is mu_max / (0.925 + 0.15 R/B))
```

`mu_t` is largest at `R = B/2`, which is pivoting about one stopped track. It falls as the
radius grows. **Tight turns cost the most torque.**

**Steerability.** The track-force difference must overcome `M_r`: `(F_o - F_i) B/2 = M_r`.
With each track's thrust capped by adhesion (`F ≤ phi W/2`), turning on the spot needs
`l / B ≤ 2 phi / mu_t` (derived here from the two equations above). Real tracked vehicles
keep `l/B` around 1.2-1.8. The Merkava is about 4.7 / 2.9 ≈ 1.6 (dimensions estimated).

**Limits of the model.** Wong's general theory neglects the soil the track pushes up beside
itself. In small-radius turns that bulldozing becomes "non-negligible and sometimes
significant" [9].

### 2.2 Pivot (neutral) turns

**Mechanisms.** In a **neutral steer**, the tracks counter-rotate and the hull turns about
its own centre. Modern MBTs with regenerative steering transmissions can do it (Leopard 2,
Leclerc, Ariete, Merkava). In a **pivot about one track**, one track is braked. Clutch-brake
steering does this: older M113s with laterals, and the D9R's "clutch and brake steering"
[32]. Agricultural studies call the first a *spin turn* and the second a *pivot turn*. The
pivot (one track stopped) disturbed **about 1.7×** the ground area of the spin turn [11].

**Yaw rate in neutral steer:** `ω = 2 v_t / B`, where `v_t` is each track's speed.

- Worked example (estimate): `v_t = 1.0 m/s` (3.6 km/h at the track) and `B = 2.9 m` give
  `ω = 0.69 rad/s ≈ 40°/s`, or **360° in about 9 s**.

**What public sources say:**

| Evidence | Value | Quality |
|---|---|---|
| M60A3 spec: the gun stabiliser is tested during "pivot steer operations" with hull rotation "at a speed of 4.5° to 9° per second" | 4.5-9°/s | Primary spec [6b]. This is the test rate, not the vehicle's maximum. |
| War Thunder model of Merkava Mk.3B: "~15 seconds for a full 360 degree turn on the spot" | 24°/s | **Game data**, not measured [23] |
| Informal in-game timing: neutral-steer tanks (Ariete, Leclerc) about 10 s per 360°; a T-80 without neutral steer about 6.5 s | 36-55°/s | **Game data**, forum [24] |

**Usable range: 15-40°/s for a modern MBT pivoting in place, about 25°/s typical. This is an
estimate** bounded by the kinematic example and the game models. No measured military figure
was found. A heavy dozer or an older clutch-brake vehicle pivots slower and digs in more.

### 2.3 Speed loss, slip, dust and spoil in turns

- **Speed loss.** `M_r` rises steeply as `R` falls (2.1). The engine's power must also cover
  the turning-resistance work, so a tracked vehicle **slows in a tight turn** unless it has
  power to spare. Clutch-brake steering throws the inner track's power away in the brake, so
  it slows more than regenerative steering (mechanism; [1], [8]).
  - Size of the loss: about 20-50 % in tight turns on firm ground (estimate). No public
    measurement was found.
  - A ceiling on cornering speed is lateral skid, `v ≤ √(mu_lat g R)`. With `mu_lat ≈ 0.35`
    (estimate) a 20 m-radius turn tops out near 30 km/h.
- **Slip.** The outer track runs ahead of the ground (positive slip) and the inner one behind
  it (skid). Both shear the surface.
- **Spoil.** Inside the turn the shearing tracks leave a curved scuff. Outside it they push
  up a **berm** of soil [9]. A neutral turn on the spot leaves a scuffed disc as wide as the
  hull length. A pivot on one stopped track leaves a deeper gouge under that track [11].
- **Dust and mud.** The track throws loose material where it leaves the ground and where it
  wraps the sprocket and idler. That means a **dust plume from the rear and both track ends,
  strongest in a pivot**, when both tracks shear without moving the hull (mechanism; no
  measured source). Side skirts, as on the Merkava, cut the side spray.

### 2.4 Wheeled steering: Ackermann, multi-axle, three-point turns, reversing

**Ackermann geometry.** For no tyre scrub, every wheel's axis passes through one turn centre:

```
cot δ_o - cot δ_i = w / L           (w = kingpin track width, L = wheelbase)
R ≈ L / tan δ                       (bicycle approximation, rear-axle centre)
```

**Worked example: HMMWV.** Wheelbase 3.30 m, track width 1.82 m, turning radius 7.62 m
(25 ft) [18]. Taking that as the outer-front-wheel radius:

- rear-axle centre radius = √(7.62² − 3.30²) − 0.91 = 5.96 m;
- outer wheel δ_o = atan(3.30 / 6.87) = 25.7°;
- inner wheel δ_i = atan(3.30 / 5.05) = 33.2°.

**Yaw-rate ceiling for wheels (estimate).** Wheels cannot turn on the spot, so `ω = v / R`.
Two limits apply: the minimum radius at low speed, and tyre grip at speed
(`R ≥ v² / (mu_lat g)`, with `mu_lat ≈ 0.5`).

- At 10 km/h on a 6 m radius: 27°/s.
- At 30 km/h, grip sets R ≥ 14 m: 33°/s.

**A Humvee-class vehicle peaks at roughly 25-35°/s of yaw (estimate) and has zero yaw at
standstill.**

**Multi-axle (8x8).**

- The Patria AMV steers "1st and 2nd axles", with rear-axle steering optional [20].
- With two steered axles, the turn centre lies on a line through the middle of the
  unsteered rear axle group. Each steered axle's angle is `δ_k = atan(x_k / R)`, where `x_k`
  is its distance ahead of that line. The front axle steers more than the second.
- **Stryker ICV: minimum turning diameter 52 ft = 16 m** [19]. An 8x8 needs a 16 m-wide space
  to U-turn without backing. An urban street of 6-10 m (estimate) forces a **three- or
  five-point turn**: stop, reverse with opposite lock, stop, go forward. At walking pace
  that takes **about 15-30 s (estimate)**.

**Reversing.**

- Wheeled: reversing means a reverse gear, low speed, and poor rear vision. Doctrine and
  practice use a ground guide when space allows (estimate; general practice).
- Tracked: reverse uses the same steering mechanism.
- Published reverse speeds: Leopard 2 up to 31 km/h, against 68 km/h forward [5c]. The
  IDF's armoured D9 reverses faster than it advances, 14.6 km/h against 11.7 km/h [32]. That
  is a dozer's working cycle: push forward, back up fast.
- Reverse speed for tanks: **about 30-50 % of forward maximum (estimate**, from the Leopard 2
  value).

### 2.5 Turret slew and stabilisation against hull motion

**Traverse rates:**

| Vehicle | 360° time | Rate | Source |
|---|---|---|---|
| M1 Abrams | 9 s | 40°/s | [3] |
| Merkava (mark not stated, 2000 article) | 12 s | 30°/s | [21] (search snippet) |
| Unnamed vehicle in a Frag Out! article (attributed to Merkava 3/4 in a forum post) | n/a | 34°/s azimuth, 15°/s elevation | [22] (snippet; attribution unverified) |

**Usable range: 30-40°/s in azimuth and about 15°/s in elevation.** A 180° slew takes 4.5-6 s.

**Stabilisation.** A two-axis stabiliser uses gyros and servos to hold the gun on a
world-fixed line while the hull yaws and pitches under it [25]. The M60A3 specification
quantifies the requirement [6b]:

- **Azimuth:** retain aim within 9 mils during a pivot steer at 4.5-9°/s of hull rotation,
  and return within 5 mils after the pivot.
- **Elevation:** retain aim within 6 mils during hull pitching at 5-8°/s, and return within
  3 mils after the motion stops.
- Modern fire control can "hit a target moving thirty miles an hour while itself is moving
  at the same speed" at 2,000 m or more [25].

**What it looks like.** While the hull turns, the turret **counter-rotates relative to the
hull** at the hull's yaw rate, so the barrel stays still in the world. While the hull pitches
over bumps or dips under braking, the **gun's elevation relative to the hull changes**, so the
barrel stays level in the world. The barrel visibly "floats" against a moving hull.

**Gun depression.** Western tanks reach about −10° to +20° and Soviet tanks about −5° to
+15° [26]. The K2 can kneel to extend its elevation limits [4]. Depression decides whether a
tank can fire from a hull-down position behind a crest (see `tactics.md`).

---

## 3. Suspension and body motion

### 3.1 Suspension types

- **Torsion bar.** M1 Abrams (high-hardness steel bars, rotary dampers) [3], M113 [13],
  Leopard 2. The bar runs across the hull floor, so travel is limited by bar length (hull
  width) and steel yield [30b].
- **Helical (coil) spring, external units.** Every Merkava, and the Namer, which shares the
  chassis [27], [28]. Each road wheel has its own spring [28b]. The units bolt on outside the
  hull, which keeps the floor flat and makes field replacement easy. Only some wheel
  stations carry hydraulic rotary dampers: one report says the first two and last two
  stations on each side (search snippet, source not confirmed).
- **Hydropneumatic / hydrogas.** Challenger 2, Leclerc. Gas springs give a progressive rate.
  The **K2's semi-active in-arm unit** can kneel, sit, stand and lean, and can "lower the
  overall height by 40 centimeters" [4].
- **Wheeled.** The HMMWV has independent double A-frames with coil springs at all four
  corners [18]. 8x8 APCs generally use independent suspension.

### 3.2 Road wheel travel

| Vehicle | Total vertical travel | Source and confidence |
|---|---|---|
| Early Merkava (article about 1979) | 380 mm total, "can bend up to 210 mm" | [22b] Frag Out! (snippet) |
| Merkava Mk 3 | 604 mm (300 bump / 304 rebound) | search snippet, **source not confirmable** |
| Challenger 2 (hydrogas) | 450 mm | forum post [31], **unverified** |
| Leopard 2 | 526 mm | forum post [31], **unverified** |

**Range for a modern MBT: about 380-600 mm**, from weak sources (see the table). On the
Merkava the skirts hide most of it.

### 3.3 Body bounce, pitch and roll frequencies

- One study of a military tracked-vehicle model gave first-mode frequencies of **1.245 Hz
  bounce, 2.43 Hz pitch and 2.867 Hz roll** [29] (search snippet; host unreachable for a
  full read; the vehicle is not named as an MBT).
- A high-mobility tracked vehicle study measured road-wheel-to-hull bounce transmissibility
  of **about 0.6** [30] (snippet).
- A passenger car's ride frequency is commonly given as about 1-1.5 Hz (textbook value, not
  fetched here).

**Amplitude over rough ground (estimate).** Practical cross-country speed is limited by crew
ride tolerance. NRMM's widely cited criteria are 6 W absorbed power for ride and about
2.5 g peak vertical for obstacle shock (widely cited NRMM values; not verified from a primary
text here). At those limits the hull's motion is **a few degrees of pitch and a few
centimetres of bounce at 1-2.5 Hz**. Roll on a rough side slope is similar or smaller.

### 3.4 Visual cues

Mechanisms, not measurements:

- **Wheels follow the ground; the hull does not.** Road wheels rise and fall over every
  bump, and the hull averages them. The track's bottom run conforms to the ground.
- **Track sag.** The top run hangs between the return rollers (or between the sprocket and
  idler on vehicles without return rollers). It slaps and ripples at speed, and the sag
  shifts when the vehicle accelerates or brakes.
- **Antenna whip.** A tall whip antenna on a stiff base is an inverted pendulum. It bows
  backward on a launch and forward on a stop, then rings for a few cycles. Body-frame
  oscillations re-excite it (estimate: about 1-3 Hz, a tip swing of tens of centimetres).
- **Turret and barrel inertia.** On a stabilised tank the barrel holds still in the world
  (2.5). An unstabilised mount bobs with the hull: a technical's DShK or ZU-23, or an older
  gun.
- **Dust.** A rooster tail from the sprockets and tracks, strongest in a pivot and on a
  launch (2.3). Wheeled vehicles throw dust from the tyre contact and the rear.
- **Exhaust.** Puffs on a launch and on a throttle change, mostly diesel.

### 3.5 Settling after a stop

A stop is a step input to a damped spring. **The nose dips, passes level once, rises slightly
and settles in about 1-2 s** (1.3; estimate, with damping about 0.3). Only the first overshoot
is visible. A lighter wheeled vehicle on softer, better-damped springs settles faster, in
about 0.5-1 s (estimate). The antenna keeps ringing after the hull has settled.

---

## Sources

1. Wong, J. Y., *Theory of Ground Vehicles* (Wiley; 3rd ed. 2001, 4th ed. 2008). The
   framework for traction, motion resistance and skid steering. A listing is at
   https://www.scribd.com/doc/273091975/Theory-of-Ground-Vehicles. The book itself was not
   read here; numbers come from the papers that apply it.
2. FAS, *M1 Abrams Main Battle Tank*: weight, hp/ton, 0-20 mph, speed on 10 % and 60 %,
   ground pressure, step, trench. https://man.fas.org/dod-101/sys/land/m1.htm
3. Wikipedia, *M1 Abrams*: masses, governed speeds, 40 km/h off-road, "9 seconds/360
   degrees", torsion bars. https://en.wikipedia.org/wiki/M1_Abrams
   3s. AFV Database, *M1 Abrams*: about 1.2 m step, 108 in trench (search snippet).
   https://afvdatabase.com/usa/m1abrams.html; inetres, 60 % / 40 % (snippet):
   https://www.inetres.com/gp/military/cv/tank/M1.html
4. Wikipedia, *K2 Black Panther*: 0-32 km/h 7.47 s / 8.77 s, 27.3 hp/t, 60 %, 1.3 m step,
   ISU kneel and lower by 40 cm. https://en.wikipedia.org/wiki/K2_Black_Panther
5. FAS, *Leopard 2*: 55.15 t, 72 / 45 / 40 km/h, 0.83 kg/cm².
   https://man.fas.org/dod-101/sys/land/row/leopard2.htm
   5b. historyrise.com, Leopard 2 "Modern" 0-32 km/h in 6-7 s (secondary, unconfirmed).
   https://historyrise.com/article/a-comparative-analysis-of-leopard-2-moderns-powertrain-and-mobility-features/
   5c. Motor1 (DE), Leopard 2: 68 km/h forward, 31 km/h reverse (search snippet).
   https://de.motor1.com/news/394514/leopard-2-geschichte-und-technik/
6. MIL-T-45379 (M60A3 tank specification), via emilspec mirror:
   6a. brake test, 20 mph within 60 ft, 60 % grade, 30 % side slope:
   https://combatassaulttacticalvehiclestra.emilspec.com/MIL-T-45379/page52.html
   6b. stabilisation during pivot steer at 4.5-9°/s and pitching at 5-8°/s:
   https://combatassaulttacticalvehiclestra.emilspec.com/MIL-T-45379/page17.html
7. FMCSA / Battelle brake-test appendix: laden truck at 20 mph, about 0.39 g (search
   snippet). https://webarchive.library.unt.edu/web/20130219002441/http://@fmcsa.dot.gov/documents/pbbtappend-bcde.pdf
8. Milićević et al., "Theoretical Model of High-Speed Tracked Vehicle General Motion", *FME
   Transactions* 51(3), 2023: mass factor, M_r = mu G l/4, mu_t formula.
   https://simlab.mas.bg.ac.rs/_media/istrazivanje/fme/vol51/3/16_s._milicevic_et_al.pdf
9. ISTVS 2022 paper on lateral soil accumulation in skid steering (search snippet).
   https://2022.istvs.org/papers/4782
10. Atlantis Press, tracked-vehicle steering with slip: radius about 1.5×, yaw rate about
    67 % (search snippet). https://www.atlantis-press.com/article/6913.pdf
11. JARQ 30(4), pivot vs spin turns (agricultural tracked vehicles): pivot disturbs about
    1.7× the area (search snippet).
    https://www.jircas.go.jp/sites/default/files/publication/jarq/30-4-249-253_0.pdf
12. Wikipedia, *Ground pressure*: table. https://en.wikipedia.org/wiki/Ground_pressure
13. Wikipedia, *M113 armored personnel carrier*: 12.3 t, 275 hp, 67.6 km/h, 60 %, 1.7 m,
    0.6 m, 50-54 kPa, IDF variants. https://en.wikipedia.org/wiki/M113_armored_personnel_carrier
14. Paper applying the FM vehicle-cone-index method (M1A1 VCI1 25, VCI50 58; RCI = CI × RI)
    (search snippet; 403 on fetch).
    https://mrforum.com/wp-content/uploads/open_access/9781644902059/32.pdf
15. MMP background (Rowland 1972; Larminie 1992) and the caution on its accuracy (search
    snippets). https://iris.unipa.it/retrieve/e3ad8915-f221-da0e-e053-3705fe0a2b96/Virz%c3%ac%20Mariotti_paper101.pdf
    and https://hrcak.srce.hr/file/300555
16. Navy SBIR topic (FY12.1) stating the HMMWV's VCI of about 31 at 15,500 lb (search
    snippet; 403 on fetch). https://www.navysbir.com/12_1/45.htm
17. DTIC AD0883199, MEXA field test vehicle cone indexes (search snippet).
    https://apps.dtic.mil/sti/pdfs/AD0883199.pdf
18. AM General, *M1151* product sheet (PDF, text extracted): weights, 190 hp, 113 km/h,
    7.62 m turning radius, 40 % / 30 %, 12 in step, 30 in / 60 in ford, suspension.
    https://www.amgeneral.com/wp-content/uploads/2019/12/M1151.pdf
19. AFV Database, *M1126 Stryker ICV*: 60 % / 30 %, 23 in step, 78 in trench, 52 ft turning
    diameter (search snippet). https://afvdatabase.com/usa/m1126icv.html
20. Army Technology, *Patria AMV XP*: steering on the 1st and 2nd axles, rear optional.
    https://www.army-technology.com/projects/patria-amvxp/
21. StrategyPage, *Armor: August 8, 2000*: Merkava turret 12 s per 360° (search snippet).
    https://cmsmgr.strategypage.com/htmw/htarm/articles/20000808.aspx
22. Frag Out! Magazine: 34°/s azimuth, 15°/s elevation (search snippet, vehicle unnamed).
    https://fragout.uberflip.com/i/1365706/16
    22b. Frag Out! Magazine, early Merkava suspension 380 mm / 210 mm (search snippet).
    https://fragout.uberflip.com/i/1308154/15
23. War Thunder wiki, *Merkava Mk.3B*: neutral steer about 15 s per 360° (**game model**).
    https://old-wiki.warthunder.com/Merkava_Mk.3B
24. War Thunder forum, *Tank steer while stationary* (informal in-game timings, **game**).
    https://forum.warthunder.com/t/tank-steer-while-stationary/312280
25. Wikipedia, *Gun stabilizer*. https://en.wikipedia.org/wiki/Gun_stabilizer
26. Wikipedia, *Hull-down*: gun depression ranges. https://en.wikipedia.org/wiki/Hull-down
27. Wikipedia, *Merkava*: Mk 4 65 t, 1,501 hp, 64 / 55 km/h, helical spring, 0.45 m
    clearance. https://en.wikipedia.org/wiki/Merkava
28. Wikipedia, *Namer*: 1,200 hp, 20 hp/t, 60+ t, helical spring.
    https://en.wikipedia.org/wiki/Namer
    28b. Army Recognition, *Merkava IV*: "Each roadwheel is suspended by a separate helical
    spring". https://www.armyrecognition.com/military-products/army/main-battle-tanks/main-battle-tanks/merkava-iv-4-israel-uk
29. Defence Science Journal (DRDO), modal analysis of a military tracked vehicle: 1.245 /
    2.43 / 2.867 Hz (search snippet; host not resolvable on fetch).
    https://publications.drdo.gov.in/ojs/index.php/dsj/article/download/3410/1841
30. J. Inst. Eng. India Ser. C (2018), high-mobility tracked vehicle, transmissibility about
    0.6 (search snippet).
    https://springerlink.bibliotecabuap.elogim.com/content/pdf/10.1007/s40032-018-0460-8.pdf
    30b. Patent US 2019/0210670, torsion-bar travel limits.
    https://patents.justia.com/patent/20190210670
31. War Thunder forum, Challenger 2 technical thread: 450 mm hydrogas, 526 mm Leopard 2
    claim (**unverified forum**).
    https://forum.warthunder.com/t/challenger-2-mbt-technical-data-and-discussion-part-1/20371?page=482
32. Wikipedia, *Caterpillar D9*: weights, hp by model, 11.7 km/h forward / 14.6 km/h
    reverse, D9R clutch-brake and D9T differential steering.
    https://en.wikipedia.org/wiki/Caterpillar_D9
