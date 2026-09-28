# Architecture

Robotics Training Sim is a static web app. Everything (physics, robot control, rendering,
lessons) runs in the student's browser; there is no server.

```
 index.html ── src/main.ts (bootstraps everything)
                 │
   ┌─────────────┼───────────────────────────────┬──────────────────────┐
   │             │                               │                      │
 src/ui/     src/lessons/                   src/render/            src/input/
 panels,     lesson engine, scoring,        three.js view built    keyboard + gamepad
 HUD, knobs  explanations, progress         from the MuJoCo model  → MotionCommand
   │             │                               │                      │
   └─────────────┴──────────── SimulationApi ────┴──────────────────────┘
                                   │  (src/core/types.ts)
                          src/core/simulation.ts
                   MuJoCo WASM (@mujoco/mujoco 3.14.0)
                   arena MJCF (src/core/arena.ts) + robot MJCF (public/models/)
                                   │
                         RobotController (per robot)
             src/robots/g1/  Unitree's pretrained LSTM walking policy (50 Hz) + PD (500 Hz)
             src/robots/go2/ model-based trot gait + PD
```

## Physics

* Engine: Google DeepMind's official MuJoCo WebAssembly build, `@mujoco/mujoco` pinned to
  3.14.0 (the same version as the Python `mujoco` package used by the tools, so browser and
  Python reference runs match).
* Timestep 2 ms (500 Hz). Robot controllers write `data.ctrl` before every `mj_step`.
* Model files are fetched from `public/models/<robot>/` and written into MuJoCo's in-memory
  file system (`mujoco.FS`), then `MjModel.from_xml_path` compiles a generated scene file that
  `<include>`s the robot MJCF and adds the arena from `src/core/arena.ts`.
* Meshes are decimated by `tools/optimize_meshes.py` (G1 25 MB → 5 MB, Go2 28 MB → 1.5 MB).
  `tools/g1_reference.py` confirms the G1 policy behaves identically on the smaller meshes.

## Robots

| Robot | Source | Control |
|---|---|---|
| Unitree G1 humanoid (12 leg joints) | `unitree_rl_gym` `g1_12dof.xml` (BSD-3) | Pretrained policy `public/policies/g1_walk.json` (exported by `tools/export_g1_policy.py`), observation layout and gains from Unitree's `deploy_mujoco/configs/g1.yaml`, torque limits from Unitree's URDF (88/139/50 N·m) |
| Unitree Go2 quadruped | MuJoCo Menagerie `unitree_go2` (BSD-3) | Model-based trot gait with PD joint control, torque limits from the MJCF (23.7 / 45.43 N·m) |

G1 observation (47 values, 50 Hz), exactly as Unitree's `deploy_mujoco.py`:
`[ω·0.25 (3), projected gravity (3), cmd·[2,2,0.25] (3), q−q_default (12), q̇·0.05 (12),
last action (12), sin/cos of gait phase with 0.8 s period (2)]`.
Action → target joint angle `q_default + 0.25·action`; torque `kp(q*−q) − kd·q̇`, clipped.

## Module ownership

| Path | Responsibility |
|---|---|
| `src/core/types.ts` | Shared contracts. Change only with care; everything depends on it. |
| `src/core/mujoco.ts` | Load the WASM module; write model files into `mujoco.FS` from a `loadFile(path)` callback so the same code runs in the browser (fetch) and in Node tests (fs). |
| `src/core/arena.ts` | The warehouse arena layout (`ArenaLayout`) and its MJCF. |
| `src/core/simulation.ts` | `Simulation implements SimulationApi`: knobs, pushes, fall detection, state. |
| `src/robots/registry.ts` | `RobotInfo` for each robot and a `createController(id)` factory. |
| `src/robots/g1/` | G1 policy forward pass and controller. |
| `src/robots/go2/` | Go2 gait controller. |
| `src/render/` | three.js scene from `model` geoms; per-frame pose sync; camera follow; push arrow; checkpoint rings. |
| `src/input/` | Keyboard (WASD/arrows, Q/E turn) and Gamepad API → `MotionCommand`. |
| `src/lessons/` | Lesson definitions, the lesson runner, scoring, progress (localStorage, wrapped in try/catch). |
| `src/ui/` | DOM panels: robot picker, lesson panel, HUD, physics lab knobs, results. |
| `tools/` | Python scripts that produce the policy JSON, fixtures and optimized meshes. |
| `tests/unit/` | Vitest, runs in Node with the real MuJoCo WASM and model files. |
| `tests/e2e/` | Playwright smoke tests against the built site. |

## Knobs (PhysicsKnobs)

* `friction`: sets the sliding friction of every geom (MuJoCo uses the max of the pair, so all geoms must change).
* `payloadKg`: adds mass to the base body (scaling its inertia to match), like a backpack.
* `motorStrength`: scales torque limits and PD stiffness together, like weaker or stronger motors.
* `sensorNoise`: Gaussian noise on what the controller *sees* (gyro 0.2 rad/s·k, gravity vector 0.05·k,
  joint angle 0.01 rad·k, joint speed 1.5 rad/s·k), never on the true physics state.
* `timeScale`: slow motion for watching what happens.

## Lessons (students first)

1. **Meet the robot**: what motors, joints and sensors are; walk to the first checkpoint.
2. **Obstacle course**: reach checkpoints in order; timer, falls and a star score.
3. **Push recovery**: pushes of increasing strength; how balance and stepping work.
4. **Physics lab**: change friction, payload, motor strength and sensor noise and see why robots fail.

Each lesson has a plain-language explanation panel, a goal, live feedback and a result screen.
