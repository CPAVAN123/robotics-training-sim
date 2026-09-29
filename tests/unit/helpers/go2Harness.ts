/**
 * Minimal Go2 test bench: a flat floor plus go2.xml, the robot in its "home" keyframe, and the
 * trot controller stepped at 2 ms on the real MuJoCo WASM build. Mirrors run() in
 * tools/go2_gait_lab.py so TypeScript and Python results can be compared directly.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadMujoco } from '../../../src/core/mujoco';
import { DEFAULT_KNOBS, type MjData, type MjModel, type MotionCommand, type Mujoco, type PhysicsKnobs } from '../../../src/core/types';
import { createGo2Controller } from '../../../src/robots/go2/controller';
import { GO2_INFO } from '../../../src/robots/go2/info';

const MODEL_DIR = fileURLToPath(new URL('../../../public/models/go2/', import.meta.url));
const SCENE = `<mujoco model="go2 test bench">
  <include file="go2.xml"/>
  <worldbody><geom name="floor" size="0 0 0.05" type="plane"/></worldbody>
</mujoco>`;
const TIMESTEP = 0.002;
let benches = 0;

export interface Push {
  /** Start time, s. */
  at: number;
  forceN: number;
  /** World-frame direction the force points, rad (0 = +x). */
  directionRad: number;
  durationS: number;
}

export interface RunOptions {
  seconds: number;
  command: (t: number) => MotionCommand;
  knobs?: Partial<PhysicsKnobs>;
  pushes?: Push[];
  seed?: number;
}

export interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  /** Unwrapped heading change since the start, rad. */
  heading: number;
  stepping: boolean;
}

export interface RunResult {
  x: number;
  y: number;
  z: number;
  heading: number;
  minZ: number;
  maxTilt: number;
  /** Time of the first fall (GO2_INFO.fallHeight / fallTilt), or null. */
  fellAt: number | null;
  /** Final horizontal speed, m/s. */
  speed: number;
  stepping: boolean;
  /** Largest |torque| / limit seen on any motor. */
  peakTorqueRatio: number;
  /** State every 0.1 s. */
  samples: Sample[];
}

export interface Go2Bench {
  readonly mujoco: Mujoco;
  readonly model: MjModel;
  readonly data: MjData;
  run(options: RunOptions): RunResult;
  dispose(): void;
}

export async function createGo2Bench(): Promise<Go2Bench> {
  const mujoco = await loadMujoco();
  const root = `/go2bench${++benches}`;
  writeModelFiles(mujoco, root);
  const model = mujoco.MjModel.from_xml_path(`${root}/scene.xml`);
  const data = new mujoco.MjData(model);
  const opt = model.opt;
  opt.timestep = TIMESTEP;
  opt.delete();
  const base = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, GO2_INFO.baseBody);
  const friction = Float64Array.from(model.geom_friction as Float64Array);
  const mass = model.body_mass[base] as number;
  const inertia = (model.body_inertia as Float64Array).slice(3 * base, 3 * base + 3);

  function applyKnobs(knobs: PhysicsKnobs): void {
    const f = model.geom_friction as Float64Array;
    f.set(friction);
    for (let g = 0; g < model.ngeom; g++) f[3 * g] = knobs.friction;
    const m = mass + knobs.payloadKg;
    (model.body_mass as Float64Array)[base] = m;
    const I = model.body_inertia as Float64Array;
    for (let i = 0; i < 3; i++) I[3 * base + i] = (inertia[i] * m) / mass;
    const scratch = new mujoco.MjData(model);
    mujoco.mj_setConst(model, scratch);
    scratch.delete();
  }

  return {
    mujoco,
    model,
    data,
    run(options: RunOptions): RunResult {
      const knobs: PhysicsKnobs = { ...DEFAULT_KNOBS, ...options.knobs };
      applyKnobs(knobs);
      mujoco.mj_resetDataKeyframe(model, data, 0);
      mujoco.mj_forward(model, data);
      const controller = createGo2Controller();
      controller.reset(model, data);
      return simulate(mujoco, model, data, base, controller, knobs, options);
    },
    dispose() {
      data.delete();
      model.delete();
    },
  };
}

function simulate(
  mujoco: Mujoco,
  model: MjModel,
  data: MjData,
  base: number,
  controller: ReturnType<typeof createGo2Controller>,
  knobs: PhysicsKnobs,
  { seconds, command, pushes = [], seed = 1 }: RunOptions,
): RunResult {
  const rng = mulberry32(seed);
  const qpos = data.qpos as Float64Array;
  const qvel = data.qvel as Float64Array;
  const xfrc = data.xfrc_applied as Float64Array;
  let prevYaw = yawOf(qpos);
  let heading = 0;
  let minZ = Infinity;
  let maxTilt = 0;
  let fellAt: number | null = null;
  let peakTorqueRatio = 0;
  const samples: Sample[] = [];
  const steps = Math.round(seconds / TIMESTEP);
  for (let n = 0; n < steps; n++) {
    const t = data.time;
    controller.step(model, data, command(t), knobs, rng);
    for (let i = 0; i < 12; i++) {
      peakTorqueRatio = Math.max(peakTorqueRatio, Math.abs(controller.torques[i]) / controller.torqueLimits[i]);
    }
    xfrc.fill(0, 6 * base, 6 * base + 6);
    for (const p of pushes) {
      if (t >= p.at && t < p.at + p.durationS) {
        xfrc[6 * base] = p.forceN * Math.cos(p.directionRad);
        xfrc[6 * base + 1] = p.forceN * Math.sin(p.directionRad);
      }
    }
    mujoco.mj_step(model, data);
    const yaw = yawOf(qpos);
    heading += Math.atan2(Math.sin(yaw - prevYaw), Math.cos(yaw - prevYaw));
    prevYaw = yaw;
    const tilt = Math.acos(Math.min(1, 1 - 2 * (qpos[4] * qpos[4] + qpos[5] * qpos[5])));
    minZ = Math.min(minZ, qpos[2]);
    maxTilt = Math.max(maxTilt, tilt);
    if (fellAt === null && (qpos[2] < GO2_INFO.fallHeight || tilt > GO2_INFO.fallTilt)) fellAt = data.time;
    if ((n + 1) % 50 === 0) {
      samples.push({ t: data.time, x: qpos[0], y: qpos[1], z: qpos[2], heading, stepping: controller.stepping });
    }
  }
  return {
    x: qpos[0],
    y: qpos[1],
    z: qpos[2],
    heading,
    minZ,
    maxTilt,
    fellAt,
    speed: Math.hypot(qvel[0], qvel[1]),
    stepping: controller.stepping,
    peakTorqueRatio,
    samples,
  };
}

/** Writes go2.xml, its meshes and the bench scene into MuJoCo's in-memory file system. */
function writeModelFiles(mujoco: Mujoco, root: string): void {
  mujoco.FS.mkdirTree(`${root}/assets`, 0o777);
  mujoco.FS.writeFile(`${root}/go2.xml`, readFileSync(`${MODEL_DIR}go2.xml`));
  for (const file of readdirSync(`${MODEL_DIR}assets`)) {
    mujoco.FS.writeFile(`${root}/assets/${file}`, readFileSync(`${MODEL_DIR}assets/${file}`));
  }
  mujoco.FS.writeFile(`${root}/scene.xml`, SCENE);
}

function yawOf(q: Float64Array): number {
  return Math.atan2(2 * (q[3] * q[6] + q[4] * q[5]), 1 - 2 * (q[5] * q[5] + q[6] * q[6]));
}

/** Same seeded generator as the Simulation (mulberry32), uniform in [0, 1). */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
