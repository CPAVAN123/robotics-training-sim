# Robotics Training Sim

[![CI](https://github.com/CPAVAN123/robotics-training-sim/actions/workflows/ci.yml/badge.svg)](https://github.com/CPAVAN123/robotics-training-sim/actions/workflows/ci.yml)

Drive real robot models through real physics, right in the browser, and learn why robots balance,
walk and fall.

Robotics Training Sim is a free, lesson-first robotics simulator for students and teachers. You
pick a robot (the **Unitree G1** humanoid or the **Unitree Go2** robot dog) and work through guided
lessons: a tour of motors and sensors, an obstacle course, push recovery and a physics lab. Every
lesson has a clear goal, live feedback, a 0–3 star score and plain-language explanations of the
physics behind what you see.

Everything runs in your browser: the MuJoCo physics engine (compiled to WebAssembly), the robot
controllers and the 3D view. There is no server, no account and no install. Nothing you do leaves
your computer, and progress is saved only in your own browser.

## Live demo

**Coming soon:** once GitHub Pages is switched on (see [Deploying](#deploying-to-github-pages)), the
app will be at <https://cpavan123.github.io/robotics-training-sim/>.

## For teachers

* **No setup for students.** It needs a recent Chrome, Edge, Firefox or Safari with WebAssembly and
  WebGL. It works on laptops, Chromebooks and tablets (touch joysticks appear on touch screens).
  Phones work only held sideways, and the screen is cramped. The first visit downloads about 8 MB:
  the physics engine plus one robot.
* **Short lessons, any order.** Each lesson takes a few minutes and can be repeated for more stars.
  All four are open from the start, but 1 → 4 builds up the ideas: motors and sensors, then driving,
  then balance, then physical limits.
* **Honest physics.** Numbers shown to students (torque limits, masses, forces, friction) come from
  the robot models and the simulation itself. Where a robot fails, the explanations say why, based on
  measurements, not guesses.
* **Progress stays on the device.** Stars and best times are kept in the browser's local storage
  for each robot. Clearing site data resets them. Private windows keep them only for the session.

## Run it locally

You need [Node.js](https://nodejs.org/) 22 or newer.

```bash
git clone https://github.com/CPAVAN123/robotics-training-sim.git
cd robotics-training-sim
npm install
npm run dev
```

Then open the address Vite prints (usually <http://localhost:5173>).

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Type-check, then build the static site into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run typecheck` | TypeScript only |
| `npm test` | Unit tests (Vitest, real MuJoCo in Node) |
| `npm run test:e2e` | End-to-end tests in headless Chromium (Playwright) |

The built site is fully static and uses relative paths, so `dist/` can be served from any web server
or sub-folder.

## How the lessons work

Start from the home screen: choose a robot, then a lesson. In every lesson you drive the robot by
telling it how fast to walk and turn. The robot's own controller moves the legs, just like real
walking robots. The panel on the right (the HUD) shows speed and heading, body tilt from the IMU,
the load on every motor, which feet touch the ground and your current command. **Explain** (X)
opens the physics behind the lesson plus a glossary.

The **Robot handbook** (the button on the home screen, the Handbook tool in a lesson, or the I key) is a
reference to read at any time: the robot's parts, motors and sensors, how its controller walks, balance
physics, how the MuJoCo simulator works, and who builds legged robots around the world.

| # | Lesson | What you do | Stars |
|---|---|---|---|
| 1 | **Meet the robot** | A four-card tour of joints and motors, sensors (IMU and encoders) and the control loop, one quiz question, then your first walk to a checkpoint 3 m away. | Reach the checkpoint · no falls · quiz right first time |
| 2 | **Obstacle course** | Reach 7 checkpoints in order: warm-up, a 3-crate slalom, a 0.9 m gap between pallets, an 8 cm loading ramp, two 2 cm cable bumps, finish. The clock starts when you press **Start** on the rules card. A fall, or a reset with R, adds 10 s and puts you back at the last checkpoint. **Watch demo** lets an autopilot drive (demo runs earn no stars). | G1: under 60 s ★★★, 95 s ★★. Go2: under 50 s ★★★, 80 s ★★. Finishing ★ |
| 3 | **Push recovery** | Eight shoves (four gentle, three hard, one too strong), each announced 4 s ahead by a red arrow. Turn the robot so the push lands on its strongest side. A push is saved if the robot is still up 3 s later; resetting with R during a push counts as not saved. The balance view shows the centre of mass and the support polygon. | 4 / 6 / 7 saves (the 8th push is too strong for any robot) |
| 4 | **Physics lab** | Five knobs: friction, a backpack (extra mass), motor strength, sensor noise and slow motion. A live panel explains each change with numbers. Three challenges: walk 3 m on ice (μ = 0.2), with a heavy backpack (G1 10 kg, Go2 15 kg) and with weak motors (G1 80 %, Go2 40 %). | One per challenge |

A fallen robot lies still for 1.5 s so you can see what happened, then is put back on its feet
where the lesson wants it. **R** resets it at any time, and **Space** pauses.

## Controls

| Keyboard | Action |
|---|---|
| W / ↑, S / ↓ | Walk forward / backward |
| A / D | Sidestep left / right |
| Q / E or ← / → | Turn left / right |
| Shift (hold) | Walk slowly (40 %) |
| Space | Pause / resume |
| R | Reset the robot |
| P, then 1 / 2 / 3 | Push menu: pick a side, then nudge / shove / huge |
| B | Balance view (centre of mass and support polygon) |
| C | Chase camera on / off |
| X | Explain panel and glossary |
| I | Robot handbook |
| H or ? | Controls help |
| Esc | Close a panel |

* **Mouse:** drag to look around, scroll to zoom, right-drag to pan.
* **Touch:** the left joystick walks and sidesteps, the right one turns. Pinch to zoom, two-finger
  drag to pan.
* **Gamepad** (standard mapping): left stick walks, right stick turns, Start pauses, Back/Select
  resets. Pads the browser does not report as standard layout are ignored, because their axes can
  mean anything (a trigger on axis 2 would read as a constant turn).

Commands ramp up over half a second and brake in a quarter of a second (of simulated time, so the
same in slow motion), because sudden jumps are hard for a walking robot to follow. Everything on screen can be reached with the keyboard alone, and
the app follows the operating system's reduced-motion setting.

## The robots

| | Unitree G1 (humanoid) | Unitree Go2 (robot dog) |
|---|---|---|
| Model | `g1_12dof.xml` from Unitree's [unitree_rl_gym](https://github.com/unitreerobotics/unitree_rl_gym): 12 leg motors, arms held still, 32.1 kg | `go2.xml` from [MuJoCo Menagerie](https://github.com/google-deepmind/mujoco_menagerie/tree/main/unitree_go2): 12 motors (3 per leg), 15.2 kg |
| Controller | Unitree's **pretrained neural-network policy** (reinforcement learning) | A **model-based trot gait** written for this project |
| How it works | At 50 Hz a small LSTM network (64 memory cells, then a 32-neuron layer) reads 47 numbers: gyro, gravity direction, your command, joint angles and speeds, its last action and a gait clock. It outputs 12 target joint angles. At 500 Hz each motor runs a PD controller toward its target, with Unitree's gains (kp 100 / 150 / 40, kd 2 / 4 / 2 for hip / knee / ankle) and torque limits from Unitree's URDF (88 / 139 / 50 N·m). | At 500 Hz it estimates tilt with a complementary filter (gyro + accelerometer) and reads its speed from the simulator, standing in for the leg-odometry + IMU estimate a real robot computes. It runs a diagonal trot clock (0.36 s cycle), shares the needed force and moment between the feet on the ground, places each swinging foot with Raibert's rule, swings feet on a ground-relative cycloid and turns forces into torques through the leg Jacobian. Motor limits come from the MJCF (23.7 / 45.43 N·m). |
| Checked against | A line-by-line port of Unitree's `deploy_mujoco.py`. The TypeScript network matches PyTorch to within 3 × 10⁻⁶. Over 10 s it walks the same distances as Python MuJoCo: 4.59 m at 0.5 m/s, −3.40 m at −0.4 m/s, 2.99 m sideways at 0.4 m/s. | Its Python twin `tools/go2_gait_lab.py`, which gives the same numbers: 4.61 m in 10 s at 0.5 m/s, 6.70 rad of turning at 0.8 rad/s, and no falls in 24 runs of random full-stick driving. |
| Limits students will meet | Trained on flat floors: ramps and bumps are new to it (cross them slowly and straight). Walks with up to 15 kg extra and on friction down to about 0.2. Falls below about 70 % motor strength, mostly because the softer joints no longer match what the network was trained with, not because the motors can't hold its weight. | Very robust: it still walks on μ = 0.05 and with 30 kg on its back. With weak motors it deliberately walks slower so its legs can swing forward in time. |

The Go2's controller is not Unitree's own software; the real Go2 walks differently.

## The physics engine

* [MuJoCo](https://mujoco.org/) 3.14.0, Google DeepMind's official WebAssembly build
  ([`@mujoco/mujoco`](https://www.npmjs.com/package/@mujoco/mujoco)), the same version as the
  Python `mujoco` package used by the tools, so browser and Python runs agree.
* A fixed 2 ms timestep (500 Hz). The app steps physics to keep up with the wall clock, at most
  0.1 s of simulated time per frame, so a slow frame can't freeze the tab. Slow motion changes only
  how fast the steps are taken, never their size.
* The robot MJCF files are loaded unchanged into MuJoCo's in-memory file system. A generated scene
  file includes the robot and adds the warehouse arena from `src/core/arena.ts`: a 30 × 20 m hall
  with the obstacle course, a push pad and a lab area.
* **Knobs:** friction sets the sliding friction of every geom (MuJoCo uses the larger value of the two
  touching surfaces). The backpack adds mass to the robot's base and scales its inertia to match.
  Motor strength scales both the torque limits and the PD stiffness. Sensor noise adds uniform
  noise only to what the controller sees: up to ±0.2 rad/s on the gyro, ±0.05 on the gravity direction,
  ±0.01 rad on joint angles and ±1.5 rad/s on joint speeds per unit of noise (exactly the noise Unitree's
  legged_gym adds in training), plus ±0.1 m/s on the Go2's speed estimate.
  The real physics is never touched.
* Rendering is [three.js](https://threejs.org/), built directly from the compiled MuJoCo model
  (visual meshes, colours and poses). An adaptive quality governor lowers resolution and turns off
  shadows on slow GPUs so the simulation keeps up.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Project layout

```
index.html               page shell
public/
  models/g1/             Unitree G1 MJCF, simplified meshes, BSD-3 licence
  models/go2/            Unitree Go2 MJCF (MuJoCo Menagerie), simplified meshes, BSD-3 licence
  policies/g1_walk.json  G1 walking policy weights, exported from Unitree's TorchScript file
src/
  main.ts                entry point: browser support check, start the app
  core/                  shared types, MuJoCo loading, warehouse arena, Simulation (knobs, pushes, falls)
  robots/                robot registry and course autopilot
    g1/                  LSTM policy forward pass and the G1 controller
    go2/                 trot gait: sensing, estimator, gait clock, balance, kinematics, controller
  render/                three.js view, follow camera, floor, overlays, adaptive quality
  input/                 keyboard, gamepad and touch joysticks → one ramped command
  lessons/               the four lessons, lesson runner, scoring, saved progress, explanations
  ui/                    home screen, lesson screen, HUD, lab panel, push menu, dialogs, loading
tests/
  unit/                  Vitest (Node, real MuJoCo WebAssembly and the real model files)
  e2e/                   Playwright (built site in headless Chromium)
  fixtures/              G1 policy golden data from PyTorch
tools/                   Python scripts that produce the assets and reference numbers
docs/                    architecture and third-party licences
.github/workflows/       CI and GitHub Pages deployment
```

## Regenerating the assets

The files in `public/` are generated from upstream sources with the scripts in `tools/`. You only
need this to update or check them. These are the exact sources used:

| Source | Revision | Used for |
|---|---|---|
| [unitreerobotics/unitree_rl_gym](https://github.com/unitreerobotics/unitree_rl_gym) | `276801e46c5d433564f24658bac64f254b7d2d4b` | `resources/robots/g1_description/g1_12dof.xml` and its meshes, `deploy/pre_train/g1/motion.pt`, `deploy/deploy_mujoco/configs/g1.yaml`, `LICENSE` |
| [google-deepmind/mujoco_menagerie](https://github.com/google-deepmind/mujoco_menagerie) | `c96a32d28fb5da84da38c1da4d749e7a13212855` | `unitree_go2/go2.xml`, `unitree_go2/assets/*.obj`, `unitree_go2/LICENSE`, `unitree_go2/README.md` |

```bash
# Python 3.11 with the same MuJoCo version as the web app
pip install mujoco==3.14.0 torch numpy trimesh fast-simplification pyyaml

git clone https://github.com/unitreerobotics/unitree_rl_gym.git /tmp/unitree_rl_gym
git -C /tmp/unitree_rl_gym checkout 276801e46c5d433564f24658bac64f254b7d2d4b
git clone https://github.com/google-deepmind/mujoco_menagerie.git /tmp/mujoco_menagerie
git -C /tmp/mujoco_menagerie checkout c96a32d28fb5da84da38c1da4d749e7a13212855

# 1. Copy the upstream models (only the meshes the G1 MJCF references).
G1=/tmp/unitree_rl_gym/resources/robots/g1_description
cp $G1/g1_12dof.xml /tmp/unitree_rl_gym/LICENSE public/models/g1/
for f in $(grep -o 'file="[^"]*"' $G1/g1_12dof.xml | cut -d'"' -f2); do cp "$G1/meshes/$f" public/models/g1/meshes/; done
GO2=/tmp/mujoco_menagerie/unitree_go2
cp $GO2/go2.xml $GO2/LICENSE $GO2/README.md public/models/go2/
cp $GO2/assets/*.obj public/models/go2/assets/

# 2. Simplify the meshes in place (G1 25 MB → 5 MB, Go2 28 MB → 1.5 MB).
python3 tools/optimize_meshes.py $G1/meshes $GO2/assets

# 3. Export the policy weights to public/policies/g1_walk.json.
python3 tools/export_g1_policy.py /tmp/unitree_rl_gym/deploy/pre_train/g1/motion.pt

# 4. Reference walking runs and tests/fixtures/g1_golden.json (100 PyTorch steps).
python3 tools/g1_reference.py /tmp/unitree_rl_gym/deploy/pre_train/g1/motion.pt --torque-limits

# 5. Go2 gait acceptance battery (add --pushes or --fuzz 24 for more).
python3 tools/go2_gait_lab.py
```

## Testing

* **Type check:** `npm run typecheck`.
* **Unit tests:** `npm test` runs 88 tests in about 40 s. They use the real MuJoCo WebAssembly
  build and the real model files in Node, so they test physics, not mocks. They cover the G1 policy
  against PyTorch, G1 and Go2 walking, turning, pushes and every knob, both robots completing the
  obstacle course with the autopilot, lesson scoring, saved progress and input mapping.
* **End-to-end:** `npm run test:e2e` builds the site, serves it on port 4173 and, for each robot,
  drives it in headless Chromium with software WebGL (SwiftShader). It walks it forward with the
  keyboard, visits every lesson, checks tablet layouts for overflow and fails on any console error.
  Screenshots go to `test-results/screenshots/`. On your own machine run `npx playwright install
  chromium` once, or point `PLAYWRIGHT_CHROMIUM` at an existing Chromium binary.
* **Reference numbers:** `tools/g1_reference.py` and `tools/go2_gait_lab.py` (see above) are the
  Python ground truth that the TypeScript tests compare against.

CI (`.github/workflows/ci.yml`) runs the type check, unit tests, build and end-to-end tests on every
push and pull request.

## Deploying to GitHub Pages

`.github/workflows/pages.yml` builds the site and publishes `dist/` to GitHub Pages on every push to
`main`. It only works after Pages is set to use GitHub Actions, once per repository:

1. Open the repository on GitHub → **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Push to `main` (or run the "Deploy to GitHub Pages" workflow by hand from the **Actions** tab).

The site then appears at `https://<user>.github.io/robotics-training-sim/`. Because the build uses
relative paths, no base-path setting is needed.

## Roadmap

Phase 1 (this release) is the browser simulator with two legged robots and four lessons.

* **Phase 2: more to learn.** Robot-arm lessons (joints and reach, inverse kinematics, pick and
  place), more robots, and a scenario editor so teachers can build their own courses and challenges.
* **Phase 3: train your own robot.** A training pipeline with
  [MuJoCo Playground](https://playground.mujoco.org/) and
  [Isaac Lab](https://github.com/isaac-sim/IsaacLab): students change rewards and randomisation, train
  a walking policy, then load it into the browser and compare it with Unitree's.
* **Phase 4: toward real robots.** A ROS 2 bridge so the same lessons can drive real or
  ROS-simulated robots, and a photoreal rendering tier for perception lessons.

## Credits

* **Unitree Robotics** for the G1 and Go2 robot models and the pretrained G1 walking policy
  ([unitree_rl_gym](https://github.com/unitreerobotics/unitree_rl_gym), BSD-3-Clause).
* **Google DeepMind** for [MuJoCo](https://github.com/google-deepmind/mujoco) and its WebAssembly
  bindings (Apache-2.0), and the [MuJoCo Menagerie](https://github.com/google-deepmind/mujoco_menagerie)
  Go2 model (BSD-3-Clause, © Unitree Robotics).
* **[three.js](https://threejs.org/)** for 3D rendering (MIT).
* Marc Raibert's foot-placement rule, from his 1980s hopping robots, keeps the Go2 on its feet.

Full licence and attribution details, including the changes made to Unitree's files:
[docs/THIRD_PARTY.md](docs/THIRD_PARTY.md). This project is not affiliated with or endorsed by
Unitree Robotics or Google DeepMind.
