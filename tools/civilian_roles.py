"""Per-vertex `rl_role` for the four supplied Meshy civilian figures (GH-149).

Pure Python -- no `bpy`, no numpy -- so the SAME classification runs in three
places: `tools/import_meshy_civilians.py` (inside Blender, where the roles
become separate meshes), the offline preview harness this was judged by eye
with, and `tools/test_civilian_roles.py` (plain `python3`, no Blender), which
is what keeps it falsifiable.

## Why islands, and not `import_meshy_soldier.py`'s colour centroids

That script classifies by sampling the base-colour texture at each vertex's
own UV and taking the nearest of four fitted centroids. It works there
because that figure is ONE uniformed body with three paint zones. It does not
work here, and the reason is measurable rather than aesthetic: these four
figures carry ACCESSORIES -- a shoulder bag, a messenger bag with strap and
buckles, a straw hat, a headscarf, two ponytails, and a farm tool reaching
from a hand to the ground -- and Meshy bakes directional lighting into the
texture, so an accessory's lit face clusters with the body's lit face while
the same accessory's shadowed face clusters with the trousers. Colour alone
(k-means at k=6 and k=7, both tried) scattered the woman's satchel across
three clusters and never once isolated the farm tool.

The mesh's own CONNECTED COMPONENTS have no such problem. Every accessory is
its own welded shell -- 10 islands on the woman, 14 on the office worker, 13
on the farm worker, 9 on the child -- and an island is exact, not a
threshold. So accessories are classified by island, and only the single
remaining body island (torso + head + arms, welded together in all four
sources) is split by colour, three ways: bare skin, hair, cloth.

## How an island is NAMED, and why not by vertex count

`FIGURES` keys each island `(dominant_bone, rank)` -- rank 0 being the
LARGEST island whose dominant bone is that one. Not `(vertex_count, bone)`,
which was the first shape tried and is wrong for a reason worth recording:
the same mesh has different vertex COUNTS on the two sides that must agree.
glTF seam-splits a vertex per UV island (the woman's mesh carries 3880
POSITION entries), while Blender's importer builds its own vertex array; a
count measured against one is not a key the other can look up. A size RANK
within a dominant bone survives any such relabelling, because welding or
splitting changes every island's absolute count without reordering them.

`classify` still fails loudly on a changed source -- it raises when the
`(bone, rank)` set it finds differs from the table, and again when two
islands sharing a dominant bone are within `RANK_MARGIN` of each other in
size, which would make their rank order a coin flip rather than a fact.

## The closed role set, and what civilians may NOT use

`packages/render/src/three/units/mesh-role.ts`'s `MESH_ROLES`. Three of the
ten are forbidden here by ART DIRECTION, not by the schema: `webbing`,
`weapon` and `charge`. GH-149: "Civilians must not read as fighters. The ROE
system deducts for civilian casualties, so the player has to tell them apart
at gameplay zoom: no webbing, no pouches, no weapon. The farm worker's tool
is `wood`/`metal`, never `weapon`." `FORBIDDEN_ROLES` states that, `classify`
enforces it on its own output, and `tools/test_civilian_roles.py` asserts no
figure's table names one -- so putting a `weapon` on a civilian is a test
failure, not a code review.
"""

#: Roles the closed set allows but a civilian must never carry -- see the
#: module docstring.
FORBIDDEN_ROLES = ("webbing", "weapon", "charge")

#: The closed vocabulary, mirroring `MESH_ROLES` in
#: `packages/render/src/three/units/mesh-role.ts`. Kept by hand the same way
#: `tools/validate_mesh_assets.py`'s own `DECOR_ROLES` mirrors its
#: TypeScript counterpart.
MESH_ROLES = (
    "uniform", "webbing", "boot", "face", "skin_shadow",
    "metal", "weapon", "wood", "charge", "keffiyeh",
)

#: The one island role resolved by a second pass rather than assigned
#: directly: the torso+head+arms shell, split into `face` / `skin_shadow` /
#: `uniform` by colour (see `_split_body`).
#:
#: There is deliberately no "tool" compound. The farm worker's implement was
#: expected to need a height cut to separate its wooden shaft from its metal
#: head, and does not: the head is its OWN island, resting on the ground
#: beside his boot (which is why its dominant bone is `RightToeBase` -- where
#: it is, not what holds it). The split is exact and needs no threshold.
BODY = "body"

#: Two islands sharing a dominant bone must differ in size by at least this
#: fraction of the larger, or their rank order is not a fact worth pinning.
#: The tightest real pair is the farm worker's `Head` hat crown (246) against
#: his hat band (45) -- 0.82 apart -- and the child's two ponytails, 173 and
#: 153, which are 0.12 apart and are BOTH `skin_shadow`, so their order does
#: not matter. `classify` only raises for an ambiguous pair whose two roles
#: DIFFER.
RANK_MARGIN = 0.05

#: Per-figure island tables, keyed `(dominant_bone, size_rank)` -> role, or
#: `BODY` for the one shell that needs a colour split. The measured vertex
#: counts (glTF-side, from the supplied `*_Idle_9_withSkin.glb`; the child
#: has no idle, so `*_Walking_*`) are kept in the comments as the record of
#: what was looked at -- they are NOT the key, see the module docstring.
FIGURES = {
    "civilian_woman": {
        ("Head", 0): BODY,             # 858 -- face and neck (hair is under the scarf)
        ("Head", 1): "keffiyeh",       # 559 -- headscarf, draping over both shoulders
        ("Hips", 0): "uniform",        # 804 -- navy tunic
        ("Hips", 1): "uniform",        # 504 -- trousers
        ("RightHand", 0): "face",      # 232 -- bare hand
        ("LeftHand", 0): "face",       # 228 -- bare hand
        ("LeftUpLeg", 0): "wood",      # 191 -- satchel body, hanging at the hip
        ("LeftShoulder", 0): "wood",   # 176 -- satchel strap
        ("RightFoot", 0): "boot",      # 167
        ("LeftFoot", 0): "boot",       # 161
    },
    "office_worker": {
        ("Head", 0): BODY,             # 1839 -- shirt + head + arms, one welded shell
        ("Hips", 0): "uniform",        # 555 -- trousers
        ("Hips", 1): "metal",          # 29 -- belt buckle
        ("Hips", 2): "metal",          # 11 -- shirt stud, centre chest
        ("LeftUpLeg", 0): "face",      # 293 -- left hand; its weights bleed onto the
                                       #        thigh it hangs beside, so the thigh
                                       #        wins the dominant-bone vote. The
                                       #        ISLAND is still the hand.
        ("RightHand", 0): "face",      # 289
        ("LeftArm", 0): "wood",        # 218 -- messenger-bag strap
        ("LeftHand", 0): "wood",       # 152 -- the bag itself
        ("RightFoot", 0): "boot",      # 177
        ("LeftFoot", 0): "boot",       # 169
        # Four buckles and clasps on the bag and its strap. `metal` -- the
        # only role in the closed set for a fitting that is neither cloth nor
        # leather, and emphatically not `webbing`, which is the role this
        # figure must never carry.
        ("LeftForeArm", 0): "metal",   # 50
        ("LeftForeArm", 1): "metal",   # 32
        ("LeftForeArm", 2): "metal",   # 19
        ("LeftForeArm", 3): "metal",   # 12
    },
    "farm_worker": {
        ("Head", 0): BODY,             # 1652 -- shirt + head + arms
        ("Head", 1): "keffiyeh",       # 391 -- straw hat, brim
        ("Head", 2): "keffiyeh",       # 246 -- straw hat, crown
        ("Head", 3): "keffiyeh",       # 45 -- hat band
        ("Hips", 0): "uniform",        # 612 -- trousers
        ("Hips", 1): "uniform",        # 159 -- waist sash
        ("Hips", 2): "uniform",        # 104 -- waist sash, second shell
        ("RightHand", 0): "face",      # 300 -- bare hand
        ("RightHand", 1): "wood",      # 118 -- the tool's shaft, hand to ground
        ("RightToeBase", 0): "metal",  # 55 -- the tool's head, resting on the ground
        ("LeftHand", 0): "face",       # 258
        ("RightFoot", 0): "boot",      # 165 -- tall boot
        ("LeftFoot", 0): "boot",       # 150
    },
    "civilian_child": {
        ("Head", 0): BODY,             # 967 -- tee + head + arms
        ("Head", 1): "skin_shadow",    # 388 -- hair
        ("Head", 2): "skin_shadow",    # 173 -- ponytail
        ("Head", 3): "skin_shadow",    # 153 -- ponytail
        ("RightLeg", 0): "uniform",    # 472 -- jeans
        ("LeftHand", 0): "face",       # 278
        ("RightHand", 0): "face",      # 253
        ("LeftFoot", 0): "boot",       # 143
        ("RightFoot", 0): "boot",      # 141
    },
}

#: Bones a bare-skin vertex inside the body island may sit on. A shirt vertex
#: cannot be on `Head`; a chin vertex on `Spine` is not skin worth peeling
#: into its own role. Restricting the skin split to head, neck, forearms and
#: hands is what stops a lit shoulder being classified as a face.
SKIN_BONES = frozenset(
    ("Head", "headfront", "head_end", "neck", "LeftForeArm", "RightForeArm",
     "LeftHand", "RightHand")
)

#: The bones a hair/shadow vertex may sit on: head and neck only. A forearm
#: is bare skin or a sleeve, never hair, and letting a dark cuff reach
#: `skin_shadow` would put a skin ramp on cloth.
HAIR_BONES = frozenset(("Head", "headfront", "head_end", "neck"))

#: Hair, inside the body island, as a fraction of that figure's OWN measured
#: skin luma. Hair is far darker than skin on every source with visible hair
#: -- office worker 0.30, child 0.34 -- while the LIGHTEST cloth in any body
#: island (the office worker's pale blue shirt) sits at 1.05 and the darkest
#: (the farm worker's grey-green shirt, against his tanned hands) at 0.93.
#: 0.5 sits far from both populations rather than beside either. It
#: deliberately also catches genuinely shadowed skin -- under a chin, inside
#: an ear -- which is what `skin_shadow` MEANS.
HAIR_LUMA_FRAC = 0.5


def _weld_islands(positions, triangles):
    """Connected components, welded by position rather than by vertex index.

    A glTF export seam-splits a vertex per UV, so two triangles sharing an
    edge geometrically need not share a vertex INDEX -- comparing indices
    reports a hat brim and its crown as two islands purely because a UV seam
    runs between them. Welding is done on positions normalised by the mesh's
    own bounding-box diagonal, so this behaves identically whether the caller
    measures in metres (Blender) or in whatever unit the source file uses.

    Returns one component id per input vertex."""
    xs = [p[0] for p in positions]
    ys = [p[1] for p in positions]
    zs = [p[2] for p in positions]
    diag = max(
        (max(xs) - min(xs)) ** 2 + (max(ys) - min(ys)) ** 2 + (max(zs) - min(zs)) ** 2,
        1e-12,
    ) ** 0.5

    key = {}
    rep = []
    for p in positions:
        k = (round(p[0] / diag, 6), round(p[1] / diag, 6), round(p[2] / diag, 6))
        if k not in key:
            key[k] = len(key)
        rep.append(key[k])

    parent = list(range(len(key)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for tri in triangles:
        a, b, c = rep[tri[0]], rep[tri[1]], rep[tri[2]]
        for x, y in ((a, b), (b, c)):
            rx, ry = find(x), find(y)
            if rx != ry:
                parent[rx] = ry
    return [find(r) for r in rep]


def _luma(rgb):
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]


def _split_body(members, colours, bones, skin_rgb):
    """`face` for bare skin, `skin_shadow` for hair, `uniform` for cloth,
    inside the one welded body island.

    `skin_rgb` is neither a guess nor a constant: it is the mean sampled
    colour of that same figure's OWN bare-hand islands, which are
    unambiguous by construction. A vertex is skin when it sits on a
    `SKIN_BONES` bone AND is closer to that measured hand colour than to the
    island's own cloth mean. Two MEASURED references and no absolute
    threshold -- which is why a pale blue shirt and a grey-green one both
    split correctly with no per-figure number."""
    cloth = [i for i in members if bones[i] not in SKIN_BONES]
    if cloth:
        cloth_rgb = [sum(colours[i][c] for i in cloth) / len(cloth) for c in range(3)]
    else:
        cloth_rgb = [0.0, 0.0, 0.0]

    skin_luma = _luma(skin_rgb)
    roles = {}
    for i in members:
        if bones[i] not in SKIN_BONES:
            roles[i] = "uniform"
            continue
        if bones[i] in HAIR_BONES and _luma(colours[i]) < skin_luma * HAIR_LUMA_FRAC:
            roles[i] = "skin_shadow"
            continue
        d_skin = sum((colours[i][c] - skin_rgb[c]) ** 2 for c in range(3))
        d_cloth = sum((colours[i][c] - cloth_rgb[c]) ** 2 for c in range(3))
        roles[i] = "face" if d_skin <= d_cloth else "uniform"
    return roles


def island_keys(positions, triangles, bones):
    """`{(dominant_bone, size_rank): [vertex index, ...]}` for one mesh --
    the naming scheme `FIGURES` is keyed by. Exposed (rather than kept
    private to `classify`) because it is what a measurement run prints when
    a new figure's table is being written."""
    comp = _weld_islands(positions, triangles)
    groups = {}
    for i, c in enumerate(comp):
        groups.setdefault(c, []).append(i)

    by_bone = {}
    for members in groups.values():
        counts = {}
        for i in members:
            counts[bones[i]] = counts.get(bones[i], 0) + 1
        dom = max(counts, key=lambda b: counts[b])
        by_bone.setdefault(dom, []).append(members)

    out = {}
    for bone, islands in by_bone.items():
        islands.sort(key=len, reverse=True)
        for rank, members in enumerate(islands):
            out[(bone, rank)] = members
    return out


def classify(figure, positions, triangles, colours, bones):
    """Per-vertex `rl_role` for one figure.

    `positions` / `colours` are per-vertex sequences (xyz, rgb); `triangles`
    is a sequence of 3-index tuples; `bones` is the name of the bone each
    vertex is weighted to most heavily.

    Raises if the islands found do not match `FIGURES[figure]` exactly, or if
    two same-bone islands of DIFFERENT roles are too close in size for their
    rank order to be meaningful -- see the module docstring for why a changed
    source must fail loudly rather than shade a bag as a face."""
    table = FIGURES[figure]
    found = island_keys(positions, triangles, bones)

    if set(found) != set(table):
        raise RuntimeError(
            f"{figure}: island set changed -- this is not the mesh "
            f"tools/civilian_roles.py's FIGURES table was measured against.\n"
            f"  expected: {sorted(table)}\n"
            f"  found:    {sorted(found)}"
        )

    for (bone, rank), members in sorted(found.items()):
        nxt = found.get((bone, rank + 1))
        if nxt is None or table[(bone, rank)] == table[(bone, rank + 1)]:
            continue
        if len(nxt) > len(members) * (1.0 - RANK_MARGIN):
            raise RuntimeError(
                f"{figure}: islands ({bone}, {rank}) and ({bone}, {rank + 1}) have "
                f"{len(members)} and {len(nxt)} vertices -- too close to rank "
                f"reliably, and they carry different roles "
                f"({table[(bone, rank)]!r} vs {table[(bone, rank + 1)]!r})"
            )

    hands = [i for key, role in table.items() if role == "face" for i in found[key]]
    if hands:
        skin_rgb = [sum(colours[i][c] for i in hands) / len(hands) for c in range(3)]
    else:
        raise RuntimeError(f"{figure}: no bare-hand island to measure skin colour from")

    roles = [None] * len(positions)
    for key, role in table.items():
        members = found[key]
        if role == BODY:
            for i, r in _split_body(members, colours, bones, skin_rgb).items():
                roles[i] = r
        else:
            for i in members:
                roles[i] = role

    missing = [i for i, r in enumerate(roles) if r is None]
    if missing:
        raise RuntimeError(f"{figure}: {len(missing)} vertices left unclassified")
    produced = set(roles)
    outside = sorted(produced - set(MESH_ROLES))
    if outside:
        raise RuntimeError(f"{figure}: produced roles outside the closed set: {outside}")
    forbidden = sorted(produced & set(FORBIDDEN_ROLES))
    if forbidden:
        raise RuntimeError(f"{figure}: produced a forbidden civilian role: {forbidden}")
    return roles
