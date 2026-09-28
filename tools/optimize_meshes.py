"""Shrink the robot meshes so the web app downloads quickly.

Unitree's original meshes are ~25 MB (G1) and ~28 MB (Go2). Browsers must download every
mesh before MuJoCo can compile the model, so we simplify each mesh with quadric decimation.
G1 collision geoms use convex hulls of these meshes and its feet use sphere contacts, so
physics is essentially unchanged (verified with tools/g1_reference.py). Go2 collides with
primitive shapes only, so its meshes are purely visual.

Usage:
    python3 tools/optimize_meshes.py <unitree_rl_gym>/resources/robots/g1_description/meshes \
        <mujoco_menagerie>/unitree_go2/assets
"""
import sys
from pathlib import Path

import fast_simplification
import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parent.parent
TARGET_FACES = 3000  # per mesh; plenty for a robot link at classroom viewing distances


def read_obj(path: Path) -> trimesh.Trimesh:
    """Minimal OBJ reader (positions + triangulated faces); ignores materials and UVs."""
    verts, faces = [], []
    for line in path.read_text().splitlines():
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "v":
            verts.append([float(x) for x in parts[1:4]])
        elif parts[0] == "f":
            idx = [int(p.split("/")[0]) for p in parts[1:]]
            idx = [i - 1 if i > 0 else len(verts) + i for i in idx]
            faces.extend([idx[0], idx[k], idx[k + 1]] for k in range(1, len(idx) - 1))
    return trimesh.Trimesh(vertices=np.array(verts), faces=np.array(faces), process=False)


def simplify(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    mesh.merge_vertices()
    n = len(mesh.faces)
    if n <= TARGET_FACES:
        return mesh
    reduction = 1.0 - TARGET_FACES / n
    pts, faces = fast_simplification.simplify(
        np.asarray(mesh.vertices, dtype=np.float32), np.asarray(mesh.faces, dtype=np.int64), reduction
    )
    return trimesh.Trimesh(vertices=pts, faces=faces, process=True)


def optimize_dir(src: Path, dst: Path, pattern: str, fmt: str) -> None:
    before = after = 0
    for out in sorted(dst.glob(pattern)):
        original = src / out.name
        if fmt == "obj":
            loaded = read_obj(original)
        else:
            loaded = trimesh.load(original, force="mesh", process=False)
        simple = simplify(loaded)
        simple.export(out, file_type=fmt)
        before += original.stat().st_size
        after += out.stat().st_size
        print(f"{out.name:40s} {len(loaded.faces):7d} -> {len(simple.faces):5d} faces")
    print(f"{dst}: {before / 1e6:.1f} MB -> {after / 1e6:.1f} MB")


if __name__ == "__main__":
    g1_src, go2_src = Path(sys.argv[1]), Path(sys.argv[2])
    optimize_dir(g1_src, ROOT / "public/models/g1/meshes", "*.STL", "stl")
    optimize_dir(go2_src, ROOT / "public/models/go2/assets", "*.obj", "obj")
