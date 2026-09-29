/**
 * Shared contracts between the simulation core, robot controllers, renderer, input and lessons.
 * Every module codes against these types; keep them small and stable.
 */
import type { MainModule, MjModel, MjData } from '@mujoco/mujoco';

export type Mujoco = MainModule;
export type { MjModel, MjData };

/** Which robot is loaded. */
export type RobotId = 'g1' | 'go2';

/**
 * What the student asks the robot to do, in the robot's own heading frame.
 * vx: forward m/s, vy: left m/s, yawRate: counter-clockwise rad/s.
 */
export interface MotionCommand {
  vx: number;
  vy: number;
  yawRate: number;
}

/** Physics settings students can change in the Physics Lab panel. */
export interface PhysicsKnobs {
  /** Sliding friction coefficient for every contact (ice ≈ 0.1, rubber on concrete ≈ 1.0). */
  friction: number;
  /** Extra mass strapped to the robot's torso, kg. */
  payloadKg: number;
  /** Multiplier on motor torque limits and PD stiffness (1 = factory spec). */
  motorStrength: number;
  /** Standard deviation multiplier for sensor noise (0 = perfect sensors, 1 = realistic IMU/encoder noise). */
  sensorNoise: number;
  /** Simulation speed multiplier (0.25 = slow motion, 1 = real time). */
  timeScale: number;
}

export const DEFAULT_KNOBS: PhysicsKnobs = {
  friction: 1.0,
  payloadKg: 0,
  motorStrength: 1.0,
  sensorNoise: 0,
  timeScale: 1.0,
};

/** Snapshot of the robot for lessons, HUD and tests. Units: metres, radians, seconds. */
export interface RobotState {
  time: number;
  /** World position of the robot's base (pelvis for G1, trunk for Go2). */
  position: [number, number, number];
  /** Heading (yaw) in radians, 0 = facing +x. */
  heading: number;
  /** Forward/left speed in the heading frame, m/s. */
  velocity: [number, number];
  /** Tilt of the torso from upright, radians. */
  tilt: number;
  /** True once the robot has fallen (base too low or tilted past the robot's limit). */
  fallen: boolean;
  /** Latest applied joint torques (N·m), in actuator order. */
  torques: Float64Array;
  /** Torque limit per actuator (N·m) after the motor-strength knob. */
  torqueLimits: Float64Array;
  /** True for each foot currently touching something. */
  footContacts: boolean[];
}

/**
 * A robot controller turns a MotionCommand into actuator controls every physics step.
 * G1 uses Unitree's pretrained neural-network policy; Go2 uses a model-based trot gait.
 */
export interface RobotController {
  readonly robot: RobotId;
  /** Called once after the model is compiled and after every reset. */
  reset(model: MjModel, data: MjData): void;
  /**
   * Called before every mj_step. Must write data.ctrl. `dt` is model.opt.timestep.
   * Controllers run their own decimation internally (e.g. G1 policy at 50 Hz).
   */
  step(model: MjModel, data: MjData, command: MotionCommand, knobs: PhysicsKnobs, rng: () => number): void;
  /** Latest torques and limits, for the HUD's motor-load bars. */
  readonly torques: Float64Array;
  readonly torqueLimits: Float64Array;
}

/** Static description of each robot for UI and lessons. */
export interface RobotInfo {
  id: RobotId;
  name: string;
  maker: string;
  kind: 'humanoid' | 'quadruped';
  /** Folder under public/models/ with the MJCF file and meshes. */
  modelDir: string;
  /** Robot MJCF file inside modelDir. */
  mjcf: string;
  /** Body name of the base, used for tracking, pushes and payload. */
  baseBody: string;
  /** Geom or body names of the feet, for contact display. */
  feet: string[];
  /** Safe command range for keyboard/gamepad scaling. */
  maxCommand: MotionCommand;
  /** Base height below which the robot counts as fallen, metres. */
  fallHeight: number;
  /** Tilt beyond which the robot counts as fallen, radians. */
  fallTilt: number;
  /** One-paragraph plain-language description for students. */
  blurb: string;
}

/** A checkpoint ring on the floor that lessons use for navigation goals. */
export interface Checkpoint {
  id: string;
  label: string;
  x: number;
  y: number;
  /** Reached when the robot base is within this horizontal distance, metres. */
  radius: number;
}

/** A static obstacle in the warehouse arena (all are boxes; ramps are tilted boxes). */
export interface Obstacle {
  name: string;
  kind: 'wall' | 'crate' | 'ramp' | 'bump' | 'pallet';
  /** Centre position, metres. */
  pos: [number, number, number];
  /** Half-sizes, metres (MuJoCo box convention). */
  halfSize: [number, number, number];
  /** Rotation about z (yaw) then y (pitch, for ramps), radians. */
  yaw?: number;
  pitch?: number;
  rgba: [number, number, number, number];
}

/** A spawn pose for the robot. */
export interface SpawnPose {
  x: number;
  y: number;
  heading: number;
}

/** Arena layout shared by the simulation (which builds MJCF from it) and the lessons. */
export interface ArenaLayout {
  size: [number, number];
  obstacles: Obstacle[];
  checkpoints: Checkpoint[];
  spawns: Record<'start' | 'pushPad' | 'lab', SpawnPose>;
}

/**
 * The simulation object the app, renderer and lessons use.
 * Implemented by src/core/simulation.ts.
 */
export interface SimulationApi {
  readonly mujoco: Mujoco;
  readonly model: MjModel;
  readonly data: MjData;
  readonly robot: RobotInfo;
  readonly arena: ArenaLayout;
  /** Current physics knobs (read-only copy). */
  readonly knobs: PhysicsKnobs;
  /** Change one or more knobs; takes effect immediately. */
  setKnobs(knobs: Partial<PhysicsKnobs>): void;
  /** Set what the robot should do; values are clamped to robot.maxCommand. */
  setCommand(command: MotionCommand): void;
  readonly command: MotionCommand;
  /** Pause/resume physics. */
  paused: boolean;
  /**
   * Advance physics to keep up with `realSeconds` of wall-clock time (scaled by knobs.timeScale).
   * Caps work per call so a slow frame can't freeze the tab. Returns physics steps taken.
   */
  advance(realSeconds: number): number;
  /** Take exactly one physics step (for tests and single-stepping). */
  stepOnce(): void;
  /** Reset robot to a spawn pose, clear controller state and pushes. */
  reset(spawn?: SpawnPose): void;
  /**
   * Shove the robot's base horizontally: `forceN` newtons for `durationS` seconds,
   * `directionRad` in world frame (0 = +x). Shows up in `activePush` while applied.
   */
  push(forceN: number, directionRad: number, durationS?: number): void;
  readonly activePush: { forceN: number; directionRad: number; remainingS: number } | null;
  /** Snapshot of the robot for HUD, lessons and tests. */
  getState(): RobotState;
  /** Subscribe to events. Returns an unsubscribe function. */
  on(event: 'fall' | 'reset', handler: () => void): () => void;
  /** Free WASM memory. */
  dispose(): void;
}
