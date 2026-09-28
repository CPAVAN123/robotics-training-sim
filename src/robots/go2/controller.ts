/**
 * Go2 trot controller (model-based, no neural network).
 *
 * Every physics step (2 ms):
 * 1. Sense: IMU, body-velocity estimate, joint encoders (with the noise knob applied).
 * 2. Gait clock: decide which diagonal pair is on the ground and which is swinging.
 * 3. Balance: work out the push the body needs (hold height, stay level, track the commanded
 *    speed and turn rate) and share it among the feet on the ground.
 * 4. Step placement (Raibert's rule): put each swinging foot down half a stride ahead of the
 *    hip, plus extra in the direction the body is drifting, so every step catches the body.
 * 5. Motors: turn foot forces into joint torques (Jacobian transpose), add a PD spring
 *    towards the planned leg pose, and clip to the motor limits.
 *
 * tools/go2_gait_lab.py is the Python twin used for tuning; keep the two in step.
 */
import type { MjData, MjModel, MotionCommand, PhysicsKnobs, RobotController } from '../../core/types';
import { distributeForces } from './balance';
import { BodyEstimator, rotate, rotateBack } from './estimator';
import { swingPoint, TrotScheduler } from './gait';
import { clamp, FOOT_RADIUS, HIP_LEN, HIP_POS, legFk, legIk, legJacobian, SIDE, solve3, type Vec3 } from './kinematics';
import { createReadings, findIndices, type Go2Indices, readFootContacts, readSensors } from './sensing';

/** Whole-robot mass properties when standing (computed from go2.xml). */
const MASS = 15.2; // kg
const COM: Vec3 = [-0.002, 0, -0.021]; // centre of mass in the base frame, m
const INERTIA: Vec3 = [0.17, 0.48, 0.54]; // about the centre of mass, kg·m²
/** Motor torque limits from go2.xml (hip, thigh, calf), N·m. */
const TORQUE_LIMIT = [23.7, 23.7, 45.43];
const GRAVITY = 9.81;

/** Tuned in tools/go2_gait_lab.py (class Gains). */
export const GO2_GAINS = {
  period: 0.36, // s per trot cycle
  duty: 0.5, // fraction of the cycle a foot is on the ground
  height: 0.3, // base above the ground as the legs measure it, m (feet sink ~1 cm into MuJoCo's soft contact)
  clearance: 0.07, // swing foot lift, m
  raibertK: 0.12, // extra step per m/s of speed error, s
  maxStep: [0.16, 0.12], // furthest a foot lands from under its shoulder, m
  kpSwing: 40, // N·m/rad
  kdSwing: 1.0, // N·m·s/rad
  kpStance: 20,
  kdStance: 0.8,
  kpHeight: 150, // 1/s²
  kdHeight: 20, // 1/s
  kpTilt: 300, // 1/s²
  kdTilt: 30, // 1/s
  kdYaw: 40, // 1/s
  kv: 3, // 1/s, horizontal speed tracking
  mu: 0.4, // friction the balance controller assumes
  accel: [1.0, 0.7, 1.5], // command slew limits: m/s², m/s², rad/s²
  attitudeTau: 0.05, // s
  velocityTau: 0.03, // s
  touchdownDepth: 0.01, // swing aims this far below the expected ground, m
  stepTrigger: 0.25, // m/s of unexpected speed that makes a standing robot step
  motorDamping: 2.0, // N·m·s/rad of joint drag the controller feeds forward
  lean: 1.0, // fraction of the centripetal lean h·a/g applied to foot placement in turns
  hipSpeed: 1.6, // fastest a shoulder may move over the ground at full motor strength, m/s
} as const;

export interface Go2Controller extends RobotController {
  /** True while trotting; false when standing on all four feet. */
  readonly stepping: boolean;
}

const vec3s = (): Vec3[] => [0, 1, 2, 3].map((): Vec3 => [0, 0, 0]);

function copy3(dst: Vec3, src: Vec3): void {
  dst[0] = src[0];
  dst[1] = src[1];
  dst[2] = src[2];
}

export function createGo2Controller(): Go2Controller {
  const k = GO2_GAINS;
  const tStance = k.period * k.duty;
  const tSwing = k.period - tStance;
  const groundZ = -(k.height - FOOT_RADIUS);
  const shoulderBase = HIP_POS.map((h, leg): Vec3 => [h[0], h[1] + SIDE[leg] * HIP_LEN, h[2]]);

  const torques = new Float64Array(12);
  const torqueLimits = new Float64Array(12);
  const sensors = createReadings();
  const estimator = new BodyEstimator(k.attitudeTau, k.velocityTau);
  const gait = new TrotScheduler(k.period, k.duty);
  const cmd: Vec3 = [0, 0, 0];
  const inSwing = [false, false, false, false];
  const contacts = [false, false, false, false];
  const swingStart = vec3s();
  const swingTravel = vec3s(); // how far each shoulder has moved since its foot lifted off
  const stanceRef = vec3s();
  const feet = vec3s();
  const shoulder = vec3s();
  const grf = vec3s();
  const jac = [0, 1, 2, 3].map(() => new Float64Array(9));
  const tmp: Vec3 = [0, 0, 0];
  const target: Vec3 = [0, 0, 0];
  const targetVel: Vec3 = [0, 0, 0];
  const qDes: Vec3 = [0, 0, 0];
  const qdDes: Vec3 = [0, 0, 0];
  const force: Vec3 = [0, 0, 0];
  const moment: Vec3 = [0, 0, 0];
  const footForce: Vec3 = [0, 0, 0];
  let idx: Go2Indices | null = null;
  let dt = 0.002;

  /** Swing-foot target (heading frame) for a leg in the air: fills target and targetVel. */
  function planSwing(leg: number, v: Vec3, yawRate: number): void {
    // Raibert's rule: land half a stance ahead of where the shoulder is heading, plus a
    // correction proportional to the speed error so each step catches the body.
    const sh = shoulder[leg];
    const hipVx = v[0] - yawRate * sh[1];
    const hipVy = v[1] + yawRate * sh[0];
    const errX = hipVx - (cmd[0] - cmd[2] * sh[1]);
    const errY = hipVy - (cmd[1] + cmd[2] * sh[0]);
    // Lean into turns: land on the outside by h·a/g (a = ω × v, the centripetal acceleration) so
    // the line between the feet stays under the combined pull of gravity and the turn.
    const lean = (k.lean * k.height * cmd[2]) / GRAVITY;
    const stepX = clamp((hipVx * tStance) / 2 + k.raibertK * errX + lean * v[1], -k.maxStep[0], k.maxStep[0]);
    const stepY = clamp((hipVy * tStance) / 2 + k.raibertK * errY - lean * v[0], -k.maxStep[1], k.maxStep[1]);
    const s = gait.swingProgress[leg];
    // The path is planned on the ground (lift-off spot to landing spot), so the foot leaves
    // and lands without scuffing even though the body keeps moving.
    const travel = swingTravel[leg];
    travel[0] += hipVx * dt;
    travel[1] += hipVy * dt;
    const end: Vec3 = [
      sh[0] + stepX + travel[0] + hipVx * (1 - s) * tSwing,
      sh[1] + stepY + travel[1] + hipVy * (1 - s) * tSwing,
      groundZ - k.touchdownDepth,
    ];
    swingPoint(swingStart[leg], end, s, tSwing, k.clearance, target, targetVel);
    target[0] -= travel[0];
    target[1] -= travel[1];
    targetVel[0] -= hipVx;
    targetVel[1] -= hipVy;
  }

  return {
    robot: 'go2',
    torques,
    torqueLimits,
    get stepping() {
      return gait.stepping;
    },

    reset(model: MjModel) {
      idx = findIndices(model);
      const opt = model.opt;
      dt = opt.timestep;
      opt.delete();
      for (let i = 0; i < 12; i++) torqueLimits[i] = TORQUE_LIMIT[i % 3];
      torques.fill(0);
      estimator.reset();
      gait.reset();
      cmd.fill(0);
      inSwing.fill(false);
      for (let leg = 0; leg < 4; leg++) {
        stanceRef[leg][0] = shoulderBase[leg][0];
        stanceRef[leg][1] = shoulderBase[leg][1];
        stanceRef[leg][2] = groundZ;
      }
    },

    step(_model: MjModel, data: MjData, command: MotionCommand, knobs: PhysicsKnobs, rng: () => number) {
      if (!idx) throw new Error('Go2 controller used before reset()');
      const ids = idx;
      readSensors(data, ids, knobs.sensorNoise, rng, sensors);
      estimator.update(sensors, dt);
      const R = estimator.level;
      const v = estimator.velocity;
      const w = estimator.angularVelocity;
      const q = sensors.q;

      // Speed governor: swing feet move at about twice the shoulder speed and weaker motors can't
      // swing them as fast, so scale the whole command down if a shoulder would go too fast.
      let fastest = 0;
      for (const [x, y] of shoulderBase) {
        fastest = Math.max(fastest, Math.hypot(command.vx - command.yawRate * y, command.vy + command.yawRate * x));
      }
      const scale = fastest > 0 ? Math.min(1, (k.hipSpeed * knobs.motorStrength) / fastest) : 1;
      const wanted = [command.vx * scale, command.vy * scale, command.yawRate * scale];
      for (let i = 0; i < 3; i++) {
        const lim = k.accel[i] * dt;
        cmd[i] += clamp(wanted[i] - cmd[i], -lim, lim);
      }

      // Gait clock: trot while asked to move or knocked off balance, otherwise stand.
      const moving = Math.abs(cmd[0]) > 0.02 || Math.abs(cmd[1]) > 0.02 || Math.abs(cmd[2]) > 0.05;
      const disturbed =
        Math.hypot(v[0] - cmd[0], v[1] - cmd[1]) > k.stepTrigger ||
        Math.abs(estimator.roll) + Math.abs(estimator.pitch) > 0.25;
      const calm = Math.hypot(v[0], v[1]) < 0.1 && Math.abs(w[2]) < 0.2;
      let contactsRead = false;
      gait.update(dt, moving, disturbed, calm, (leg) => {
        if (!contactsRead) readFootContacts(data, ids, contacts);
        contactsRead = true;
        return contacts[leg];
      });

      // Feet and shoulders in the heading frame; note lift-offs and touchdowns.
      for (let leg = 0; leg < 4; leg++) {
        const q0 = q[3 * leg];
        const q1 = q[3 * leg + 1];
        const q2 = q[3 * leg + 2];
        legFk(q0, q1, q2, SIDE[leg], tmp);
        for (let i = 0; i < 3; i++) tmp[i] += HIP_POS[leg][i];
        rotate(R, tmp, feet[leg]);
        legJacobian(q0, q1, q2, SIDE[leg], jac[leg]);
        rotate(R, shoulderBase[leg], shoulder[leg]);
        const swinging = !gait.stance[leg];
        if (swinging && !inSwing[leg]) {
          copy3(swingStart[leg], feet[leg]);
          swingTravel[leg].fill(0);
        } else if (!swinging && inSwing[leg]) {
          copy3(stanceRef[leg], feet[leg]);
        }
        inSwing[leg] = swinging;
      }

      // Balance: the force and moment the body needs, shared among the feet on the ground.
      const stanceLegs = [0, 1, 2, 3].filter((leg) => gait.stance[leg]);
      let footZ = 0;
      for (const leg of stanceLegs) footZ += feet[leg][2];
      const height = FOOT_RADIUS - footZ / stanceLegs.length;
      // Turning while moving needs a sideways (centripetal) push: a = ω × v.
      force[0] = MASS * (k.kv * (cmd[0] - v[0]) - cmd[2] * cmd[1]);
      force[1] = MASS * (k.kv * (cmd[1] - v[1]) + cmd[2] * cmd[0]);
      force[2] = MASS * (GRAVITY + k.kpHeight * (k.height - height) - k.kdHeight * v[2]);
      moment[0] = INERTIA[0] * (-k.kpTilt * estimator.roll - k.kdTilt * w[0]);
      moment[1] = INERTIA[1] * (-k.kpTilt * estimator.pitch - k.kdTilt * w[1]);
      moment[2] = INERTIA[2] * k.kdYaw * (cmd[2] - w[2]);
      const com = rotate(R, COM, tmp);
      const fromCom = stanceLegs.map((leg): Vec3 => [feet[leg][0] - com[0], feet[leg][1] - com[1], feet[leg][2] - com[2]]);
      distributeForces(fromCom, force, moment, k.mu, grf);

      const ctrl = data.ctrl as Float64Array;
      for (let leg = 0; leg < 4; leg++) {
        const stance = gait.stance[leg];
        if (stance) {
          // A planted foot slides back under the body at the commanded speed and turn rate.
          const ref = stanceRef[leg];
          const vx = -(cmd[0] - cmd[2] * ref[1]);
          const vy = -(cmd[1] + cmd[2] * ref[0]);
          ref[0] += vx * dt;
          ref[1] += vy * dt;
          target[0] = ref[0];
          target[1] = ref[1];
          target[2] = groundZ;
          targetVel[0] = vx;
          targetVel[1] = vy;
          targetVel[2] = 0;
          // The foot pushes the ground with -f, so the joints must supply -Jᵀf.
          rotateBack(R, grf[stanceLegs.indexOf(leg)], footForce);
        } else {
          planSwing(leg, v, w[2]);
        }
        rotateBack(R, target, tmp);
        for (let i = 0; i < 3; i++) tmp[i] -= HIP_POS[leg][i];
        legIk(tmp, SIDE[leg], qDes);
        const J = jac[leg];
        if (!solve3(J, rotateBack(R, targetVel, tmp), qdDes)) qdDes.fill(0);
        const kp = (stance ? k.kpStance : k.kpSwing) * knobs.motorStrength;
        const kd = stance ? k.kdStance : k.kdSwing;
        for (let j = 0; j < 3; j++) {
          const i = 3 * leg + j;
          let tau = kp * (qDes[j] - q[i]) + kd * (qdDes[j] - sensors.qd[i]) + k.motorDamping * qdDes[j];
          if (stance) tau -= J[j] * footForce[0] + J[3 + j] * footForce[1] + J[6 + j] * footForce[2];
          const lim = TORQUE_LIMIT[j] * knobs.motorStrength;
          torqueLimits[i] = lim;
          torques[i] = clamp(tau, -lim, lim);
          ctrl[ids.actuators[i]] = torques[i];
        }
      }
    },
  };
}
