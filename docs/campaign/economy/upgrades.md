# Upgrade tracks and prices — the Upgrade step

**Date:** 2026-09-17. **Scope:** spec `2026-09-15-brigade-economy-design.md` §8 step 3
("Upgrade"), §4.3, §4.5, §6. Tracks, tiers, prices and patches for all seventeen
KDF unit types, fitted at base and at maximum tier against the §5.7 backtest
(`pnpm balance`) and against the cost-curve validator (`tools/validate_balance.py`).
No engine code touched; no unit JSON committed with this document — every
measurement below patched `data/units/kdf/*.json` in place, ran the instrument,
and restored with `/usr/bin/git checkout -- data/units/kdf` before the next one.

## 1. Method

Three instruments, all read-only against this worktree's shipped roster:

```
pnpm balance                                          # §5.7 backtest
python3 tools/validate_balance.py --units data/units --tolerance 0.18 --report
pnpm playtest                                          # optional sanity pass
```

Every measurement in §3 and §4 follows the same loop: apply a patch (a Python
script reading the same tier tables this document reports) to one or more
`data/units/kdf/*.json` files in place, run the instrument, record the printed
numbers, then `/usr/bin/git checkout -- data/units/kdf` before the next patch.
`git status --short` was clean before the first patch and after every restore —
verified, not assumed, since a second agent was concurrently touching
`data/schemas/unit.schema.json`, `tools/validate_data.mjs` and
`packages/data/src/upgrades.*` in this same worktree; those files are untouched
by this document and are not part of its commit.

Tiers are cumulative deltas over base, as specified (§4.3): a tier's `patch`
states the TOTAL delta from the unit's shipped stats, not an increment over the
previous tier. `price`, by contrast, is read here as the INCREMENTAL credit cost
of buying that one tier (tier 2's price is paid on top of having already bought
tier 1, not instead of it) — the spec's own example (300, then 600) reads
naturally either way, and this is the reading used throughout §6's budget
arithmetic. This is stated as an assumption because the spec does not settle it
and the account mechanics that would (whether buying tier 2 without tier 1
is possible, whether a tier can be sold back) are out of this document's scope.

The whitelist used is exactly §4.3's: `hull.hp`, `hull.armor.front|side|rear`,
`sensors.optics`, `sensors.sight_tiles`, `weapons[0].accuracy`,
`weapons[0].penetration`. `hull.suppression_resistance` and per-weapon fields on
a unit's secondary weapon (`demo_squad`'s charges, `mbt_lavi`'s coax, `heli_peten`'s
Hellfire) are in the whitelist and in scope but are not used by any track here —
the envelope asks for two to three tracks of two to three tiers, not for every
whitelisted field to be spent, and a unit's PRIMARY weapon (index 0) is the one
that decides its role.

## 2. Baseline §5.7 numbers

`pnpm balance` at base (unmodified roster), the contract every max-tier change
below is held against:

| target | measured | band | pass |
|---|---|---|---|
| ATGM Pk vs unprotected armour | 0.67 | 0.60–0.80 | PASS |
| APS intercept vs shaped charge | 0.73 | 0.60–0.90 | PASS |
| Urban assault force ratio | 1:1=0% 2:1=63% 3:1=100% 4:1=100% | 1:1 fails, 2:1 ≤85% and ≥15pp below 3:1, 3:1 ≥65% | PASS |
| Lanchester square law | 12v6 mean 12.0 (linear 6, square 10.4); 16v8 mean 16.0 (linear 8, square 13.9) | survivors ≫ linear | PASS |
| Air is contested by AA | 1 truck=80%, 2=0%, 3=0% | ≥50% at 1, ≤50% at 3, falling | PASS |

## 3. Per-type tracks, tiers and prices

Every type gets an `armour` track (`hull.hp` + `hull.armor.front/side/rear`) and a
`sensors` track (`sensors.optics` + `sensors.sight_tiles`); every type that carries
a weapon also gets a `firepower` track on its weapon-index-0 (`weapons[0].accuracy`
+ `weapons[0].penetration`). `dozer_d9` and `recon_drone` carry no weapon at all
and so get two tracks, not three — inside the 2–3 track envelope. All three tracks
run 3 tiers. Prices scale with the unit's own `cost.logistics` (§5's `k` factor is
the OTHER direction — converting spent credits back into an equivalent logistics
figure to check against the power curve — this per-tier price is calibrated
against the campaign credit ladder, §6). Generic percentage deltas are 7/15/25%
of base for the armour track (hp and all three armor faces alike), 8/15/25% of
base optics plus a flat +1/+2/+3 sight tiles for sensors, and +0.03/+0.06/+0.10
accuracy plus 8/16/25% of base penetration for firepower. Four unit-specific
deviations from those generic curves were found by measurement, not chosen up
front — §4 explains each one where it is measured; §3 states the shipped numbers.

### Eitan APC (`apc_eitan`)

Role `apc`, logistics 520. Tracks: armour, sensors, firepower. Total credits to max every track: **2950**.

**Measured at max tier:** not exercised by name in any §5.7 scenario (no target spawns this type); its contribution to the combined all-17 `pnpm balance` pass (§4.5) and to the cost-curve check (§5) is the measurement on record for it.
Power score (this document's own re-derivation of `validate_balance.py`'s curve): 3.54 → 4.68 at max tier (+32%); the base curve prices that much power at 508→578 logistics against its actual 520.

```json
{
  "upgrades": {
    "armour": {
      "tiers": [
        {
          "price": 210,
          "patch": {
            "hull.hp": 112,
            "hull.armor.front": 15,
            "hull.armor.side": 10,
            "hull.armor.rear": 6
          }
        },
        {
          "price": 310,
          "patch": {
            "hull.hp": 240,
            "hull.armor.front": 33,
            "hull.armor.side": 21,
            "hull.armor.rear": 14
          }
        },
        {
          "price": 440,
          "patch": {
            "hull.hp": 400,
            "hull.armor.front": 55,
            "hull.armor.side": 35,
            "hull.armor.rear": 22
          }
        }
      ]
    },
    "sensors": {
      "tiers": [
        {
          "price": 170,
          "patch": {
            "sensors.optics": 0.08,
            "sensors.sight_tiles": 1
          }
        },
        {
          "price": 260,
          "patch": {
            "sensors.optics": 0.15,
            "sensors.sight_tiles": 2
          }
        },
        {
          "price": 365,
          "patch": {
            "sensors.optics": 0.25,
            "sensors.sight_tiles": 3
          }
        }
      ]
    },
    "firepower": {
      "tiers": [
        {
          "price": 260,
          "patch": {
            "weapons[0].accuracy": 0.03,
            "weapons[0].penetration": 2
          }
        },
        {
          "price": 390,
          "patch": {
            "weapons[0].accuracy": 0.06,
            "weapons[0].penetration": 4
          }
        },
        {
          "price": 545,
          "patch": {
            "weapons[0].accuracy": 0.1,
            "weapons[0].penetration": 6
          }
        }
      ]
    }
  }
}
```

### Kipod Screen Carrier (`apc_kipod`)

Role `apc`, logistics 562. Tracks: armour, sensors, firepower. Total credits to max every track: **3190**.

**Measured at max tier:** not exercised by name in any §5.7 scenario (no target spawns this type); its contribution to the combined all-17 `pnpm balance` pass (§4.5) and to the cost-curve check (§5) is the measurement on record for it.
Power score (this document's own re-derivation of `validate_balance.py`'s curve): 4.55 → 6.15 at max tier (+35%); the base curve prices that much power at 571→656 logistics against its actual 562.

```json
{
  "upgrades": {
    "armour": {
      "tiers": [
        {
          "price": 225,
          "patch": {
            "hull.hp": 123,
            "hull.armor.front": 18,
            "hull.armor.side": 11,
            "hull.armor.rear": 7
          }
        },
        {
          "price": 335,
          "patch": {
            "hull.hp": 262,
            "hull.armor.front": 39,
            "hull.armor.side": 24,
            "hull.armor.rear": 15
          }
        },
        {
          "price": 480,
          "patch": {
            "hull.hp": 438,
            "hull.armor.front": 65,
            "hull.armor.side": 40,
            "hull.armor.rear": 25
          }
        }
      ]
    },
    "sensors": {
      "tiers": [
        {
          "price": 185,
          "patch": {
            "sensors.optics": 0.08,
            "sensors.sight_tiles": 1
          }
        },
        {
          "price": 280,
          "patch": {
            "sensors.optics": 0.15,
            "sensors.sight_tiles": 2
          }
        },
        {
          "price": 395,
          "patch": {
            "sensors.optics": 0.25,
            "sensors.sight_tiles": 3
          }
        }
      ]
    },
    "firepower": {
      "tiers": [
        {
          "price": 280,
          "patch": {
            "weapons[0].accuracy": 0.03,
            "weapons[0].penetration": 1
          }
        },
        {
          "price": 420,
          "patch": {
            "weapons[0].accuracy": 0.06,
            "weapons[0].penetration": 3
          }
        },
        {
          "price": 590,
          "patch": {
            "weapons[0].accuracy": 0.1,
            "weapons[0].penetration": 4
          }
        }
      ]
    }
  }
}
```

### Spike AT Team (`at_team`)

Role `at_team`, logistics 236. Tracks: armour, sensors, firepower. Total credits to max every track: **1345**.

**Measured at max tier:** Exercises the ATGM Pk target directly (spawns as the attacker against an unprotected MBT). Firepower's accuracy delta is capped at +0.07 at tier 3, not the generic +0.10 — see §4.1.
Power score (this document's own re-derivation of `validate_balance.py`'s curve): 0.69 → 0.84 at max tier (+22%); the base curve prices that much power at 238→261 logistics against its actual 236.

```json
{
  "upgrades": {
    "armour": {
      "tiers": [
        {
          "price": 95,
          "patch": {
            "hull.hp": 27,
            "hull.armor.front": 1,
            "hull.armor.side": 1,
            "hull.armor.rear": 1
          }
        },
        {
          "price": 140,
          "patch": {
            "hull.hp": 57,
            "hull.armor.front": 2,
            "hull.armor.side": 2,
            "hull.armor.rear": 2
          }
        },
        {
          "price": 200,
          "patch": {
            "hull.hp": 95,
            "hull.armor.front": 2,
            "hull.armor.side": 2,
            "hull.armor.rear": 2
          }
        }
      ]
    },
    "sensors": {
      "tiers": [
        {
          "price": 80,
          "patch": {
            "sensors.optics": 0.09,
            "sensors.sight_tiles": 1
          }
        },
        {
          "price": 120,
          "patch": {
            "sensors.optics": 0.17,
            "sensors.sight_tiles": 2
          }
        },
        {
          "price": 165,
          "patch": {
            "sensors.optics": 0.28,
            "sensors.sight_tiles": 3
          }
        }
      ]
    },
    "firepower": {
      "tiers": [
        {
          "price": 120,
          "patch": {
            "weapons[0].accuracy": 0.03,
            "weapons[0].penetration": 72
          }
        },
        {
          "price": 175,
          "patch": {
            "weapons[0].accuracy": 0.06,
            "weapons[0].penetration": 144
          }
        },
        {
          "price": 250,
          "patch": {
            "weapons[0].accuracy": 0.07,
            "weapons[0].penetration": 225
          }
        }
      ]
    }
  }
}
```

### Loitering Munition (`attack_drone`)

Role `drone`, logistics 300. Tracks: armour, sensors, firepower. Total credits to max every track: **410** (re-priced from 1705 — see §5, §7.4).

**Measured at max tier:** not exercised by name in any §5.7 scenario (no target spawns this type); its contribution to the combined all-17 `pnpm balance` pass (§4.5) and to the cost-curve check (§5) is the measurement on record for it.
Power score (this document's own re-derivation of `validate_balance.py`'s curve): 0.82 → 0.90 at max tier (+10%); the base curve prices that much power at 257→269 logistics against its actual 300. Patches are unchanged from the original fit — only price moved, since the power gain per credit was the problem (§5), not the deltas themselves.

```json
{
  "upgrades": {
    "armour": {
      "tiers": [
        {
          "price": 30,
          "patch": {
            "hull.hp": 6,
            "hull.armor.front": 0,
            "hull.armor.side": 0,
            "hull.armor.rear": 0
          }
        },
        {
          "price": 45,
          "patch": {
            "hull.hp": 14,
            "hull.armor.front": 0,
            "hull.armor.side": 0,
            "hull.armor.rear": 0
          }
        },
        {
          "price": 60,
          "patch": {
            "hull.hp": 22,
            "hull.armor.front": 0,
            "hull.armor.side": 0,
            "hull.armor.rear": 0
          }
        }
      ]
    },
    "sensors": {
      "tiers": [
        {
          "price": 25,
          "patch": {
            "sensors.optics": 0.11,
            "sensors.sight_tiles": 1
          }
        },
        {
          "price": 35,
          "patch": {
            "sensors.optics": 0.21,
            "sensors.sight_tiles": 2
          }
        },
        {
          "price": 50,
          "patch": {
            "sensors.optics": 0.35,
            "sensors.sight_tiles": 3
          }
        }
      ]
    },
    "firepower": {
      "tiers": [
        {
          "price": 35,
          "patch": {
            "weapons[0].accuracy": 0.03,
            "weapons[0].penetration": 38
          }
        },
        {
          "price": 55,
          "patch": {
            "weapons[0].accuracy": 0.06,
            "weapons[0].penetration": 77
          }
        },
        {
          "price": 75,
          "patch": {
            "weapons[0].accuracy": 0.1,
            "weapons[0].penetration": 120
          }
        }
      ]
    }
  }
}
```

### Tzinah Breach Team (`breach_team`)

Role `support`, logistics 306. Tracks: armour, sensors, firepower. Total credits to max every track: **1740**.

**Measured at max tier:** not exercised by name in any §5.7 scenario (no target spawns this type); its contribution to the combined all-17 `pnpm balance` pass (§4.5) and to the cost-curve check (§5) is the measurement on record for it.
Power score (this document's own re-derivation of `validate_balance.py`'s curve): 1.16 → 1.32 at max tier (+14%); the base curve prices that much power at 303→321 logistics against its actual 306.

```json
{
  "upgrades": {
    "armour": {
      "tiers": [
        {
          "price": 120,
          "patch": {
            "hull.hp": 31,
            "hull.armor.front": 1,
            "hull.armor.side": 1,
            "hull.armor.rear": 1
          }
        },
        {
          "price": 185,
          "patch": {
            "hull.hp": 66,
            "hull.armor.front": 2,
            "hull.armor.side": 2,
            "hull.armor.rear": 2
          }
        },
        {
          "price": 260,
          "patch": {
            "hull.hp": 110,
            "hull.armor.front": 2,
            "hull.armor.side": 2,
            "hull.armor.rear": 2
          }
        }
      ]
    },
    "sensors": {
      "tiers": [
        {
          "price": 100,
          "patch": {
            "sensors.optics": 0.1,
            "sensors.sight_tiles": 1
          }
        },
        {
          "price": 155,
          "patch": {
            "sensors.optics": 0.2,
            "sensors.sight_tiles": 2
          }
        },
        {
          "price": 215,
          "patch": {
            "sensors.optics": 0.33,
            "sensors.sight_tiles": 3
          }
        }
      ]
    },
    "firepower": {
      "tiers": [
        {
          "price": 155,
          "patch": {
            "weapons[0].accuracy": 0.03,
            "weapons[0].penetration": 2
          }
        },
        {
          "price": 230,
          "patch": {
            "weapons[0].accuracy": 0.06,
            "weapons[0].penetration": 4
          }
        },
        {
          "price": 320,
          "patch": {
            "weapons[0].accuracy": 0.1,
            "weapons[0].penetration": 6
          }
        }
      ]
    }
  }
}
```

### Combat Engineers (`demo_squad`)

Role `engineer`, logistics 300. Tracks: armour, sensors, firepower. Total credits to max every track: **1705**.

**Measured at max tier:** not exercised by name in any §5.7 scenario (no target spawns this type); its contribution to the combined all-17 `pnpm balance` pass (§4.5) and to the cost-curve check (§5) is the measurement on record for it.
Power score (this document's own re-derivation of `validate_balance.py`'s curve): 1.00 → 1.25 at max tier (+25%); the base curve prices that much power at 282→314 logistics against its actual 300.

```json
{
  "upgrades": {
    "armour": {
      "tiers": [
        {
          "price": 120,
          "patch": {
            "hull.hp": 27,
            "hull.armor.front": 1,
            "hull.armor.side": 1,
            "hull.armor.rear": 1
          }
        },
        {
          "price": 180,
          "patch": {
            "hull.hp": 57,
            "hull.armor.front": 2,
            "hull.armor.side": 2,
            "hull.armor.rear": 2
          }
        },
        {
          "price": 255,
          "patch": {
            "hull.hp": 95,
            "hull.armor.front": 2,
            "hull.armor.side": 2,
            "hull.armor.rear": 2
          }
        }
      ]
    },
    "sensors": {
      "tiers": [
        {
          "price": 100,
          "patch": {
            "sensors.optics": 0.08,
            "sensors.sight_tiles": 1
          }
        },
        {
          "price": 150,
          "patch": {
            "sensors.optics": 0.15,
            "sensors.sight_tiles": 2
          }
        },
        {
          "price": 210,
          "patch": {
            "sensors.optics": 0.25,
            "sensors.sight_tiles": 3
          }
        }
      ]
    },
    "firepower": {
      "tiers": [
        {
          "price": 150,
          "patch": {
            "weapons[0].accuracy": 0.03,
            "weapons[0].penetration": 1
          }
        },
        {
          "price": 225,
          "patch": {
            "weapons[0].accuracy": 0.06,
            "weapons[0].penetration": 1
          }
        },
        {
          "price": 315,
          "patch": {
            "weapons[0].accuracy": 0.1,
            "weapons[0].penetration": 2
          }
        }
      ]
    }
  }
}
```

### D9 Dov (`dozer_d9`)

Role `engineer`, logistics 586. Tracks: armour, sensors. Total credits to max every track: **1985**.

**Measured at max tier:** not exercised by name in any §5.7 scenario (no target spawns this type); its contribution to the combined all-17 `pnpm balance` pass (§4.5) and to the cost-curve check (§5) is the measurement on record for it.
Power score (this document's own re-derivation of `validate_balance.py`'s curve): 4.60 → 6.46 at max tier (+40%); the base curve prices that much power at 574→672 logistics against its actual 586.

```json
{
  "upgrades": {
    "armour": {
      "tiers": [
        {
          "price": 235,
          "patch": {
            "hull.hp": 168,
            "hull.armor.front": 17,
            "hull.armor.side": 12,
            "hull.armor.rear": 8
          }
        },
        {
          "price": 350,
          "patch": {
            "hull.hp": 360,
            "hull.armor.front": 36,
            "hull.armor.side": 26,
            "hull.armor.rear": 16
          }
        },
        {
          "price": 500,
          "patch": {
            "hull.hp": 600,
            "hull.armor.front": 60,
            "hull.armor.side": 42,
            "hull.armor.rear": 28
          }
        }
      ]
    },
    "sensors": {
      "tiers": [
        {
          "price": 195,
          "patch": {
            "sensors.optics": 0.06,
            "sensors.sight_tiles": 1
          }
        },
        {
          "price": 295,
          "patch": {
            "sensors.optics": 0.12,
            "sensors.sight_tiles": 2
          }
        },
        {
          "price": 410,
          "patch": {
            "sensors.optics": 0.2,
            "sensors.sight_tiles": 3
          }
        }
      ]
    }
  }
}
```

### AH-64 Peten (`heli_peten`)

Role `gunship`, logistics 402. Tracks: armour, sensors, firepower. Total credits to max every track: **2275**.

**Measured at max tier:** Exercises the air-contested-by-AA target directly. Armour-track percentages are cut to 5/8/12% of base (hp and armor together), not the generic 7/15/25% — see §4.4.
Power score (this document's own re-derivation of `validate_balance.py`'s curve): 2.08 → 2.31 at max tier (+11%); the base curve prices that much power at 397→417 logistics against its actual 402.

```json
{
  "upgrades": {
    "armour": {
      "tiers": [
        {
          "price": 160,
          "patch": {
            "hull.hp": 45,
            "hull.armor.front": 2,
            "hull.armor.side": 1,
            "hull.armor.rear": 1
          }
        },
        {
          "price": 240,
          "patch": {
            "hull.hp": 96,
            "hull.armor.front": 4,
            "hull.armor.side": 2,
            "hull.armor.rear": 2
          }
        },
        {
          "price": 340,
          "patch": {
            "hull.hp": 160,
            "hull.armor.front": 5,
            "hull.armor.side": 3,
            "hull.armor.rear": 2
          }
        }
      ]
    },
    "sensors": {
      "tiers": [
        {
          "price": 135,
          "patch": {
            "sensors.optics": 0.13,
            "sensors.sight_tiles": 1
          }
        },
        {
          "price": 200,
          "patch": {
            "sensors.optics": 0.24,
            "sensors.sight_tiles": 2
          }
        },
        {
          "price": 280,
          "patch": {
            "sensors.optics": 0.4,
            "sensors.sight_tiles": 3
          }
        }
      ]
    },
    "firepower": {
      "tiers": [
        {
          "price": 200,
          "patch": {
            "weapons[0].accuracy": 0.03,
            "weapons[0].penetration": 10
          }
        },
        {
          "price": 300,
          "patch": {
            "weapons[0].accuracy": 0.06,
            "weapons[0].penetration": 19
          }
        },
        {
          "price": 420,
          "patch": {
            "weapons[0].accuracy": 0.1,
            "weapons[0].penetration": 30
          }
        }
      ]
    }
  }
}
```

### Namer IFV (`ifv_namer`)

Role `ifv`, logistics 630. Tracks: armour, sensors, firepower. Total credits to max every track: **3575**.

**Measured at max tier:** not exercised by name in any §5.7 scenario (no target spawns this type); its contribution to the combined all-17 `pnpm balance` pass (§4.5) and to the cost-curve check (§5) is the measurement on record for it.
Power score (this document's own re-derivation of `validate_balance.py`'s curve): 6.20 → 8.58 at max tier (+38%); the base curve prices that much power at 659→766 logistics against its actual 630.

```json
{
  "upgrades": {
    "armour": {
      "tiers": [
        {
          "price": 250,
          "patch": {
            "hull.hp": 154,
            "hull.armor.front": 29,
            "hull.armor.side": 15,
            "hull.armor.rear": 8
          }
        },
        {
          "price": 380,
          "patch": {
            "hull.hp": 330,
            "hull.armor.front": 63,
            "hull.armor.side": 33,
            "hull.armor.rear": 18
          }
        },
        {
          "price": 535,
          "patch": {
            "hull.hp": 550,
            "hull.armor.front": 105,
            "hull.armor.side": 55,
            "hull.armor.rear": 30
          }
        }
      ]
    },
    "sensors": {
      "tiers": [
        {
          "price": 210,
          "patch": {
            "sensors.optics": 0.09,
            "sensors.sight_tiles": 1
          }
        },
        {
          "price": 315,
          "patch": {
            "sensors.optics": 0.17,
            "sensors.sight_tiles": 2
          }
        },
        {
          "price": 440,
          "patch": {
            "sensors.optics": 0.28,
            "sensors.sight_tiles": 3
          }
        }
      ]
    },
    "firepower": {
      "tiers": [
        {
          "price": 315,
          "patch": {
            "weapons[0].accuracy": 0.03,
            "weapons[0].penetration": 10
          }
        },
        {
          "price": 470,
          "patch": {
            "weapons[0].accuracy": 0.06,
            "weapons[0].penetration": 19
          }
        },
        {
          "price": 660,
          "patch": {
            "weapons[0].accuracy": 0.1,
            "weapons[0].penetration": 30
          }
        }
      ]
    }
  }
}
```

### Rifle Squad (`inf_squad`)

Role `infantry`, logistics 292. Tracks: armour, sensors, firepower. Total credits to max every track: **1655**.

**Measured at max tier:** Exercises the urban assault force-ratio target AND the Lanchester target directly (both scenarios spawn only `inf_squad`). Sensors-track sight_tiles is capped at +1/+2/+2 (tier 3 does NOT step up from tier 2), not the generic +1/+2/+3 — see §4.3.
Power score (this document's own re-derivation of `validate_balance.py`'s curve): 1.01 → 1.19 at max tier (+18%); the base curve prices that much power at 283→306 logistics against its actual 292.

```json
{
  "upgrades": {
    "armour": {
      "tiers": [
        {
          "price": 115,
          "patch": {
            "hull.hp": 28,
            "hull.armor.front": 1,
            "hull.armor.side": 1,
            "hull.armor.rear": 1
          }
        },
        {
          "price": 175,
          "patch": {
            "hull.hp": 60,
            "hull.armor.front": 2,
            "hull.armor.side": 2,
            "hull.armor.rear": 2
          }
        },
        {
          "price": 250,
          "patch": {
            "hull.hp": 100,
            "hull.armor.front": 2,
            "hull.armor.side": 2,
            "hull.armor.rear": 2
          }
        }
      ]
    },
    "sensors": {
      "tiers": [
        {
          "price": 95,
          "patch": {
            "sensors.optics": 0.08,
            "sensors.sight_tiles": 1
          }
        },
        {
          "price": 145,
          "patch": {
            "sensors.optics": 0.15,
            "sensors.sight_tiles": 2
          }
        },
        {
          "price": 205,
          "patch": {
            "sensors.optics": 0.25,
            "sensors.sight_tiles": 2
          }
        }
      ]
    },
    "firepower": {
      "tiers": [
        {
          "price": 145,
          "patch": {
            "weapons[0].accuracy": 0.03,
            "weapons[0].penetration": 1
          }
        },
        {
          "price": 220,
          "patch": {
            "weapons[0].accuracy": 0.06,
            "weapons[0].penetration": 1
          }
        },
        {
          "price": 305,
          "patch": {
            "weapons[0].accuracy": 0.1,
            "weapons[0].penetration": 2
          }
        }
      ]
    }
  }
}
```

### Shoded Jeep (`jeep_shoded`)

Role `apc`, logistics 317. Tracks: armour, sensors, firepower. Total credits to max every track: **1805**.

**Measured at max tier:** not exercised by name in any §5.7 scenario (no target spawns this type); its contribution to the combined all-17 `pnpm balance` pass (§4.5) and to the cost-curve check (§5) is the measurement on record for it.
Power score (this document's own re-derivation of `validate_balance.py`'s curve): 1.29 → 1.46 at max tier (+13%); the base curve prices that much power at 318→337 logistics against its actual 317.

```json
{
  "upgrades": {
    "armour": {
      "tiers": [
        {
          "price": 125,
          "patch": {
            "hull.hp": 36,
            "hull.armor.front": 1,
            "hull.armor.side": 1,
            "hull.armor.rear": 1
          }
        },
        {
          "price": 190,
          "patch": {
            "hull.hp": 78,
            "hull.armor.front": 2,
            "hull.armor.side": 2,
            "hull.armor.rear": 2
          }
        },
        {
          "price": 270,
          "patch": {
            "hull.hp": 130,
            "hull.armor.front": 4,
            "hull.armor.side": 2,
            "hull.armor.rear": 2
          }
        }
      ]
    },
    "sensors": {
      "tiers": [
        {
          "price": 105,
          "patch": {
            "sensors.optics": 0.08,
            "sensors.sight_tiles": 1
          }
        },
        {
          "price": 160,
          "patch": {
            "sensors.optics": 0.15,
            "sensors.sight_tiles": 2
          }
        },
        {
          "price": 220,
          "patch": {
            "sensors.optics": 0.25,
            "sensors.sight_tiles": 3
          }
        }
      ]
    },
    "firepower": {
      "tiers": [
        {
          "price": 160,
          "patch": {
            "weapons[0].accuracy": 0.03,
            "weapons[0].penetration": 2
          }
        },
        {
          "price": 240,
          "patch": {
            "weapons[0].accuracy": 0.06,
            "weapons[0].penetration": 4
          }
        },
        {
          "price": 335,
          "patch": {
            "weapons[0].accuracy": 0.1,
            "weapons[0].penetration": 6
          }
        }
      ]
    }
  }
}
```

### Lavi MBT (`mbt_lavi`)

Role `mbt`, logistics 906. Tracks: armour, sensors, firepower. Total credits to max every track: **5150**.

**Measured at max tier:** Its hull is the live basis for `MBT_BARE`, the ATGM Pk target's "unprotected armour" stand-in (`tools/src/backtest/harness.ts`), so its OWN armour track feeds a target it is not otherwise in. Armour-track percentages are cut to 2/3.5/5% of base armor (hp keeps the generic 7/15/25%) — see §4.2.
Power score (this document's own re-derivation of `validate_balance.py`'s curve): 13.77 → 17.53 at max tier (+27%); the base curve prices that much power at 954→1068 logistics against its actual 906.

```json
{
  "upgrades": {
    "armour": {
      "tiers": [
        {
          "price": 360,
          "patch": {
            "hull.hp": 210,
            "hull.armor.front": 14,
            "hull.armor.side": 6,
            "hull.armor.rear": 3
          }
        },
        {
          "price": 545,
          "patch": {
            "hull.hp": 450,
            "hull.armor.front": 25,
            "hull.armor.side": 11,
            "hull.armor.rear": 5
          }
        },
        {
          "price": 770,
          "patch": {
            "hull.hp": 750,
            "hull.armor.front": 35,
            "hull.armor.side": 15,
            "hull.armor.rear": 8
          }
        }
      ]
    },
    "sensors": {
      "tiers": [
        {
          "price": 300,
          "patch": {
            "sensors.optics": 0.1,
            "sensors.sight_tiles": 1
          }
        },
        {
          "price": 455,
          "patch": {
            "sensors.optics": 0.18,
            "sensors.sight_tiles": 2
          }
        },
        {
          "price": 635,
          "patch": {
            "sensors.optics": 0.3,
            "sensors.sight_tiles": 3
          }
        }
      ]
    },
    "firepower": {
      "tiers": [
        {
          "price": 455,
          "patch": {
            "weapons[0].accuracy": 0.03,
            "weapons[0].penetration": 104
          }
        },
        {
          "price": 680,
          "patch": {
            "weapons[0].accuracy": 0.06,
            "weapons[0].penetration": 208
          }
        },
        {
          "price": 950,
          "patch": {
            "weapons[0].accuracy": 0.1,
            "weapons[0].penetration": 325
          }
        }
      ]
    }
  }
}
```

### 60mm Mortar Team (`mortar_team`)

Role `artillery`, logistics 209. Tracks: armour, sensors, firepower. Total credits to max every track: **1190**.

**Measured at max tier:** not exercised by name in any §5.7 scenario (no target spawns this type); its contribution to the combined all-17 `pnpm balance` pass (§4.5) and to the cost-curve check (§5) is the measurement on record for it.
Power score (this document's own re-derivation of `validate_balance.py`'s curve): 0.55 → 0.69 at max tier (+24%); the base curve prices that much power at 214→237 logistics against its actual 209.

```json
{
  "upgrades": {
    "armour": {
      "tiers": [
        {
          "price": 85,
          "patch": {
            "hull.hp": 25,
            "hull.armor.front": 1,
            "hull.armor.side": 1,
            "hull.armor.rear": 1
          }
        },
        {
          "price": 125,
          "patch": {
            "hull.hp": 52,
            "hull.armor.front": 2,
            "hull.armor.side": 2,
            "hull.armor.rear": 2
          }
        },
        {
          "price": 180,
          "patch": {
            "hull.hp": 88,
            "hull.armor.front": 2,
            "hull.armor.side": 2,
            "hull.armor.rear": 2
          }
        }
      ]
    },
    "sensors": {
      "tiers": [
        {
          "price": 70,
          "patch": {
            "sensors.optics": 0.07,
            "sensors.sight_tiles": 1
          }
        },
        {
          "price": 105,
          "patch": {
            "sensors.optics": 0.14,
            "sensors.sight_tiles": 2
          }
        },
        {
          "price": 145,
          "patch": {
            "sensors.optics": 0.23,
            "sensors.sight_tiles": 3
          }
        }
      ]
    },
    "firepower": {
      "tiers": [
        {
          "price": 105,
          "patch": {
            "weapons[0].accuracy": 0.03,
            "weapons[0].penetration": 2
          }
        },
        {
          "price": 155,
          "patch": {
            "weapons[0].accuracy": 0.06,
            "weapons[0].penetration": 5
          }
        },
        {
          "price": 220,
          "patch": {
            "weapons[0].accuracy": 0.1,
            "weapons[0].penetration": 8
          }
        }
      ]
    }
  }
}
```

### Recon Drone (`recon_drone`)

Role `drone`, logistics 210. Tracks: armour, sensors. Total credits to max every track: **710**.

**Measured at max tier:** not exercised by name in any §5.7 scenario (no target spawns this type); its contribution to the combined all-17 `pnpm balance` pass (§4.5) and to the cost-curve check (§5) is the measurement on record for it.
Power score (this document's own re-derivation of `validate_balance.py`'s curve): 0.56 → 0.65 at max tier (+16%); the base curve prices that much power at 216→231 logistics against its actual 210.

```json
{
  "upgrades": {
    "armour": {
      "tiers": [
        {
          "price": 85,
          "patch": {
            "hull.hp": 8,
            "hull.armor.front": 0,
            "hull.armor.side": 0,
            "hull.armor.rear": 0
          }
        },
        {
          "price": 125,
          "patch": {
            "hull.hp": 18,
            "hull.armor.front": 0,
            "hull.armor.side": 0,
            "hull.armor.rear": 0
          }
        },
        {
          "price": 180,
          "patch": {
            "hull.hp": 30,
            "hull.armor.front": 0,
            "hull.armor.side": 0,
            "hull.armor.rear": 0
          }
        }
      ]
    },
    "sensors": {
      "tiers": [
        {
          "price": 70,
          "patch": {
            "sensors.optics": 0.16,
            "sensors.sight_tiles": 1
          }
        },
        {
          "price": 105,
          "patch": {
            "sensors.optics": 0.3,
            "sensors.sight_tiles": 2
          }
        },
        {
          "price": 145,
          "patch": {
            "sensors.optics": 0.5,
            "sensors.sight_tiles": 3
          }
        }
      ]
    }
  }
}
```

### Shachaf Scout Car (`scout_shachaf`)

Role `recon`, logistics 410. Tracks: armour, sensors, firepower. Total credits to max every track: **2330**.

**Measured at max tier:** not exercised by name in any §5.7 scenario (no target spawns this type); its contribution to the combined all-17 `pnpm balance` pass (§4.5) and to the cost-curve check (§5) is the measurement on record for it.
Power score (this document's own re-derivation of `validate_balance.py`'s curve): 2.16 → 2.66 at max tier (+23%); the base curve prices that much power at 404→445 logistics against its actual 410.

```json
{
  "upgrades": {
    "armour": {
      "tiers": [
        {
          "price": 165,
          "patch": {
            "hull.hp": 63,
            "hull.armor.front": 9,
            "hull.armor.side": 5,
            "hull.armor.rear": 4
          }
        },
        {
          "price": 245,
          "patch": {
            "hull.hp": 135,
            "hull.armor.front": 20,
            "hull.armor.side": 11,
            "hull.armor.rear": 8
          }
        },
        {
          "price": 350,
          "patch": {
            "hull.hp": 225,
            "hull.armor.front": 32,
            "hull.armor.side": 19,
            "hull.armor.rear": 12
          }
        }
      ]
    },
    "sensors": {
      "tiers": [
        {
          "price": 135,
          "patch": {
            "sensors.optics": 0.15,
            "sensors.sight_tiles": 1
          }
        },
        {
          "price": 205,
          "patch": {
            "sensors.optics": 0.28,
            "sensors.sight_tiles": 2
          }
        },
        {
          "price": 285,
          "patch": {
            "sensors.optics": 0.47,
            "sensors.sight_tiles": 3
          }
        }
      ]
    },
    "firepower": {
      "tiers": [
        {
          "price": 205,
          "patch": {
            "weapons[0].accuracy": 0.03,
            "weapons[0].penetration": 1
          }
        },
        {
          "price": 310,
          "patch": {
            "weapons[0].accuracy": 0.06,
            "weapons[0].penetration": 3
          }
        },
        {
          "price": 430,
          "patch": {
            "weapons[0].accuracy": 0.1,
            "weapons[0].penetration": 4
          }
        }
      ]
    }
  }
}
```

### Sniper Team (`sniper_team`)

Role `sniper`, logistics 260. Tracks: armour, sensors, firepower. Total credits to max every track: **1475**.

**Measured at max tier:** not exercised by name in any §5.7 scenario (no target spawns this type); its contribution to the combined all-17 `pnpm balance` pass (§4.5) and to the cost-curve check (§5) is the measurement on record for it.
Power score (this document's own re-derivation of `validate_balance.py`'s curve): 0.89 → 1.04 at max tier (+17%); the base curve prices that much power at 268→288 logistics against its actual 260.

```json
{
  "upgrades": {
    "armour": {
      "tiers": [
        {
          "price": 105,
          "patch": {
            "hull.hp": 21,
            "hull.armor.front": 1,
            "hull.armor.side": 1,
            "hull.armor.rear": 1
          }
        },
        {
          "price": 155,
          "patch": {
            "hull.hp": 45,
            "hull.armor.front": 2,
            "hull.armor.side": 2,
            "hull.armor.rear": 2
          }
        },
        {
          "price": 220,
          "patch": {
            "hull.hp": 75,
            "hull.armor.front": 2,
            "hull.armor.side": 2,
            "hull.armor.rear": 2
          }
        }
      ]
    },
    "sensors": {
      "tiers": [
        {
          "price": 85,
          "patch": {
            "sensors.optics": 0.13,
            "sensors.sight_tiles": 1
          }
        },
        {
          "price": 130,
          "patch": {
            "sensors.optics": 0.24,
            "sensors.sight_tiles": 2
          }
        },
        {
          "price": 180,
          "patch": {
            "sensors.optics": 0.4,
            "sensors.sight_tiles": 3
          }
        }
      ]
    },
    "firepower": {
      "tiers": [
        {
          "price": 130,
          "patch": {
            "weapons[0].accuracy": 0.03,
            "weapons[0].penetration": 4
          }
        },
        {
          "price": 195,
          "patch": {
            "weapons[0].accuracy": 0.06,
            "weapons[0].penetration": 7
          }
        },
        {
          "price": 275,
          "patch": {
            "weapons[0].accuracy": 0.1,
            "weapons[0].penetration": 11
          }
        }
      ]
    }
  }
}
```

### Yahalom Engineers (`yahalom_squad`)

Role `engineer`, logistics 260. Tracks: armour, sensors, firepower. Total credits to max every track: **1475**.

**Measured at max tier:** not exercised by name in any §5.7 scenario (no target spawns this type); its contribution to the combined all-17 `pnpm balance` pass (§4.5) and to the cost-curve check (§5) is the measurement on record for it.
Power score (this document's own re-derivation of `validate_balance.py`'s curve): 0.90 → 1.16 at max tier (+28%); the base curve prices that much power at 270→302 logistics against its actual 260.

```json
{
  "upgrades": {
    "armour": {
      "tiers": [
        {
          "price": 105,
          "patch": {
            "hull.hp": 27,
            "hull.armor.front": 1,
            "hull.armor.side": 1,
            "hull.armor.rear": 1
          }
        },
        {
          "price": 155,
          "patch": {
            "hull.hp": 57,
            "hull.armor.front": 2,
            "hull.armor.side": 2,
            "hull.armor.rear": 2
          }
        },
        {
          "price": 220,
          "patch": {
            "hull.hp": 95,
            "hull.armor.front": 2,
            "hull.armor.side": 2,
            "hull.armor.rear": 2
          }
        }
      ]
    },
    "sensors": {
      "tiers": [
        {
          "price": 85,
          "patch": {
            "sensors.optics": 0.08,
            "sensors.sight_tiles": 1
          }
        },
        {
          "price": 130,
          "patch": {
            "sensors.optics": 0.15,
            "sensors.sight_tiles": 2
          }
        },
        {
          "price": 180,
          "patch": {
            "sensors.optics": 0.25,
            "sensors.sight_tiles": 3
          }
        }
      ]
    },
    "firepower": {
      "tiers": [
        {
          "price": 130,
          "patch": {
            "weapons[0].accuracy": 0.03,
            "weapons[0].penetration": 1
          }
        },
        {
          "price": 195,
          "patch": {
            "weapons[0].accuracy": 0.06,
            "weapons[0].penetration": 1
          }
        },
        {
          "price": 275,
          "patch": {
            "weapons[0].accuracy": 0.1,
            "weapons[0].penetration": 2
          }
        }
      ]
    }
  }
}
```

## 4. Finding the four deltas that broke a target, and shrinking them

The generic percentage curve in §3 was applied to all seventeen types and run
through `pnpm balance` first; it FAILED two of the five targets. Each failure was
isolated to one unit and one track by re-applying tracks individually (armour
alone, sensors alone, firepower alone) and re-running the single affected target
directly (`npx tsx -e "import {…} from './tools/src/backtest/targets'; …"`),
never the whole five-target suite, to keep each isolation cheap.

### 4.1 `at_team` firepower — ATGM Pk margin

Generic tier 3 (+0.10 accuracy, penetration 900→1125) alone measured **0.79** —
inside the 0.60–0.80 band but one point under the ceiling, with the deterministic
400-launch measurement giving zero run-to-run margin against a later stat nudge.
Shrinking tier 3's accuracy delta to +0.07 (penetration delta unchanged) measured
**0.77**. Tiers 1–2 (+0.03/+0.06) were unaffected and unchanged.

### 4.2 `mbt_lavi` armour — contaminates the ATGM Pk target through `MBT_BARE`

`MBT_BARE` (`tools/src/backtest/harness.ts`) is `{ ...units.mbt_lavi, weapons: [] }`
— a LIVE spread of `mbt_lavi`'s own hull, taken at import time. Any front-armour
delta on `mbt_lavi` is therefore also a delta on the ATGM Pk target's
"unprotected armour" stand-in, which the target was never meant to move at all.
Generic tier 3 (front 700→875, +25%) alone measured **0.39** — the Spike's 900
penetration stops comfortably beating 875 armour once the `phi()` model's
penetration-vs-armour margin narrows, and the target's floor is 0.60. Binary
search on front-armour percentage alone (hp unaffected — Pk depends only on
armour, so hp keeps the generic 7/15/25%): +10% → 0.60 (exactly on the floor, no
margin); +5% → 0.64. Cut to 2/3.5/5% of base for armour only, keeping the same
three-tier shape. Side and rear scale with the same percentage.

### 4.3 `inf_squad` sensors — collapses the urban assault force-ratio target

Generic tier 3 (`sight_tiles` 8→11, optics 1.0→1.25) alone measured 3:1 → **35%**,
down from the 100% baseline, and NON-monotone against 2:1's 52% — a result the
target's own pass condition (`3:1 ≥ 65%` AND `3:1 ≥ 2:1 + 15pp`) is built to
catch and did. Isolating further: optics alone (sight unchanged) measured 98% —
harmless; sight_tiles alone (+3, optics unchanged) measured 43% — the whole
effect. The mechanism: `inf_squad`'s rifle has an 8-tile weapon range that
exactly equals its base sight; extending sight past weapon range lets the
attacking squads DETECT the militia three tiles before they can effectively
engage, so `attackMove` groups start trading at long range piecemeal instead of
closing as a formation, and the assault stalls out past the scenario's 300 s
clock. +1 sight (9) measured clean (3:1=100%); +2 (10) measured clean (3:1=72%,
2:1=45%); +3 (11) is the one that breaks. Capped sensors-track sight_tiles at
+1/+2/+2 (tier 3 does not step past tier 2); optics keeps the generic curve.
This is a genuine model interaction worth carrying forward (§7.1): sight beyond
a unit's own weapon range is not free for a close-range type in this harness.

### 4.4 `heli_peten` armour — erases the air-contested-by-AA target's whole point

Generic tier 3 (hp 640→800, armor 45/28/20→56/35/25, +25%) alone measured 3-gun-
truck survival at **97%**, against a 0% baseline and the target's own ≤50% cap —
a maxed gunship shrugs off the battery the target exists to prove punishes a
pass. Firepower and sensors tracks alone were each measured clean (77%/0%/0% and
90%/0%/0% respectively vs the 1/2/3-truck cases) — the armour track alone is the
cause. Binary search on the armour percentage (hp and armor scaled together):
+15% → 3-truck 60% (fails); +12% → 3-truck **10%** (clean, comfortable margin).
Cut to 5/8/12% of base for the armour track only; sensors and firepower keep the
generic curve.

### 4.5 The combined pass, all 17 at max tier together

With all four caps applied, `pnpm balance` was re-run with every one of the
seventeen KDF types patched to its own maximum tier on every track
SIMULTANEOUSLY (the required pass per the brief):

| target | base | max tier (all 17) | pass |
|---|---|---|---|
| ATGM Pk vs unprotected armour | 0.67 | **0.77** | PASS (band 0.60–0.80) |
| APS intercept vs shaped charge | 0.73 | **0.73** | PASS (unaffected — `aps` is not a whitelisted field) |
| Urban assault force ratio | 3:1=100% | 1:1=0% 2:1=55% **3:1=80%** 4:1=98% | PASS (3:1≥65%, 2:1≤85% and ≤3:1−15pp, 4:1≥3:1−10pp) |
| Lanchester square law | 12v6=12.0, 16v8=16.0 | 12v6=12.0, 16v8=16.0 | PASS (unaffected — mirror match, symmetric buff) |
| Air is contested by AA | 1aa=80% 3aa=0% | **1aa=100% 3aa=30%** | PASS (≥50% at 1, ≤50% at 3, falling) |

Isolated single-unit confirmations (that unit alone maxed, roster otherwise base)
reproduce the combined numbers exactly for the target each unit is named in:
`inf_squad` alone → urban ratio 3:1=80% (identical); `at_team` alone → ATGM Pk
0.77 (identical, since `mbt_lavi` is unmodified in that run — 0.79 was the
earlier, unshrunk at_team-only reading, restated in §4.1); `mbt_lavi` alone →
ATGM Pk 0.64 (its own contribution, at_team unmodified); `heli_peten` alone →
air-contested 1aa=100% 3aa=30% (identical).

## 5. The cost-curve factor k

`tools/validate_balance.py` prices every unit from an additively-weighted power
score (offense 0.45, defense 0.35, mobility 0.20, each normalised against the
roster median) and fits `cost = exp(b) * power^a` by least squares over the whole
roster's `(power, logistics + intel*2.5)` pairs. On this roster, unmodified:

```
base curve: cost = 282.317 * power^0.465
```

Running the validator itself at max tier (patching all 17, then re-running
`validate_balance.py`, which REFITS the curve from whatever roster it is given)
is the wrong instrument for this check and was tried first to see why: refitting
against an entire roster where 17 of 32 units got measurably stronger while their
LISTED `cost.logistics` stayed exactly the same (upgrades never touch `cost` —
it is not in the whitelist) drags the fitted exponent from 0.465 to 0.426 and
pushes `sarim_rifles`, an ENEMY-faction unit this document never touches, from
+14.1% to +19.3% — over the tool's own ±18% gate — purely as a side effect of
everyone else's power moving. That is a refit artifact, not a statement about
whether the upgrade prices are fair, and re-running the raw gate this way would
make an unrelated faction's balance depend on this document's tuning.

The check the brief asks for instead treats credits as a SEPARATE currency from
logistics and asks: does `logistics + k * (total credits to max every track)`
land within the SAME ±18% band the base curve already uses, when compared
against what the BASE curve (fitted once, before any upgrade existed, over the
full un-upgraded roster including every enemy-faction unit) says that unit's
MAX-TIER power should cost? `total credits to max every track` is read at the
UNIT level (the sum of every tier's price across every track that unit has) —
the brief's phrase "sum of the track's tier prices" is somewhat ambiguous
between a single track and a unit's whole set; unit-level is used here because
power itself is a unit-level score that no single track cleanly separates (the
sensors track, for instance, feeds the MOBILITY axis, and armour feeds DEFENSE,
but a unit's overall power score sums all three axes together).

k was found by computing, per unit, the EXACT k that would make
`logistics + k*total_price == expected_max` (`k_exact`), then checking round
candidate values against every unit's deviation:

| unit | logistics | power base→max | expected max | total credits to max | k_exact |
|---|---|---|---|---|---|
| apc_eitan | 520 | 3.54→4.68 | 578 | 2950 | 0.020 |
| apc_kipod | 562 | 4.55→6.15 | 656 | 3190 | 0.030 |
| at_team | 236 | 0.69→0.84 | 261 | 1345 | 0.018 |
| attack_drone | 300 | 0.82→0.90 | 269 | 410 (re-priced from 1705) | -0.076 |
| breach_team | 306 | 1.16→1.32 | 321 | 1740 | 0.009 |
| demo_squad | 300 | 1.00→1.25 | 314 | 1705 | 0.008 |
| dozer_d9 | 586 | 4.60→6.46 | 672 | 1985 | 0.043 |
| heli_peten | 402 | 2.08→2.31 | 417 | 2275 | 0.007 |
| ifv_namer | 630 | 6.20→8.58 | 766 | 3575 | 0.038 |
| inf_squad | 292 | 1.01→1.19 | 306 | 1655 | 0.009 |
| jeep_shoded | 317 | 1.29→1.46 | 337 | 1805 | 0.011 |
| mbt_lavi | 906 | 13.77→17.53 | 1068 | 5150 | 0.031 |
| mortar_team | 209 | 0.55→0.69 | 237 | 1190 | 0.024 |
| recon_drone | 210 | 0.56→0.65 | 231 | 710 | 0.029 |
| scout_shachaf | 410 | 2.16→2.66 | 445 | 2330 | 0.015 |
| sniper_team | 260 | 0.89→1.04 | 288 | 1475 | 0.019 |
| yahalom_squad | 260 | 0.90→1.16 | 302 | 1475 | 0.029 |

`k_exact` (computed against the ORIGINAL 1705-credit `attack_drone` price)
ranged -0.018 (`attack_drone`) to 0.043 (`dozer_d9`), median 0.019, mean 0.019 —
a tight cluster except for one outlier. `attack_drone` has since been re-priced
(§7.4) to 410 total credits, which moves its own `k_exact` to **-0.076** (a
LARGER outlier by this per-unit metric — logistics alone, 300, already exceeds
its 269 expected-max, so no positive k fits it exactly) while median (0.019,
determined by the 9th of 17 values, unaffected by the extreme) and mean
(0.019→0.016) barely move. `k_exact` is a diagnostic, not the gate: what matters
is deviation at the fixed k actually shipped. Checking round values of k against
the ±18% band, now that `attack_drone` carries its re-priced total:

| k | units outside ±18% |
|---|---|
| 0.010 | none |
| 0.015 | none |
| **0.020** | **none — `attack_drone` +14.6%, every other unit −13.1%…+7.3%** |
| 0.030 | none |
| 0.040 | `heli_peten` (+18.2%, on the line) |

**k = 0.02.** All seventeen units now sit inside a −13.1%…+14.6% band, well
inside ±18%. `attack_drone` was the one unit outside it at every k from 0.01 to
0.04 (+21.0% to +36.8%) before the re-price: its offense score is already close
to `MAX_ENGAGE_RATE` (6 kills/min, `validate_balance.py`'s own ceiling on a
single weapon's scored rate) at BASE stats — a `rof_per_min` of 6 firing a single
shaped charge — so spending on `weapons[0].accuracy` / `.penetration` buys little
additional SCORED power even though the unit is genuinely a bit deadlier. Power
still moves from only 0.82 to 0.90 (+10%) at max tier, exactly as before — the
patches were never the problem. What changed is price: since that 10% power
gain is real but small, `attack_drone`'s total credits to max were cut from 1705
to 410 (§7.4), which reads +14.6% here (was +24.2%) — 3.4 points inside the
band rather than 6.2 points outside it.

## 6. Budget arithmetic

**Sum of every tier's price, every track, all seventeen types: 36260.**
Per-unit totals are in §3 and §8. Summed by tier across the whole catalogue:

tier 1 across all tracks/types: 7860; tier 2: 11805; tier 3: 16595; cumulative 7860/19665/36260.

### 6.1 The core force, tier 1: does 2772 (half the ★★ ladder) buy it

The brief names "rifle squad, Eitan/Namer, Lavi, at_team, mortar" as the core
force. Reading Eitan/Namer as the one IFV/APC slot the roster actually fields —
`ifv_namer` — and summing tier 1 of EVERY track for those five units:

`inf_squad` + `ifv_namer` + `mbt_lavi` + `at_team` + `mortar_team`, tier 1 of every
track each: **2800** credits — against the 2772 target, a 1.0% shortfall.
Reading Eitan instead of Namer for the APC/IFV slot gives 2665 (3.9% short).
Either way this is the fit the brief calls "roughly the first tier": both land
inside 4% of the target with no numbers forced to match it.

### 6.2 A purchase-order simulation

Two orderings were run, since "a sensible purchase order" is not specified
further and the two readings diverge in what they show at the full-ladder budget:

**Core-first** — buy every core-force track's tier 1 before any tier 2, then every
core track's tier 2 before any tier 3, then move on to the rest of the roster the
same way (this is the ordering a player fielding the same five units every
mission would actually follow — finish making today's force better before
starting on a unit not yet in the rotation).

**Cheapest-first** — a flat greedy sort of every (unit, track, tier) purchase by
price, respecting only that a track's tier N needs tier N−1 already bought (the
ordering a completionist chasing breadth would follow).

| budget | core-first result | cheapest-first result |
|---|---|---|
| 2772 (★★ half-ladder) | spent 2765: **tier 1 on every track of all five core units** (armour/sensors/firepower for at_team, ifv_namer, inf_squad, mbt_lavi; armour+sensors for mortar_team, one sensors tier left on recon_drone) | spent 2770: tier 1–2 scattered across ten CHEAP units (at_team, attack_drone, breach_team, demo_squad, inf_squad, jeep_shoded, mortar_team ×2, recon_drone ×2, sniper_team, yahalom_squad) — none of the three big vehicles (`ifv_namer`, `mbt_lavi`, `apc_eitan`) touched at all |
| 5544 (full ★★ ladder) | spent 5505: **tier 2 on every track of at_team/ifv_namer/inf_squad/mbt_lavi/mortar_team** (mbt_lavi firepower stops at tier 1) — no tier 3 reached anywhere | spent 5500: tier 2–3 on the same ten cheap units (mortar_team and recon_drone both reach sensors tier 3) — the three big vehicles still untouched |
| 11088 (2× ★★ ladder) | spent 11075: **every core-force track at tier 3** except mbt_lavi firepower (tier 2) and mortar_team (tier 2); one recon_drone sensors tier bought on the side | spent 11055: every cheap unit maxed or near it (14 of 17 types touched), the three big vehicles STILL untouched |

The task target reads "the full ladder (5544) spent on nothing else should reach
most tier-2s and a few tier-3s." Core-first at 5544 reaches tier 2 broadly but
ZERO tier-3s — a genuine miss against that phrasing, recorded in §7.5.
Cheapest-first DOES reach a few tier-3s at the same budget (`mortar_team`
sensors, `recon_drone` sensors) but at the cost of never touching the three
biggest, most expensive vehicles at any tier — which fits "a few tier-3s" and
badly fits "most tier-2s" for the force a player is actually fielding. Neither
single ordering satisfies both halves of the phrase at once; §7.5 records this
rather than picking numbers that would make one ordering fit by construction.

### 6.3 Maxing everything

36260 credits maxes every track of all seventeen types — **6.5× the ★★ ladder total (5544)**, 6.3× the ★★★ total (5784). That is several campaigns' worth of
earning with nothing else bought, which matches D4's own framing ("the account
survives a fresh campaign") — the long tail is intended, not a pricing miss.

## 7. Findings against the spec's assumptions

1. **A close-range infantry unit's sensors track has a real ceiling below the
   generic curve, and it is a MODEL interaction, not a pricing choice**
   (§4.3). `inf_squad`'s base sight (8) already equals its rifle's `range_tiles`
   (8); pushing sight three tiles past that made a 3:1 assault WORSE than a 2:1
   one on the urban force-ratio target, because units start trading at range
   before the assault ever closes as a formation. Any future sensors track on a
   short-ranged type (small_arms, most infantry roles) should be checked against
   its own weapon's `range_tiles`, not assumed safe from the generic percentage.
2. **`MBT_BARE` is a live copy of `mbt_lavi`'s hull, so `mbt_lavi`'s own armour
   track is quietly load-bearing for a target it does not otherwise appear in**
   (§4.2). This is a harness property (`tools/src/backtest/harness.ts`), not a
   defect in this document's method, but it means any FUTURE tuning of
   `mbt_lavi`'s base armour, upgrade or otherwise, should re-check the ATGM Pk
   target explicitly — nothing else in `pnpm balance` would catch a regression
   there, since `mbt_lavi` fields no weapon in that scenario.
3. **`heli_peten`'s armour is the single stat this catalogue can least afford to
   inflate.** A generic 25% hp/armor bump at tier 3 took a gun-truck battery
   from a 0% gunship survival rate to 97% — erasing the entire point of the
   "air is contested by weight of AA" target, which exists specifically because
   nothing else in `pnpm balance` measures the air domain at all. Capped at 12%.
4. **`attack_drone` was the one unit whose upgrade credits bought the least
   power** by the cost-curve's own model, because its offense score is already
   close to `MAX_ENGAGE_RATE` at base stats (§5) — a low-rate-of-fire loitering
   munition whose accuracy/penetration headroom is capped by the model's own
   engagement-rate ceiling before its price curve even enters the picture. Not
   a §5.7 failure, but it DID fail the max-tier cost-curve gate once that gate
   shipped as `tools/validate_balance.py --units data/units --max-tier
   --upgrade-cost-factor 0.02`: +21.5% against that tool's own refit curve,
   +24.2% against this document's static-baseline method (§5) — outside the
   ±18% band either way. **Resolved by re-pricing, not by re-deriving the
   patches**, since the finding above already says the deltas buy almost no
   scored power: offense moved only 0.82→0.90 (+10%) for the original 1705
   credits, the least power-per-credit of any of the seventeen types, so the
   spend was the wrong side to defend. `data/units/kdf/attack_drone.json`'s
   three tracks keep their exact patches and lose most of their price — armour
   120/180/255→30/45/60 (555→135), sensors 100/150/210→25/35/50 (460→110),
   firepower 150/225/315→35/55/75 (690→165), total 1705→410. That reads +12.4%
   on the shipped gate and +14.6% on this document's static-baseline method
   (§5), both comfortably inside ±18%. The underlying model property — an
   engagement-rate cap that makes firepower spend on a low-RoF weapon nearly
   free in POWER terms even when it is real in DAMAGE terms — still stands and
   is still worth flagging for whoever owns the cost-curve model; what changed
   here is the content, not the model.
5. **"Most tier-2s and a few tier-3s" at the full ladder (5544) is not
   producible from a single purchase order** (§6.2). A core-force-first order
   (the one a player who fields the same five units every mission would follow)
   reaches tier 2 broadly and ZERO tier-3s at 5544; a cheapest-first order
   reaches a few tier-3s but never touches the roster's three most expensive
   vehicles. The phrase describes neither ordering exactly — it is closer to a
   BLEND (tier-2 the core, tier-3 the cheap support types) that no single greedy
   rule produces. Recorded rather than forced: shrinking every price to make one
   ordering hit both halves of the phrase would have meant re-deriving prices
   against a purchase-order target instead of against the campaign ladder and
   the cost curve, which is a different (and unstated) fitting target.
6. **Maxing every track measurably changes what the pinned optimal-play ladder
   does, even though `creditsFor` never reads unit stats** (`pnpm playtest`,
   run once with every KDF type patched to its own max tier and restored
   afterward — not committed, and `playtest.ts` was NOT edited, per the brief).
   Two of the ladder's nineteen plain victory lines FLIP outcome:
   `khan_rafid_1_recon` (VICTORY in 0.5 min at base → ONGOING at the 20-minute
   ceiling at max tier — the scripted recon plan's fixed waypoints and timings
   no longer clear the mission when every unit's stats have moved) and
   `qarn_hadid_3_clearance` (VICTORY, ROE 80 at base → DEFEAT, ROE 97 at max
   tier — `get_the_families_clear` flips from complete to failed). The pinned
   ladder total moves from **5544 to 5181 (−6.5%)** as a direct consequence —
   not because `creditsFor` was touched, but because the SIMULATED outcome of
   the same fixed orders differs when the units executing them are stronger.
   Every star-gate assertion the harness pins also reads fewer cumulative stars
   at max tier (`breach_team`'s gate opens at 10 stars instead of 12 by mission
   6, etc.) for the same reason. This is not a defect in this document's prices
   — `playtest.ts` has no max-tier mode (the brief is explicit that building one
   is future work) and its scripted plans were authored and tuned entirely
   against BASE stats, so a plan overshooting or undershooting a scripted
   waypoint once the units behind it move faster or kill more per volley is
   exactly the kind of drift a fixed-script harness cannot absorb. It is
   recorded here as a heads-up for whoever builds that mode: the max-tier
   ladder total and the star-gate timings are NOT going to match §2's numbers
   unmodified, and the two flipped missions are worth checking by hand rather
   than assuming they are harness noise.

## 8. Summary

| type | tracks | tiers | total price |
|---|---|---|---|
| apc_eitan | 3 (armour, sensors, firepower) | 3 | 2950 |
| apc_kipod | 3 (armour, sensors, firepower) | 3 | 3190 |
| at_team | 3 (armour, sensors, firepower) | 3 | 1345 |
| attack_drone | 3 (armour, sensors, firepower) | 3 | 410 |
| breach_team | 3 (armour, sensors, firepower) | 3 | 1740 |
| demo_squad | 3 (armour, sensors, firepower) | 3 | 1705 |
| dozer_d9 | 2 (armour, sensors) | 3 | 1985 |
| heli_peten | 3 (armour, sensors, firepower) | 3 | 2275 |
| ifv_namer | 3 (armour, sensors, firepower) | 3 | 3575 |
| inf_squad | 3 (armour, sensors, firepower) | 3 | 1655 |
| jeep_shoded | 3 (armour, sensors, firepower) | 3 | 1805 |
| mbt_lavi | 3 (armour, sensors, firepower) | 3 | 5150 |
| mortar_team | 3 (armour, sensors, firepower) | 3 | 1190 |
| recon_drone | 2 (armour, sensors) | 3 | 710 |
| scout_shachaf | 3 (armour, sensors, firepower) | 3 | 2330 |
| sniper_team | 3 (armour, sensors, firepower) | 3 | 1475 |
| yahalom_squad | 3 (armour, sensors, firepower) | 3 | 1475 |
| **all 17** | | | **34965** (was 36260 before `attack_drone`'s re-price, §7.4) |

