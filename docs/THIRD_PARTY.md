# Third-party material

Robotics Training Sim bundles robot models, a pretrained policy and libraries made by others. Each
is used under its own licence, listed below. This project is not affiliated with or endorsed by
Unitree Robotics, Google DeepMind or the three.js authors. Their names appear only to credit
their work.

## What ships in the web app

| Component | Where in this repo | Upstream source | Licence |
|---|---|---|---|
| Unitree G1 model (MJCF + meshes) | `public/models/g1/` | [unitreerobotics/unitree_rl_gym](https://github.com/unitreerobotics/unitree_rl_gym) `resources/robots/g1_description/` at commit `276801e46c5d433564f24658bac64f254b7d2d4b` | BSD-3-Clause, © 2016-2023 Unitree Robotics ([`public/models/g1/LICENSE`](../public/models/g1/LICENSE)) |
| Unitree G1 walking policy | `public/policies/g1_walk.json` | unitree_rl_gym `deploy/pre_train/g1/motion.pt`, same commit | BSD-3-Clause, © 2016-2023 Unitree Robotics (same licence as above) |
| G1 controller constants (gains, default pose, observation layout) | `src/robots/g1/`, `tools/g1_reference.py` | unitree_rl_gym `deploy/deploy_mujoco/configs/g1.yaml`, `deploy/deploy_mujoco/deploy_mujoco.py` and `resources/robots/g1_description/g1_12dof.urdf` (torque limits), same commit | BSD-3-Clause, © 2016-2023 Unitree Robotics |
| Unitree Go2 model (MJCF + meshes) | `public/models/go2/` | [google-deepmind/mujoco_menagerie](https://github.com/google-deepmind/mujoco_menagerie) `unitree_go2/` at commit `c96a32d28fb5da84da38c1da4d749e7a13212855` | BSD-3-Clause, © 2016-2022 Unitree Robotics ([`public/models/go2/LICENSE`](../public/models/go2/LICENSE)); MJCF conversion by the MuJoCo Menagerie authors ([`public/models/go2/README.md`](../public/models/go2/README.md)) |
| MuJoCo physics engine (WebAssembly build) | npm `@mujoco/mujoco` 3.14.0, bundled into `dist/assets/mujoco-*.wasm` | [google-deepmind/mujoco](https://github.com/google-deepmind/mujoco) (`wasm/`) | [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0), © DeepMind Technologies Limited |
| three.js (plus `OrbitControls`, `RoomEnvironment`, `BufferGeometryUtils` from its examples) | npm `three` 0.186, bundled into `dist/assets/index-*.js` | [mrdoob/three.js](https://github.com/mrdoob/three.js) | MIT, © 2010-2026 three.js authors |

Development-only tools (TypeScript, Vite, Vitest, Playwright, and the Python packages `mujoco`,
`torch`, `numpy`, `trimesh`, `fast-simplification`, `pyyaml`) are not part of the published site.
Each is used under its own licence.

## Changes made to Unitree's material

Unitree's README for unitree_rl_gym asks that modifications be disclosed. These are all of them:

* **Meshes (G1 and Go2):** simplified by quadric decimation with a target of 3,000 triangles per
  mesh ([`tools/optimize_meshes.py`](../tools/optimize_meshes.py)). A few complex parts stay above
  the target, for example the G1 torso (156,507 → 21,231 triangles). This way the page downloads
  about 6.5 MB of models instead of about 53 MB. Only the 27 G1 meshes that `g1_12dof.xml`
  references are included. The Go2 collides using primitive shapes only, so its meshes affect only
  how it looks. The G1 collides with its feet (spheres) and with convex hulls of the meshes;
  `tools/g1_reference.py` confirms the policy walks the same with the simplified meshes.
* **MJCF files:** `g1_12dof.xml` and `go2.xml` are byte-for-byte the upstream files. The app loads
  them inside a generated scene file that adds the warehouse arena (`src/core/arena.ts`).
* **Policy:** the TorchScript weights of `motion.pt` were exported to plain JSON by
  [`tools/export_g1_policy.py`](../tools/export_g1_policy.py), rounded to 7 decimal places. The
  network itself was not changed or retrained. In the browser, `src/robots/g1/policy.ts` matches
  PyTorch's actions over 100 consecutive steps with a largest difference of 2.6e-6
  (`tests/unit/g1Policy.test.ts` fails above 1e-4).
* **Go2 control:** Unitree's own Go2 controller is not used. The trot gait in `src/robots/go2/`
  was written for this project.

## Licence texts

The BSD-3-Clause licences are kept next to the models they cover:
[`public/models/g1/LICENSE`](../public/models/g1/LICENSE) and
[`public/models/go2/LICENSE`](../public/models/go2/LICENSE). Because they sit in `public/`, the built
site serves them too, at `models/g1/LICENSE` and `models/go2/LICENSE`.

The Apache License 2.0 (MuJoCo) is at <https://www.apache.org/licenses/LICENSE-2.0>. The MIT
licence (three.js) is at <https://github.com/mrdoob/three.js/blob/dev/LICENSE> and in
`node_modules/three/LICENSE` after `npm install`.
