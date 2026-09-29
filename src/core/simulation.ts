/**
 * The simulation: one robot in the warehouse, stepped at 500 Hz by MuJoCo.
 * Owns the knobs (friction, payload, motor strength, sensor noise, time scale), pushes,
 * fall detection and the robot state snapshot used by the HUD, lessons and tests.
 */
import { WAREHOUSE } from './arena';
import { compileScene, loadMujoco, type LoadFile, type LoadProgress } from './mujoco';
import { ROBOTS, createController } from '../robots/registry';
import {
  DEFAULT_KNOBS,
  type ArenaLayout,
  type MjData,
  type MjModel,
  type MotionCommand,
  type Mujoco,
  type PhysicsKnobs,
  type RobotController,
  type RobotId,
  type RobotInfo,
  type RobotState,
  type SimulationApi,
  type SpawnPose,
} from './types';

/** Physics step, seconds (500 Hz, as in Unitree's deploy_mujoco). */
export const TIMESTEP = 0.002;
/** advance() never simulates more than this much time per call, so a slow frame can't freeze the tab. */
export const MAX_ADVANCE_S = 0.1;
const DEFAULT_PUSH_S = 0.1;

export interface SimulationOptions {
  robot: RobotId;
  /** Reads files relative to the site root: `fetchFile` in the browser, fs in Node. */
  loadFile: LoadFile;
  arena?: ArenaLayout;
  /** Where the robot starts; defaults to the arena's start pad. */
  spawn?: SpawnPose;
  knobs?: Partial<PhysicsKnobs>;
  /** Seed for the sensor-noise random numbers; the sequence restarts on every reset. */
  seed?: number;
  /** Download progress, counted in files. */
  onProgress?: LoadProgress;
}

type SimEvent = 'fall' | 'reset';

export class Simulation implements SimulationApi {
  paused = false;

  private readonly controller: RobotController;
  private readonly seed: number;
  private rng: () => number;
  private currentKnobs: PhysicsKnobs = { ...DEFAULT_KNOBS };
  private currentCommand: MotionCommand = { vx: 0, vy: 0, yawRate: 0 };
  private spawn: SpawnPose;
  private accumulator = 0;
  private push_: { forceN: number; directionRad: number; remainingS: number } | null = null;
  private pushStepsLeft = 0;
  private fallen = false;
  private disposed = false;
  private readonly listeners: Record<SimEvent, Set<() => void>> = { fall: new Set(), reset: new Set() };

  private readonly baseBody: number;
  private readonly baseQpos: number;
  private readonly baseQvel: number;
  /** Foot index for every geom (-1 = not a foot). */
  private readonly geomFoot: Int32Array;
  /** Model values before any knob touched them. */
  private readonly original: {
    baseMass: number;
    baseInertia: Float64Array;
    actuatorForceRange: Float64Array;
    actuatorCtrlRange: Float64Array;
  };

  static async create(options: SimulationOptions): Promise<Simulation> {
    const robot = ROBOTS[options.robot];
    const arena = options.arena ?? WAREHOUSE;
    const mujoco = await loadMujoco();
    const [scene, controller] = await Promise.allSettled([
      compileScene(mujoco, robot, arena, options.loadFile, options.onProgress),
      createController(options.robot, options.loadFile),
    ]);
    if (scene.status === 'rejected') throw scene.reason;
    const model = scene.value;
    let data: MjData | null = null;
    try {
      if (controller.status === 'rejected') throw controller.reason;
      data = new mujoco.MjData(model);
      return new Simulation(mujoco, model, data, robot, arena, controller.value, options);
    } catch (err) {
      data?.delete();
      model.delete();
      throw err;
    }
  }

  private constructor(
    readonly mujoco: Mujoco,
    readonly model: MjModel,
    readonly data: MjData,
    readonly robot: RobotInfo,
    readonly arena: ArenaLayout,
    controller: RobotController,
    options: SimulationOptions,
  ) {
    this.controller = controller;
    this.seed = options.seed ?? 1;
    this.rng = mulberry32(this.seed);
    this.spawn = options.spawn ?? arena.spawns.start;
    model.opt.timestep = TIMESTEP;

    this.baseBody = this.id(mujoco.mjtObj.mjOBJ_BODY.value, robot.baseBody, 'base body');
    const baseJoint = model.body_jntadr[this.baseBody] as number;
    if (baseJoint < 0 || model.jnt_type[baseJoint] !== mujoco.mjtJoint.mjJNT_FREE.value) {
      throw new Error(`${robot.baseBody} must have a free joint`);
    }
    this.baseQpos = model.jnt_qposadr[baseJoint] as number;
    this.baseQvel = model.jnt_dofadr[baseJoint] as number;
    this.geomFoot = this.footGeoms();

    this.original = {
      baseMass: model.body_mass[this.baseBody] as number,
      baseInertia: (model.body_inertia as Float64Array).slice(3 * this.baseBody, 3 * this.baseBody + 3),
      actuatorForceRange: Float64Array.from(model.jnt_actfrcrange as Float64Array),
      actuatorCtrlRange: Float64Array.from(model.actuator_ctrlrange as Float64Array),
    };
    this.applyKnobs({ ...DEFAULT_KNOBS, ...options.knobs });
    this.reset();
  }

  get knobs(): PhysicsKnobs {
    return { ...this.currentKnobs };
  }

  get command(): MotionCommand {
    return { ...this.currentCommand };
  }

  get activePush(): { forceN: number; directionRad: number; remainingS: number } | null {
    return this.push_ ? { ...this.push_ } : null;
  }

  setKnobs(knobs: Partial<PhysicsKnobs>): void {
    this.applyKnobs({ ...this.currentKnobs, ...knobs });
  }

  setCommand(command: MotionCommand): void {
    const max = this.robot.maxCommand;
    this.currentCommand = {
      vx: clamp(command.vx, -max.vx, max.vx),
      vy: clamp(command.vy, -max.vy, max.vy),
      yawRate: clamp(command.yawRate, -max.yawRate, max.yawRate),
    };
  }

  advance(realSeconds: number): number {
    if (this.paused || this.disposed) return 0;
    this.accumulator += Math.max(0, realSeconds) * this.currentKnobs.timeScale;
    const maxSteps = Math.round(MAX_ADVANCE_S / TIMESTEP);
    let steps = Math.floor(this.accumulator / TIMESTEP + 1e-9);
    if (steps > maxSteps) {
      // Too far behind real time: drop the backlog instead of trying to catch up later.
      steps = maxSteps;
      this.accumulator = 0;
    } else {
      this.accumulator = Math.max(0, this.accumulator - steps * TIMESTEP);
    }
    for (let i = 0; i < steps; i++) this.stepOnce();
    return steps;
  }

  stepOnce(): void {
    if (this.disposed) return;
    const { model, data } = this;
    this.controller.step(model, data, this.currentCommand, this.currentKnobs, this.rng);
    this.mujoco.mj_step(model, data);
    if (this.push_ && --this.pushStepsLeft <= 0) this.endPush();
    else if (this.push_) this.push_.remainingS = this.pushStepsLeft * TIMESTEP;
    if (!this.fallen && this.isFallen()) {
      this.fallen = true;
      this.emit('fall');
    }
  }

  reset(spawn?: SpawnPose): void {
    if (this.disposed) return;
    if (spawn) this.spawn = spawn;
    const { mujoco, model, data } = this;
    // Robots with a keyframe (Go2's "home" crouch) start from it; G1 starts from its MJCF pose like Unitree's script.
    if (model.nkey > 0) mujoco.mj_resetDataKeyframe(model, data, 0);
    else mujoco.mj_resetData(model, data);
    const qpos = data.qpos as Float64Array;
    const a = this.baseQpos;
    qpos[a] = this.spawn.x;
    qpos[a + 1] = this.spawn.y;
    qpos[a + 3] = Math.cos(this.spawn.heading / 2);
    qpos[a + 4] = 0;
    qpos[a + 5] = 0;
    qpos[a + 6] = Math.sin(this.spawn.heading / 2);

    this.endPush();
    this.accumulator = 0;
    this.fallen = false;
    this.rng = mulberry32(this.seed);
    this.controller.reset(model, data);
    mujoco.mj_forward(model, data);
    this.emit('reset');
  }

  push(forceN: number, directionRad: number, durationS = DEFAULT_PUSH_S): void {
    if (this.disposed) return;
    this.pushStepsLeft = Math.max(1, Math.round(durationS / TIMESTEP));
    this.push_ = { forceN, directionRad, remainingS: this.pushStepsLeft * TIMESTEP };
    // xfrc_applied is a world-frame force at the body's centre of mass, held until we clear it.
    const f = data6(this.data.xfrc_applied as Float64Array, this.baseBody);
    f[0] = forceN * Math.cos(directionRad);
    f[1] = forceN * Math.sin(directionRad);
    f[2] = 0;
  }

  getState(): RobotState {
    const qpos = this.data.qpos as Float64Array;
    const qvel = this.data.qvel as Float64Array;
    const a = this.baseQpos;
    const v = this.baseQvel;
    const heading = yawOf(qpos, a);
    const c = Math.cos(heading), s = Math.sin(heading);
    // Free-joint linear velocity is in the world frame; rotate it into the robot's heading frame.
    const vxW = qvel[v], vyW = qvel[v + 1];
    return {
      time: this.data.time,
      position: [qpos[a], qpos[a + 1], qpos[a + 2]],
      heading,
      velocity: [c * vxW + s * vyW, -s * vxW + c * vyW],
      tilt: tiltOf(qpos, a),
      fallen: this.fallen,
      torques: Float64Array.from(this.controller.torques),
      torqueLimits: Float64Array.from(this.controller.torqueLimits),
      footContacts: this.footContacts(),
    };
  }

  on(event: SimEvent, handler: () => void): () => void {
    this.listeners[event].add(handler);
    return () => this.listeners[event].delete(handler);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.fall.clear();
    this.listeners.reset.clear();
    this.data.delete();
    this.model.delete();
  }

  private applyKnobs(knobs: PhysicsKnobs): void {
    const { model, original } = this;
    // Friction: SET every geom's sliding friction to the knob value. A contact uses the larger of its two
    // geoms' values (or the higher-priority geom's), so every contact then has exactly this coefficient.
    // Torsional and rolling friction keep their MJCF values.
    const friction = model.geom_friction as Float64Array;
    for (let g = 0; g < model.ngeom; g++) friction[3 * g] = knobs.friction;

    // Payload: extra mass on the base body, with its inertia scaled by the same ratio (as if the load were
    // spread like the torso itself).
    const mass = original.baseMass + knobs.payloadKg;
    const masses = model.body_mass as Float64Array;
    if (masses[this.baseBody] !== mass) {
      masses[this.baseBody] = mass;
      const inertia = model.body_inertia as Float64Array;
      for (let k = 0; k < 3; k++) inertia[3 * this.baseBody + k] = (original.baseInertia[k] * mass) / original.baseMass;
      this.refreshModelConstants();
    }

    // Motor strength: controllers scale their own torque clipping and stiffness. The MJCF's own torque
    // limits are scaled too, so they don't cap stronger motors at the factory limit: the G1 sets them per
    // joint (actuatorfrcrange), the Go2 per motor (ctrlrange; both robots' actuators are torque motors).
    const range = model.jnt_actfrcrange as Float64Array;
    for (let k = 0; k < range.length; k++) range[k] = original.actuatorForceRange[k] * knobs.motorStrength;
    const ctrlRange = model.actuator_ctrlrange as Float64Array;
    for (let k = 0; k < ctrlRange.length; k++) ctrlRange[k] = original.actuatorCtrlRange[k] * knobs.motorStrength;

    this.currentKnobs = { ...knobs };
  }

  /** Recomputes model quantities derived from masses (subtree masses, constraint scaling). */
  private refreshModelConstants(): void {
    // mj_setConst uses its mjData as scratch space, so give it a throwaway one instead of the live state.
    const scratch = new this.mujoco.MjData(this.model);
    try {
      this.mujoco.mj_setConst(this.model, scratch);
    } finally {
      scratch.delete();
    }
  }

  private endPush(): void {
    this.push_ = null;
    this.pushStepsLeft = 0;
    data6(this.data.xfrc_applied as Float64Array, this.baseBody).fill(0);
  }

  private isFallen(): boolean {
    const qpos = this.data.qpos as Float64Array;
    return qpos[this.baseQpos + 2] < this.robot.fallHeight || tiltOf(qpos, this.baseQpos) > this.robot.fallTilt;
  }

  private footContacts(): boolean[] {
    const touching = this.robot.feet.map(() => false);
    // data.contact is a copy of the contact list; it and every element read from it must be freed.
    const contacts = this.data.contact;
    try {
      const n = Math.min(this.data.ncon, contacts.size());
      for (let i = 0; i < n; i++) {
        const contact = contacts.get(i);
        if (!contact) continue;
        const f1 = this.geomFoot[contact.geom1];
        const f2 = this.geomFoot[contact.geom2];
        contact.delete();
        if (f1 >= 0) touching[f1] = true;
        if (f2 >= 0) touching[f2] = true;
      }
    } finally {
      contacts.delete();
    }
    return touching;
  }

  /** Maps every geom of each foot (a geom name, or a body name meaning all its geoms) to the foot's index. */
  private footGeoms(): Int32Array {
    const { model, mujoco } = this;
    const map = new Int32Array(model.ngeom).fill(-1);
    const geomBody = model.geom_bodyid as Int32Array;
    this.robot.feet.forEach((name, foot) => {
      const geom = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_GEOM.value, name);
      if (geom >= 0) {
        map[geom] = foot;
        return;
      }
      const body = this.id(mujoco.mjtObj.mjOBJ_BODY.value, name, 'foot geom or body');
      for (let g = 0; g < model.ngeom; g++) if (geomBody[g] === body) map[g] = foot;
    });
    return map;
  }

  private id(type: number, name: string, what: string): number {
    const id = this.mujoco.mj_name2id(this.model, type, name);
    if (id < 0) throw new Error(`${this.robot.name}: no ${what} named "${name}" in the model`);
    return id;
  }

  private emit(event: SimEvent): void {
    for (const handler of [...this.listeners[event]]) handler();
  }
}

/** The 6 xfrc_applied values (force xyz, torque xyz) of one body. */
function data6(array: Float64Array, body: number): Float64Array {
  return array.subarray(6 * body, 6 * body + 6);
}

/** Heading of a free joint's quaternion (qpos[a+3..a+6], w x y z): where its x axis points, 0 = +x. */
function yawOf(qpos: Float64Array, a: number): number {
  const w = qpos[a + 3], x = qpos[a + 4], y = qpos[a + 5], z = qpos[a + 6];
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
}

/** Angle between the body's z axis and world up. */
function tiltOf(qpos: Float64Array, a: number): number {
  const x = qpos[a + 4], y = qpos[a + 5];
  return Math.acos(clamp(1 - 2 * (x * x + y * y), -1, 1));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Small, fast seeded PRNG (mulberry32): the same seed always gives the same noise. */
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
