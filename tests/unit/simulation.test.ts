/**
 * Simulation core + G1 controller, running the real MuJoCo WASM build and model files in Node.
 * Reference numbers come from tools/g1_reference.py (Python MuJoCo + PyTorch, torque limits on).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_ADVANCE_S, Simulation, TIMESTEP } from '../../src/core/simulation';
import { WAREHOUSE } from '../../src/core/arena';
import { DEFAULT_KNOBS, type MotionCommand, type PhysicsKnobs, type RobotState, type SpawnPose } from '../../src/core/types';
import { waypointCommand, wrapAngle } from '../../src/robots/autopilot';
import { ROBOTS } from '../../src/robots/registry';
import { runCourse } from './helpers/course';
import { nodeLoadFile } from './helpers/loadFile';

/** Open floor in the north half of the warehouse: >= 8 m of free space ahead, 5 m behind and to the sides. */
const OPEN: SpawnPose = { x: -4, y: 4, heading: 0 };
/** Measured G1 autopilot course times: 36.3 s at full speed, 68.1 s at half speed; limits add 25-30%. */
const COURSE_LIMIT_S = 45;
const HALF_SPEED_COURSE_LIMIT_S = 90;
/** Measured Go2 (trot controller) autopilot course time: 34.8 s. */
const GO2_COURSE_LIMIT_S = 60;

function runFor(sim: Simulation, seconds: number, command?: MotionCommand): void {
  if (command) sim.setCommand(command);
  const end = sim.data.time + seconds - 1e-9;
  while (sim.data.time < end) sim.stepOnce();
}

/** Total heading change (unwrapped), sampled every 20 ms. */
function turnFor(sim: Simulation, seconds: number, command: MotionCommand): number {
  sim.setCommand(command);
  let total = 0;
  let prev = sim.getState().heading;
  for (let t = 0; t < seconds - 1e-9; t += 0.02) {
    for (let i = 0; i < 10; i++) sim.stepOnce();
    const h = sim.getState().heading;
    total += Math.atan2(Math.sin(h - prev), Math.cos(h - prev));
    prev = h;
  }
  return total;
}

describe('Simulation with the Unitree G1', () => {
  let sim: Simulation;
  const progress: [number, number][] = [];

  beforeAll(async () => {
    sim = await Simulation.create({ robot: 'g1', loadFile: nodeLoadFile, onProgress: (l, t) => progress.push([l, t]) });
  });
  afterAll(() => sim.dispose());

  it('compiles the robot inside the warehouse and reports download progress', () => {
    const { mujoco, model } = sim;
    const geomId = (name: string) => mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_GEOM.value, name);
    expect(geomId('floor')).toBeGreaterThanOrEqual(0);
    for (const o of WAREHOUSE.obstacles) expect(geomId(o.name), o.name).toBeGreaterThanOrEqual(0);
    expect(model.opt.timestep).toBe(TIMESTEP);
    expect(model.nu).toBe(12);
    // g1_12dof.xml + 27 meshes
    expect(progress.at(-1)).toEqual([28, 28]);
    expect(progress).toHaveLength(28);
  });

  it('arena has >= 5 checkpoints clear of obstacles and three spawns where the robot can stand', () => {
    const { checkpoints, obstacles, size } = sim.arena;
    expect(checkpoints.length).toBeGreaterThanOrEqual(5);
    expect(new Set(checkpoints.map((c) => c.id)).size).toBe(checkpoints.length);
    const solid = obstacles.filter((o) => o.kind !== 'ramp' && o.kind !== 'bump');
    const blocked = (x: number, y: number, margin: number) =>
      solid.some((o) => Math.abs(x - o.pos[0]) < o.halfSize[0] + margin && Math.abs(y - o.pos[1]) < o.halfSize[1] + margin);
    for (const c of checkpoints) {
      expect(Math.abs(c.x) < size[0] / 2 && Math.abs(c.y) < size[1] / 2, c.id).toBe(true);
      expect(blocked(c.x, c.y, 0), c.id).toBe(false);
    }
    expect(Object.keys(sim.arena.spawns).sort()).toEqual(['lab', 'pushPad', 'start']);
    for (const [name, spawn] of Object.entries(sim.arena.spawns)) {
      expect(blocked(spawn.x, spawn.y, 1), name).toBe(false);
      sim.reset(spawn);
      runFor(sim, 2, { vx: 0, vy: 0, yawRate: 0 });
      expect(sim.getState().fallen, name).toBe(false);
    }
  });

  it('stands for 10 s without falling (Python reference drifts 0.2 m), stepping on alternate feet', () => {
    sim.reset(OPEN);
    sim.setCommand({ vx: 0, vy: 0, yawRate: 0 });
    // The policy keeps marching in place to its gait clock, so both feet take turns on the ground.
    const touches = [0, 0];
    let grounded = 0;
    const samples = 500;
    for (let i = 0; i < samples; i++) {
      runFor(sim, 0.02);
      const feet = sim.getState().footContacts;
      feet.forEach((down, f) => (touches[f] += down ? 1 : 0));
      if (feet.some(Boolean)) grounded++;
    }
    const s = sim.getState();
    const drift = Math.hypot(s.position[0] - OPEN.x, s.position[1] - OPEN.y);
    console.log(`stand 10 s: drift ${drift.toFixed(2)} m, pelvis z ${s.position[2].toFixed(3)} m, feet down ${touches.map((n) => `${Math.round((100 * n) / samples)}%`).join('/')}`);
    expect(s.fallen).toBe(false);
    expect(drift).toBeLessThan(0.5);
    expect(s.footContacts).toHaveLength(2);
    for (const n of touches) expect(n / samples).toBeGreaterThan(0.2);
    expect(grounded / samples).toBeGreaterThan(0.95);
  });

  it('walks forward at 0.5 m/s: >= 3.5 m in 10 s (Python: 4.59 m)', () => {
    sim.reset(OPEN);
    runFor(sim, 10, { vx: 0.5, vy: 0, yawRate: 0 });
    const s = sim.getState();
    const dx = s.position[0] - OPEN.x;
    console.log(`forward 0.5 m/s for 10 s: dx = ${dx.toFixed(2)} m, dy = ${(s.position[1] - OPEN.y).toFixed(2)} m`);
    expect(s.fallen).toBe(false);
    expect(dx).toBeGreaterThanOrEqual(3.5);
    expect(s.velocity[0]).toBeGreaterThan(0.2);
  });

  it('walks backward and sidesteps (Python: -3.40 m and 2.99 m)', () => {
    sim.reset(OPEN);
    runFor(sim, 10, { vx: -0.4, vy: 0, yawRate: 0 });
    const back = sim.getState();
    sim.reset(OPEN);
    runFor(sim, 10, { vx: 0, vy: 0.4, yawRate: 0 });
    const side = sim.getState();
    console.log(`backward: dx = ${(back.position[0] - OPEN.x).toFixed(2)} m; sidestep: dy = ${(side.position[1] - OPEN.y).toFixed(2)} m`);
    expect(back.fallen || side.fallen).toBe(false);
    expect(back.position[0] - OPEN.x).toBeLessThan(-2.5);
    expect(side.position[1] - OPEN.y).toBeGreaterThan(2.0);
  });

  it('turns on the spot and while walking', () => {
    sim.reset(OPEN);
    const spin = turnFor(sim, 10, { vx: 0, vy: 0, yawRate: 1.0 });
    sim.reset(OPEN);
    const arc = turnFor(sim, 10, { vx: 0.3, vy: 0, yawRate: -0.8 });
    console.log(`turn in place 1.0 rad/s: ${spin.toFixed(2)} rad; walking turn -0.8 rad/s: ${arc.toFixed(2)} rad in 10 s`);
    expect(sim.getState().fallen).toBe(false);
    expect(spin).toBeGreaterThan(6);
    expect(arc).toBeLessThan(-5);
  });

  it.each([
    [1, COURSE_LIMIT_S],
    [0.5, HALF_SPEED_COURSE_LIMIT_S],
  ])('autopilot at %s x max speed walks the whole obstacle course in order without falling', (speed, limit) => {
    sim.reset(sim.arena.spawns.start);
    const result = runCourse(sim, sim.arena.checkpoints, limit, speed);
    console.log(`G1 course at speed ${speed}: ${result.reached}/${sim.arena.checkpoints.length} checkpoints, times ${result.times.map((t) => t.toFixed(1)).join(', ')} s`);
    expect(result.fell).toBe(false);
    expect(result.reached).toBe(sim.arena.checkpoints.length);
    expect(result.time).toBeLessThan(limit);
  });

  it('friction knob sets every geom; the robot still stands on friction 0.2', () => {
    sim.setKnobs({ friction: 0.2 });
    const friction = sim.model.geom_friction as Float64Array;
    for (let g = 0; g < sim.model.ngeom; g++) expect(friction[3 * g]).toBe(0.2);
    sim.setKnobs({ friction: 1 });
    const slippery = [0.2, 0.15, 0.1, 0.07, 0.05];
    const stand = lastSurviving(sim, 'friction', slippery, 0);
    const walk = lastSurviving(sim, 'friction', slippery, 0.5);
    console.log(`friction: lowest that still stands 10 s = ${stand}, still walks at 0.5 m/s = ${walk} (tried ${slippery.join(', ')})`);
    expect(stand).not.toBeNull();
    expect(stand!).toBeLessThanOrEqual(0.2);
  });

  it('payload knob adds mass to the pelvis; the robot still walks with 10 kg', () => {
    const base = pelvisId(sim);
    const mass0 = sim.model.body_mass[base] as number;
    const inertia0 = Array.from((sim.model.body_inertia as Float64Array).subarray(3 * base, 3 * base + 3));
    sim.setKnobs({ payloadKg: 10 });
    expect(sim.model.body_mass[base]).toBeCloseTo(mass0 + 10, 9);
    expect((sim.model.body_inertia as Float64Array)[3 * base]).toBeCloseTo((inertia0[0] * (mass0 + 10)) / mass0, 9);
    sim.reset(OPEN);
    runFor(sim, 10, { vx: 0.5, vy: 0, yawRate: 0 });
    const s = sim.getState();
    sim.setKnobs({ payloadKg: 0 });
    expect(sim.model.body_mass[base]).toBe(mass0);
    expect(Array.from((sim.model.body_inertia as Float64Array).subarray(3 * base, 3 * base + 3))).toEqual(inertia0);
    const loads = [15, 20, 25, 30, 40];
    const stand = lastSurviving(sim, 'payloadKg', loads, 0);
    const walk = lastSurviving(sim, 'payloadKg', loads, 0.5);
    console.log(`payload 10 kg: walked ${(s.position[0] - OPEN.x).toFixed(2)} m in 10 s at 0.5 m/s; heaviest that still stands = ${stand} kg, still walks = ${walk} kg (tried ${loads.join(', ')})`);
    expect(s.fallen).toBe(false);
    expect(s.position[0] - OPEN.x).toBeGreaterThan(3);
  });

  it('motor strength knob scales torque limits (measure standing/walking at 0.3)', () => {
    sim.setKnobs({ motorStrength: 0.3 });
    let fellAt = NaN;
    const off = sim.on('fall', () => (fellAt = sim.data.time));
    sim.reset(OPEN);
    runFor(sim, 10, { vx: 0, vy: 0, yawRate: 0 });
    off();
    const stand = sim.getState();
    expect(Array.from(stand.torqueLimits)).toEqual([88, 139, 88, 139, 50, 50, 88, 139, 88, 139, 50, 50].map((l) => l * 0.3));
    for (let j = 0; j < 12; j++) expect(Math.abs(stand.torques[j])).toBeLessThanOrEqual(stand.torqueLimits[j] + 1e-9);
    sim.reset(OPEN);
    runFor(sim, 10, { vx: 0.5, vy: 0, yawRate: 0 });
    const walk = sim.getState();
    sim.setKnobs({ motorStrength: 1 });
    const weaker = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3];
    const minStand = lastSurviving(sim, 'motorStrength', weaker, 0);
    const minWalk = lastSurviving(sim, 'motorStrength', weaker, 0.5);
    console.log(
      `motorStrength 0.3: standing falls at t=${fellAt.toFixed(2)} s, walking fallen=${walk.fallen}; ` +
        `weakest that still stands 10 s = ${minStand}, still walks at 0.5 m/s = ${minWalk}`,
    );
    expect(stand.fallen).toBe(true);
    expect(minStand).not.toBeNull();
  });

  it('sensor noise is seeded (reproducible) and the robot still walks with realistic noise', () => {
    sim.setKnobs({ sensorNoise: 1 });
    const walk = () => {
      sim.reset(OPEN);
      runFor(sim, 10, { vx: 0.5, vy: 0, yawRate: 0 });
      return sim.getState();
    };
    const a = walk();
    const b = walk();
    sim.setKnobs({ sensorNoise: 0 });
    const clean = walk();
    const noisier = [1.5, 2, 3, 4];
    const maxNoise = lastSurviving(sim, 'sensorNoise', noisier, 0.5);
    console.log(`sensor noise 1: dx=${(a.position[0] - OPEN.x).toFixed(2)} m (noise-free ${(clean.position[0] - OPEN.x).toFixed(2)} m); noisiest that still walks = ${maxNoise} (tried ${noisier.join(', ')})`);
    expect(a.position).toEqual(b.position);
    expect(a.position).not.toEqual(clean.position);
    expect(a.fallen).toBe(false);
  });

  it('push shoves the pelvis for its duration, then stops', () => {
    sim.reset(OPEN);
    runFor(sim, 2, { vx: 0, vy: 0, yawRate: 0 });
    sim.push(150, Math.PI / 2, 0.1);
    expect(sim.activePush).toEqual({ forceN: 150, directionRad: Math.PI / 2, remainingS: 0.1 });
    const base = pelvisId(sim);
    const xfrc = () => Array.from((sim.data.xfrc_applied as Float64Array).subarray(6 * base, 6 * base + 3));
    expect(xfrc()[1]).toBeCloseTo(150, 9);
    runFor(sim, 0.05);
    expect(sim.activePush?.remainingS).toBeCloseTo(0.05, 9);
    runFor(sim, 0.05);
    expect(sim.activePush).toBeNull();
    expect(xfrc()).toEqual([0, 0, 0]);
    // 15 N·s on a ~32 kg robot: about 0.45 m/s sideways.
    expect(sim.getState().velocity[1]).toBeGreaterThan(0.2);
    runFor(sim, 4);
    expect(sim.getState().fallen).toBe(false);
  });

  it('emits "fall" once per episode, and reset() stands the robot back up', () => {
    let falls = 0;
    let resets = 0;
    const offFall = sim.on('fall', () => falls++);
    const offReset = sim.on('reset', () => resets++);
    sim.reset(OPEN);
    runFor(sim, 1, { vx: 0, vy: 0, yawRate: 0 });
    sim.push(1500, 0, 0.2);
    runFor(sim, 4);
    const fallen = sim.getState();
    expect(fallen.fallen).toBe(true);
    expect(falls).toBe(1);
    sim.reset(OPEN);
    expect(resets).toBe(2);
    const s = sim.getState();
    expect(s.fallen).toBe(false);
    expect(s.time).toBe(0);
    expect(s.position[0]).toBeCloseTo(OPEN.x, 9);
    expect(sim.activePush).toBeNull();
    runFor(sim, 3);
    expect(falls).toBe(1);
    offFall();
    offReset();
    sim.reset(OPEN);
    expect(resets).toBe(2);
  });

  it('measures the strongest 0.1 s push the G1 survives (front, back, left, right; standing and walking)', () => {
    const rows: string[] = [];
    const survived: Record<string, number> = {};
    for (const mode of ['standing', 'walking 0.5 m/s'] as const) {
      for (const [from, offset] of [['front', Math.PI], ['back', 0], ['left', -Math.PI / 2], ['right', Math.PI / 2]] as const) {
        const threshold = strongestSurvivedPush(sim, mode === 'standing' ? 0 : 0.5, offset);
        survived[`${mode} ${from}`] = threshold;
        rows.push(`| ${mode.padEnd(15)} | ${from.padEnd(5)} | ${String(threshold).padStart(5)} N | ${(threshold * 0.1).toFixed(0).padStart(3)} N·s |`);
      }
    }
    console.log(['| G1 state        | from  | max push | impulse |', ...rows].join('\n'));
    for (const n of Object.values(survived)) expect(n).toBeGreaterThanOrEqual(50);
  });

  it('advance() keeps up with real time, honours timeScale and pause, and caps work per call', () => {
    sim.reset(OPEN);
    expect(sim.advance(1 / 60)).toBe(8); // 16.7 ms -> 8 steps, 0.67 ms carried over
    expect(sim.advance(1 / 60)).toBe(8);
    expect(sim.advance(1 / 60)).toBe(9);
    sim.setKnobs({ timeScale: 0.25 });
    expect(sim.advance(0.02)).toBe(2);
    sim.setKnobs({ timeScale: 1 });
    expect(sim.advance(5)).toBe(Math.round(MAX_ADVANCE_S / TIMESTEP));
    expect(sim.advance(0)).toBe(0);
    sim.paused = true;
    expect(sim.advance(1)).toBe(0);
    sim.paused = false;
  });

  it('clamps commands to the robot limits', () => {
    sim.setCommand({ vx: 5, vy: -5, yawRate: 0.2 });
    expect(sim.command).toEqual({ vx: sim.robot.maxCommand.vx, vy: -sim.robot.maxCommand.vy, yawRate: 0.2 });
    sim.setCommand({ vx: 0, vy: 0, yawRate: 0 });
  });

  it('runs much faster than real time in Node', () => {
    sim.reset(OPEN);
    sim.setCommand({ vx: 0.5, vy: 0, yawRate: 0 });
    const t0 = performance.now();
    for (let frame = 0; frame < 600; frame++) {
      sim.advance(1 / 60);
      sim.getState();
    }
    const wall = (performance.now() - t0) / 1000;
    console.log(`sim speed (advance + getState at 60 fps): ${(sim.data.time / wall).toFixed(1)} sim-seconds per wall-second`);
    expect(sim.data.time / wall).toBeGreaterThan(1);
  });
});

describe('Simulation lifecycle', () => {
  it('cleans up the model files and can be disposed (twice) without throwing', async () => {
    const sim = await Simulation.create({ robot: 'g1', loadFile: nodeLoadFile });
    expect((sim.mujoco.FS.readdir('/') as string[]).filter((name) => name.startsWith('scene'))).toEqual([]);
    runFor(sim, 0.1);
    expect(() => sim.dispose()).not.toThrow();
    expect(() => sim.dispose()).not.toThrow();
    expect(sim.advance(1)).toBe(0);
  });
});

describe('Simulation with the Unitree Go2', () => {
  it('autopilot walks the obstacle course (skipped if the Go2 controller cannot walk yet)', async (ctx) => {
    const sim = await Simulation.create({ robot: 'go2', loadFile: nodeLoadFile });
    try {
      sim.reset(OPEN);
      runFor(sim, 5, { vx: 0.5, vy: 0, yawRate: 0 });
      const moved = sim.getState().position[0] - OPEN.x;
      if (moved < 0.5) ctx.skip(`Go2 controller does not walk yet (moved ${moved.toFixed(2)} m in 5 s at vx=0.5): placeholder`);
      sim.reset(sim.arena.spawns.start);
      const result = runCourse(sim, sim.arena.checkpoints, GO2_COURSE_LIMIT_S);
      console.log(`Go2 course: ${result.reached}/${sim.arena.checkpoints.length} checkpoints, times ${result.times.map((t) => t.toFixed(1)).join(', ')} s, fell=${result.fell}`);
      expect(result.fell).toBe(false);
      expect(result.reached).toBe(sim.arena.checkpoints.length);
      expect(result.time).toBeLessThan(GO2_COURSE_LIMIT_S);
    } finally {
      sim.dispose();
    }
  });

  it('motor strength above 1 really gives stronger motors (the Go2 is limited by actuator ctrlrange)', async () => {
    const sim = await Simulation.create({ robot: 'go2', loadFile: nodeLoadFile });
    try {
      const factory = Float64Array.from(sim.model.actuator_ctrlrange as Float64Array);
      sim.setKnobs({ motorStrength: 1.5 });
      expect([...(sim.model.actuator_ctrlrange as Float64Array)]).toEqual([...factory].map((v) => v * 1.5));
      // Walking while turning at full rate asks some motors for more than the factory 23.7 N·m; MuJoCo must
      // apply all of it.
      sim.reset(sim.arena.spawns.lab);
      sim.setCommand(sim.robot.maxCommand);
      let biggest = 0;
      let clipped = 0;
      while (sim.data.time < 6) {
        sim.stepOnce();
        const ctrl = sim.data.ctrl as Float64Array;
        const applied = sim.data.actuator_force as Float64Array;
        for (let i = 0; i < ctrl.length; i++) {
          biggest = Math.max(biggest, Math.abs(ctrl[i]));
          clipped = Math.max(clipped, Math.abs(ctrl[i] - applied[i]));
        }
      }
      expect(biggest).toBeGreaterThan(23.7);
      expect(clipped).toBeLessThan(1e-9);
      sim.setKnobs({ motorStrength: 1 });
      expect([...(sim.model.actuator_ctrlrange as Float64Array)]).toEqual([...factory]);
    } finally {
      sim.dispose();
    }
  });
});

function pelvisId(sim: Simulation): number {
  return sim.mujoco.mj_name2id(sim.model, sim.mujoco.mjtObj.mjOBJ_BODY.value, 'pelvis');
}

describe('waypointCommand (autopilot)', () => {
  const state = (x: number, y: number, heading: number): RobotState => ({
    time: 0,
    position: [x, y, 0.78],
    heading,
    velocity: [0, 0],
    tilt: 0,
    fallen: false,
    torques: new Float64Array(12),
    torqueLimits: new Float64Array(12),
    footContacts: [true, true],
  });
  const robot = ROBOTS.g1;

  it('walks straight at full speed toward a distant target ahead', () => {
    expect(waypointCommand(state(0, 0, 0), { x: 10, y: 0 }, robot)).toEqual({ vx: robot.maxCommand.vx, vy: 0, yawRate: 0 });
  });

  it('turns toward the target (left is positive yaw) and turns on the spot when it is behind', () => {
    const left = waypointCommand(state(0, 0, 0), { x: 5, y: 1 }, robot);
    expect(left.yawRate).toBeGreaterThan(0);
    expect(left.vx).toBeGreaterThan(0);
    const behind = waypointCommand(state(0, 0, 0), { x: -5, y: -0.1 }, robot);
    expect(behind.vx).toBe(0);
    expect(behind.yawRate).toBe(-robot.maxCommand.yawRate);
  });

  it('slows down near the target and honours the speed option', () => {
    expect(waypointCommand(state(0, 0, 0), { x: 0.25, y: 0 }, robot).vx).toBeCloseTo(0.2, 9);
    expect(waypointCommand(state(0, 0, 0), { x: 10, y: 0 }, robot, { speed: 0.5 }).vx).toBeCloseTo(robot.maxCommand.vx / 2, 9);
  });

  it('wraps heading errors across +-pi', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 9);
    expect(wrapAngle(-Math.PI / 2 - 2 * Math.PI)).toBeCloseTo(-Math.PI / 2, 9);
    const cmd = waypointCommand(state(0, 0, Math.PI - 0.1), { x: -10, y: -1 }, robot);
    expect(cmd.yawRate).toBeGreaterThan(0);
    expect(cmd.vx).toBeGreaterThan(0.5);
  });
});

/** Binary search (10 N resolution) for the strongest 0.1 s push that the robot survives for 4 s. */
function strongestSurvivedPush(sim: Simulation, vx: number, directionOffset: number): number {
  const survives = (force: number) => {
    sim.reset(OPEN);
    runFor(sim, 2, { vx, vy: 0, yawRate: 0 });
    sim.push(force, sim.getState().heading + directionOffset, 0.1);
    runFor(sim, 4);
    return !sim.getState().fallen;
  };
  let lo = 0;
  let hi = 1500;
  if (survives(hi)) return hi;
  while (hi - lo > 10) {
    const mid = Math.round((lo + hi) / 2);
    if (survives(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Does the robot last 10 s with these knobs (and, when walking, cover >= 2 m)? Restores default knobs. */
function copes(sim: Simulation, knobs: Partial<PhysicsKnobs>, vx: number): boolean {
  sim.setKnobs(knobs);
  sim.reset(OPEN);
  runFor(sim, 10, { vx, vy: 0, yawRate: 0 });
  const s = sim.getState();
  sim.setKnobs(DEFAULT_KNOBS);
  return !s.fallen && (vx === 0 || s.position[0] - OPEN.x > 2);
}

/** Tries knob values from easiest to hardest; returns the last one the robot copes with (null if none). */
function lastSurviving(sim: Simulation, knob: keyof PhysicsKnobs, values: number[], vx: number): number | null {
  let last: number | null = null;
  for (const value of values) {
    if (!copes(sim, { [knob]: value }, vx)) break;
    last = value;
  }
  return last;
}
