"""Who may regenerate which file under `art/meshes/**`.

**This module is the one place that answers that, and the spelling here is the
one that wins.** It was not invented here: `tools/render_building.py` got there
first, with `BuildingSpec.mesh_owner` and the `MESH_KIT_OWNED` sentinel, after
`2b72047` replaced `art/meshes/buildings/house.glb` with a supplied Meshy asset
and left nothing stopping a later `export_mesh_building.py -- house` from
overwriting it from the kit source. That mechanism is moved here verbatim in
meaning so the vehicle and infantry-team pipelines can share it instead of
inventing a third and a fourth name for the same idea.

Why it keeps being needed: a replacement exporter is written to drop in
cleanly. `tools/export_meshy_sniper.py`'s own header says it keeps `rig.py`'s
"rig contract byte-for-byte: the same bone names, the same five clips, the same
role vocabulary"; `tools/vehicles/export_meshy_d9.py` writes the same
`dozer_d9.glb` `export_mesh_vehicle.py` does. That is exactly what makes the
swap one line -- and exactly what makes the OLD exporter, still sitting in the
tree with the unit still in its `SPECS`/`SUPPORTED_TEAMS` table, able to
silently undo it. Nothing downstream complains, because a dozer still looks
like a dozer and a sniper team still looks like a sniper team.
`pnpm validate:meshes` passes either way.

Three known instances, all found by measurement rather than by reading:

  * `house.glb` -- found after the fact, `2b72047`, and is why the buildings
    half exists at all.
  * `art/meshes/sniper_team.glb` -- `tools/units/rig.py` still lists
    `sniper_team` in `SUPPORTED_TEAMS`, and `export_mesh_team.py -- all` would
    have replaced two ghillie-suited photogrammetry figures with `kit.py`
    primitives (measured 2026-09-16: 781,164 bytes / 3 roles / 24-frame `move`
    shipped, against 903,588 / 7 roles / 16 frames from the kit).
  * `art/meshes/vehicles/dozer_d9.glb` -- `tools/export_mesh_vehicle.py` still
    carries a `dozer_d9` spec pointing at the primitive `art/src/vehicles/
    d9.blend`, and that path has been `tools/vehicles/export_meshy_d9.py`'s
    since `31c9799`. Worse than the sniper case, because the shipped file has
    SINCE taken the vehicle wreck pass -- it carries `death_root` and `WRECK_`
    children that a re-export from the kit would discard along with the
    geometry, and `pnpm wreck:meshes` would have to be re-run to notice.

## Two guards, and the second is the one that does not need maintaining

`assert_kit_owns_path` is the DECLARED guard: a table says who owns the file,
and a non-kit owner refuses. It is only as current as the table.

`assert_no_provenance_drift` (`tools/export_mesh_building.py`, kept there
because it is where it was written) is the OBSERVED guard: it reads the glTF
`asset.copyright` already on disk and refuses when it is not this kit's own
credit. That one would have caught `house` with the table left completely
untouched, and it is what has been quietly protecting `warehouse` and
`apartment`, whose `mesh_owner` said `MESH_KIT_OWNED` while both GLBs shipped a
supplied Meshy bake (1 material, 1 texture, a Meshy copyright -- read off the
bytes 2026-09-16). Prefer adding the observed guard to a pipeline over trusting
its table. Both, ideally.

## No default, deliberately

Every spec table using this must make `mesh_owner` REQUIRED. A silent default
is how `house` happened: the entry simply never expressed an opinion, and
"no opinion" read as "yes". A new unit whose author has not thought about it
must fail at import, not ship.
"""
import os

#: The sentinel `mesh_owner` value meaning "the kit that declares this spec may
#: regenerate the shipped GLB from its own source". Any other non-empty string
#: names whatever produced the shipped file instead, and the kit refuses.
#:
#: A string rather than a bool so the refusal can SAY where the real asset
#: comes from -- which is the whole difference between a block someone can act
#: on and a block someone eventually deletes.
MESH_KIT_OWNED = "kit"


def require_owner(table, unit_id, table_name):
    """`table[unit_id]`, raising rather than defaulting.

    A `dict.get(unit_id, MESH_KIT_OWNED)` here would reopen the exact hole this
    module exists to close, for whichever unit is replaced next.
    """
    if unit_id not in table:
        raise RuntimeError(
            f"{unit_id}: no entry in {table_name}. Every unit this pipeline can "
            f"write must declare who owns its file under art/meshes/ -- "
            f"{MESH_KIT_OWNED!r} if this kit may regenerate it, or a string "
            f"naming the script that produces the shipped asset instead. There "
            f"is deliberately no default; see tools/mesh_ownership.py."
        )
    return table[unit_id]


def assert_kit_owns_path(unit_id, owner, path, owned_path):
    """Refuse to write `path` when `owner` is not this kit AND `path` IS the
    shipped file that owner produces.

    **Keyed on the resolved PATH, not on whether a caller passed an out-path
    argument.** The first version of the infantry guard fired only when
    `out_path is None`, which means `build_and_export(unit, out_path=<the
    shipped path>)` -- the shape any loop script naturally takes, and the shape
    this module's own verification probes take -- walked straight through it. A
    guard that can be stepped around by spelling the same destination a
    different way is the "passes by construction" class this branch keeps
    finding.

    Writing somewhere else is always allowed: that is how the primitive build
    stays measurable (`sniper-idle-after.png` was made exactly that way) without
    being shippable.
    """
    if owner == MESH_KIT_OWNED:
        return
    if os.path.realpath(path) != os.path.realpath(owned_path):
        return
    raise RuntimeError(
        f"{unit_id}: {owned_path} is not this kit's to regenerate -- it is "
        f"written by {owner}. Refusing rather than silently overwriting a "
        f"supplied replacement. Pass a different output path if you want this "
        f"kit's build for comparison; see tools/mesh_ownership.py."
    )


def split_owned_and_superseded(unit_ids, table, table_name):
    """`(owned, superseded)` for an `all`-style run.

    A non-kit entry is not a failure to abort the whole run over -- but it is
    also not silently skippable, so every caller prints the superseded list by
    name. `all` meaning "all but one" is exactly the kind of thing a reader has
    to be told; the sniper case survived for weeks because nobody ran `all`,
    not because anything said so.
    """
    owned, superseded = [], []
    for unit_id in unit_ids:
        owner = require_owner(table, unit_id, table_name)
        (owned if owner == MESH_KIT_OWNED else superseded).append(unit_id)
    return owned, superseded
