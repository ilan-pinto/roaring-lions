"""Rotation retarget between two rigs of identical topology and different
rest orientations -- the mechanism that gives `civilian_child` an `idle` and
a `down` it was never supplied with (GH-149).

Pure Python, plain `(x, y, z, w)` tuples, no `bpy` and no numpy: the Blender
importer hands it `mathutils` quaternions as tuples and gets tuples back, and
`tools/test_civilian_roles.py` exercises the same code with nothing installed.

## Why this exists

The four supplied figures share ONE 24-joint skeleton topology -- same bone
names, same hierarchy, verified rather than assumed. Only the child is short
two clips: it ships `Running` and `Walking` and nothing else, so it has no
`Idle_9` to map onto `idle` and no `Crawl_and_Look_Back` to map onto `down`.

GH-149 offers three ways out and calls borrowing another figure's clip
"proportions differ, likely wrong". That is right about the OBVIOUS borrow
and wrong about the only one worth doing, and the difference is measurable:

  * The naive borrow copies each bone's LOCAL rotation across. It is wrong
    here, badly, because these rigs' REST bone frames differ -- the child
    against the woman by a median of 11.4 degrees and a maximum of 45.3, and
    against the farm worker by up to 169.3. A local rotation means a
    different thing in each frame, so copying it rotates the wrong way.

  * This module transfers each bone's rotation DELTA FROM ITS OWN REST, in
    armature space, and re-expresses it in the target's own rest frame. That
    is frame-independent by construction: what carries across is "this
    forearm is bent 40 degrees from where it rests", which means the same
    thing on both rigs.

## It was measured against ground truth before anything shipped

All three ADULT `Idle_9` clips are the same 2.03 s / 61-key animation --
Meshy's own retarget of one source onto three rigs. So a ground truth exists:
retarget the WOMAN's idle onto the OFFICE WORKER's rig and compare, joint by
joint, against the office worker's OWN supplied idle. Over 21 sampled times x
24 joints:

    this module      mean 2.31 deg   median 0.57   max 8.55
    the naive copy   mean 19.57 deg  median 14.02  max 140.49

The residual is concentrated in the arms (shoulder/forearm/hand, ~8 deg mean)
-- Meshy's own retarget also compensates for arm length and shoulder width,
which a pure rotation transfer does not attempt. At the ~25 px a civilian
occupies at gameplay zoom that is not a visible difference; 140 degrees is.

The same measurement is what makes "borrowed the woman's idle" a defensible
claim rather than a hopeful one, and it is why the woman is the donor: she is
the closest of the three in stature to the child (1.64 m against 1.20 m,
where the office worker is 1.75 m and the farm worker 1.72 m).
"""


def qmul(a, b):
    """Hamilton product, `(x, y, z, w)` -- the glTF and `mathutils` component
    order differ (`mathutils.Quaternion` is `(w, x, y, z)`), so callers
    convert at the boundary rather than this module guessing."""
    x1, y1, z1, w1 = a
    x2, y2, z2, w2 = b
    return (
        w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
        w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
        w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
        w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
    )


def qinv(q):
    """Inverse. Not merely the conjugate -- these come from matrix
    decompositions, so unit length is close but not guaranteed, and dividing
    by the squared norm costs nothing and removes a whole class of slow
    drift."""
    x, y, z, w = q
    n = x * x + y * y + z * z + w * w
    return (-x / n, -y / n, -z / n, w / n)


def retarget_local(donor_pose, donor_rest, target_rest, parents):
    """The target rig's POSE-LOCAL rotation per bone, given the donor's pose.

    All four mappings are `{bone_name: quaternion}` in ARMATURE space, except
    the return value, which is what Blender's `pose_bone.rotation_quaternion`
    wants: the rotation relative to that bone's own rest, in its own local
    frame. `parents` maps a bone to its parent's name, or to `None` for a
    root.

    The derivation, since getting it wrong produces a plausible-looking wrong
    pose rather than an error. Blender composes a bone's armature-space pose
    as `W(b) = W(p) . R(p)^-1 . R(b) . basis(b)`, where `R` is the bone's own
    armature-space rest. We want the target to reach `W_t(b) = D(b) . R_t(b)`
    for the donor's delta `D(b) = W_d(b) . R_d(b)^-1`. Substituting and
    cancelling, with `W_t(p) = D(p) . R_t(p)` true by induction from the
    root, leaves

        basis(b) = R_t(b)^-1 . D(p)^-1 . D(b) . R_t(b)

    which is what this returns. A root bone takes `D(p)` = identity."""
    identity = (0.0, 0.0, 0.0, 1.0)
    delta = {b: qmul(donor_pose[b], qinv(donor_rest[b])) for b in donor_pose}

    out = {}
    for bone, rest in target_rest.items():
        if bone not in delta:
            raise KeyError(f"retarget: donor rig has no bone {bone!r}")
        parent = parents.get(bone)
        d_parent = delta[parent] if parent is not None else identity
        out[bone] = qmul(qmul(qinv(rest), qmul(qinv(d_parent), delta[bone])), rest)
    return out
