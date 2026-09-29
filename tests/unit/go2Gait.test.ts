/**
 * Go2 trot controller on the real MuJoCo WASM build (flat floor + go2.xml, 2 ms steps).
 * Reference numbers come from `python3 tools/go2_gait_lab.py`, the Python twin of the
 * controller (same algorithm and gains, Python MuJoCo 3.14.0).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MotionCommand, PhysicsKnobs } from '../../src/core/types';
import { HIP_POS, LEG_NAMES, legFk, legIk, legJacobian, SIDE, type Vec3 } from '../../src/robots/go2/kinematics';
import { createGo2Bench, type Go2Bench, type Push, type RunResult } from './helpers/go2Harness';

/** Python results for the same 10 s runs (noise-free). */
const PYTHON = { forward: 4.61, backward: -2.89, sidestep: 1.73, turn: 6.7, stop: 2.35 };
/** TypeScript and Python run the same algorithm on the same MuJoCo version. */
const AGREEMENT = 0.05;

const cmd =
  (vx = 0, vy = 0, yawRate = 0, until = Infinity) =>
  (t: number): MotionCommand =>
    t < until ? { vx, vy, yawRate } : { vx: 0, vy: 0, yawRate: 0 };

describe('Go2 trot controller (MuJoCo WASM)', () => {
  let bench: Go2Bench;
  const table: string[] = [];

  function run(name: string, seconds: number, command: (t: number) => MotionCommand, knobs?: Partial<PhysicsKnobs>, pushes?: Push[]): RunResult {
    const r = bench.run({ seconds, command, knobs, pushes });
    const fell = r.fellAt === null ? 'ok' : `FELL at ${r.fellAt.toFixed(2)} s`;
    table.push(
      `${name.padEnd(34)} x=${r.x.toFixed(2).padStart(5)} y=${r.y.toFixed(2).padStart(5)} ` +
        `heading=${r.heading.toFixed(2).padStart(5)} maxTilt=${r.maxTilt.toFixed(2)} ` +
        `peakTorque=${(100 * r.peakTorqueRatio).toFixed(0)}% ${fell}`,
    );
    return r;
  }

  beforeAll(async () => {
    bench = await createGo2Bench();
  });
  afterAll(() => {
    bench.dispose();
    console.log(`Go2 gait (TypeScript on MuJoCo WASM):\n${table.join('\n')}`);
  });

  it('leg kinematics match MuJoCo, invert cleanly and have the right Jacobian', () => {
    const { mujoco, model, data } = bench;
    const qpos = data.qpos as Float64Array;
    const geomPos = data.geom_xpos as Float64Array;
    const feet = LEG_NAMES.map((name) => mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_GEOM.value, name));
    let seed = 7;
    const jitter = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.8;
    let fkErr = 0;
    let ikErr = 0;
    let jacErr = 0;
    for (let trial = 0; trial < 50; trial++) {
      mujoco.mj_resetDataKeyframe(model, data, 0);
      qpos[2] = 1;
      for (let i = 0; i < 12; i++) qpos[7 + i] += jitter();
      mujoco.mj_kinematics(model, data);
      for (let leg = 0; leg < 4; leg++) {
        const q: Vec3 = [qpos[7 + 3 * leg], qpos[8 + 3 * leg], qpos[9 + 3 * leg]];
        const p = legFk(q[0], q[1], q[2], SIDE[leg], [0, 0, 0]);
        for (let i = 0; i < 3; i++) {
          fkErr = Math.max(fkErr, Math.abs(HIP_POS[leg][i] + p[i] - (geomPos[3 * feet[leg] + i] - qpos[i])));
        }
        const back = legIk(p, SIDE[leg], [0, 0, 0]);
        for (let j = 0; j < 3; j++) ikErr = Math.max(ikErr, Math.abs(back[j] - q[j]));
        const J = legJacobian(q[0], q[1], q[2], SIDE[leg], new Float64Array(9));
        for (let j = 0; j < 3; j++) {
          const plus: Vec3 = [...q];
          const minus: Vec3 = [...q];
          plus[j] += 1e-6;
          minus[j] -= 1e-6;
          const a = legFk(plus[0], plus[1], plus[2], SIDE[leg], [0, 0, 0]);
          const b = legFk(minus[0], minus[1], minus[2], SIDE[leg], [0, 0, 0]);
          for (let i = 0; i < 3; i++) jacErr = Math.max(jacErr, Math.abs((a[i] - b[i]) / 2e-6 - J[3 * i + j]));
        }
      }
    }
    // The model's foot sphere sits 2 mm behind the calf axis; the controller ignores that.
    expect(fkErr).toBeLessThan(0.0025);
    expect(ikErr).toBeLessThan(1e-9);
    expect(jacErr).toBeLessThan(1e-6);
  });

  it('stands still for 10 s', () => {
    const r = run('stand', 10, cmd());
    expect(r.fellAt).toBeNull();
    expect(Math.hypot(r.x, r.y)).toBeLessThan(0.05);
    expect(r.stepping).toBe(false);
    expect(r.z).toBeGreaterThan(0.27);
  });

  it('walks forward at 0.5 m/s', () => {
    const r = run('forward 0.5 m/s', 10, cmd(0.5));
    expect(r.fellAt).toBeNull();
    expect(r.x).toBeGreaterThan(3.5);
    expect(Math.abs(r.y)).toBeLessThan(0.3);
    expect(Math.abs(r.x - PYTHON.forward)).toBeLessThan(AGREEMENT * Math.abs(PYTHON.forward));
  });

  it('walks backward at 0.3 m/s', () => {
    const r = run('backward 0.3 m/s', 10, cmd(-0.3));
    expect(r.fellAt).toBeNull();
    expect(r.x).toBeLessThan(-2);
    expect(Math.abs(r.x - PYTHON.backward)).toBeLessThan(AGREEMENT * Math.abs(PYTHON.backward));
  });

  it('sidesteps left at 0.2 m/s', () => {
    const r = run('sidestep 0.2 m/s', 10, cmd(0, 0.2));
    expect(r.fellAt).toBeNull();
    expect(r.y).toBeGreaterThan(1.4);
    expect(Math.abs(r.y - PYTHON.sidestep)).toBeLessThan(AGREEMENT * PYTHON.sidestep);
  });

  it('turns in place at 0.8 rad/s', () => {
    const r = run('turn 0.8 rad/s', 10, cmd(0, 0, 0.8));
    expect(r.fellAt).toBeNull();
    expect(r.heading).toBeGreaterThan(6);
    expect(Math.hypot(r.x, r.y)).toBeLessThan(0.3);
    expect(Math.abs(r.heading - PYTHON.turn)).toBeLessThan(AGREEMENT * PYTHON.turn);
  });

  it('stops cleanly after walking and stands on four feet', () => {
    const r = run('0.5 m/s for 5 s, then stop', 10, cmd(0.5, 0, 0, 5));
    const atStop = r.samples.find((s) => s.t >= 5)!;
    expect(r.fellAt).toBeNull();
    expect(r.x - atStop.x).toBeLessThan(0.4);
    expect(r.stepping).toBe(false);
    expect(r.speed).toBeLessThan(0.05);
    expect(Math.abs(r.x - PYTHON.stop)).toBeLessThan(AGREEMENT * PYTHON.stop);
  });

  it.each<[string, Partial<PhysicsKnobs>]>([
    ['sensor noise 1', { sensorNoise: 1 }],
    ['friction 0.4', { friction: 0.4 }],
    ['payload 3 kg', { payloadKg: 3 }],
    ['motor strength 0.7', { motorStrength: 0.7 }],
    ['all four at once', { sensorNoise: 1, friction: 0.4, payloadKg: 3, motorStrength: 0.7 }],
  ])('still walks forward at 0.5 m/s with %s', (name, knobs) => {
    const r = run(`forward 0.5 m/s, ${name}`, 10, cmd(0.5), knobs);
    expect(r.fellAt).toBeNull();
    expect(r.x).toBeGreaterThan(3.5);
  });

  // Strongest 0.1 s shove survived (30 N steps), applied 2 s into the run. "From the front"
  // means the force points backwards.
  const DIRECTIONS: [string, number][] = [
    ['front', Math.PI],
    ['back', 0],
    ['side', Math.PI / 2],
  ];
  it.each<[string, (t: number) => MotionCommand]>([
    ['standing', cmd()],
    ['trotting at 0.5 m/s', cmd(0.5)],
  ])('survives pushes from the front, back and side while %s', (mode, command) => {
    for (const [from, directionRad] of DIRECTIONS) {
      let survived = 0;
      for (let forceN = 30; forceN <= 600; forceN += 30) {
        const r = bench.run({ seconds: 4, command, pushes: [{ at: 2, forceN, directionRad, durationS: 0.1 }] });
        if (r.fellAt !== null) break;
        survived = forceN;
      }
      table.push(`push while ${mode}, from ${from}: survives ${survived} N for 0.1 s`);
      expect(survived, from).toBeGreaterThanOrEqual(150);
    }
  });
});
