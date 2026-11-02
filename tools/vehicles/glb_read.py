"""A minimal, dependency-free (numpy only) reader for the UNCOMPRESSED GLBs in
`art/meshes/` (never `assets/meshes/`, which is Draco). Used by the L3 map
generator (`lavi_maps.py`); it reads geometry, never writes a file.
"""
import json
import struct

import numpy as np

_CT = {5126: ("f", 4), 5123: ("H", 2), 5125: ("I", 4), 5121: ("B", 1), 5120: ("b", 1), 5122: ("h", 2)}
_NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


class Glb:
    def __init__(self, path):
        raw = open(path, "rb").read()
        if raw[:4] != b"glTF":
            raise ValueError(f"{path}: not a GLB")
        off, js, bn = 12, None, b""
        while off < len(raw):
            ln, typ = struct.unpack("<II", raw[off:off + 8])
            body = raw[off + 8:off + 8 + ln]
            if typ == 0x4E4F534A:
                js = json.loads(body)
            elif typ == 0x004E4942:
                bn = body
            off += 8 + ln
        if js is None:
            raise ValueError(f"{path}: no JSON chunk")
        if "KHR_draco_mesh_compression" in (js.get("extensionsUsed") or []):
            raise ValueError(f"{path}: Draco-compressed -- read art/meshes/, not assets/meshes/")
        self.js, self.bin = js, bn

    def accessor(self, i):
        a = self.js["accessors"][i]
        v = self.js["bufferViews"][a["bufferView"]]
        t, s = _CT[a["componentType"]]
        n = _NC[a["type"]]
        o = v.get("byteOffset", 0) + a.get("byteOffset", 0)
        st = v.get("byteStride", s * n)
        arr = np.ndarray((a["count"], n), dtype=np.dtype(t).newbyteorder("<"), buffer=self.bin, offset=o, strides=(st, s))
        return np.array(arr)

    def node_translation(self, name):
        """World translation of a node by name (rotation and scale must be identity along its chain)."""
        nodes = self.js["nodes"]
        parent = {}
        for i, nd in enumerate(nodes):
            for c in nd.get("children", []):
                parent[c] = i
        idx = next(i for i, nd in enumerate(nodes) if nd.get("name") == name)
        t = np.zeros(3)
        while idx is not None:
            nd = nodes[idx]
            if "rotation" in nd or "matrix" in nd:
                raise ValueError(f"node {nd.get('name')} has a rotation/matrix; only translations are handled")
            if "scale" in nd and any(abs(x - 1) > 1e-9 for x in nd["scale"]):
                raise ValueError(f"node {nd.get('name')} is scaled")
            t += np.array(nd.get("translation", [0, 0, 0]))
            idx = parent.get(idx)
        return t

    def primitive(self, mesh_name):
        """`(positions, normals, uvs, indices)` of the one primitive of the node named `mesh_name`."""
        nd = next(n for n in self.js["nodes"] if n.get("name") == mesh_name)
        prim = self.js["meshes"][nd["mesh"]]["primitives"][0]
        at = prim["attributes"]
        return (
            self.accessor(at["POSITION"]).astype(np.float64),
            self.accessor(at["NORMAL"]).astype(np.float64),
            self.accessor(at["TEXCOORD_0"]).astype(np.float64),
            self.accessor(prim["indices"]).reshape(-1, 3).astype(np.int64),
        )
