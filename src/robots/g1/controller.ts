/**
 * Unitree G1 walking controller: a line-by-line port of unitree_rl_gym's deploy/deploy_mujoco
 * pipeline (deploy_mujoco.py + configs/g1.yaml).
 *
 * Every physics step (500 Hz) a PD loop turns target joint angles into torques.
 * Every 10th step (50 Hz) the neural network looks at the robot's sensors and picks new targets.
 */
import type { MjData, MjModel, MotionCommand, PhysicsKnobs, RobotController } from '../../core/types';
import { SENSOR_NOISE, uniformNoise } from '../noise';
import { G1Policy, type G1PolicyWeights } from './policy';

const N = 12;
/** Joint order: hip pitch, hip roll, hip yaw, knee, ankle pitch, ankle roll; left leg then right leg. */
const KP = [100, 100, 100, 150, 40, 40, 100, 100, 100, 150, 40, 40];
const KD = [2, 2, 2, 4, 2, 2, 2, 2, 2, 4, 2, 2];
const DEFAULT_ANGLES = [-0.1, 0, 0, 0.3, -0.2, 0, -0.1, 0, 0, 0.3, -0.2, 0];
/** Joint effort limits (N·m) from Unitree's g1_12dof.urdf. */
const TORQUE_LIMITS = [88, 139, 88, 139, 50, 50, 88, 139, 88, 139, 50, 50];

const DECIMATION = 10;
const SIM_DT = 0.002;
const GAIT_PERIOD = 0.8;
const ANG_VEL_SCALE = 0.25;
const DOF_VEL_SCALE = 0.05;
const ACTION_SCALE = 0.25;
const CMD_SCALE = [2.0, 2.0, 0.25];

// qpos = [base xyz (3), base quaternion wxyz (4), 12 joints]; qvel = [base linear (3), base angular (3), 12 joints].
const QPOS_JOINTS = 7;
const QVEL_JOINTS = 6;

export function createG1Controller(weights: G1PolicyWeights): RobotController {
  const policy = new G1Policy(weights);
  const obs = new Float32Array(policy.numObs);
  const target = Float64Array.from(DEFAULT_ANGLES);
  const torques = new Float64Array(N);
  const torqueLimits = Float64Array.from(TORQUE_LIMITS);
  let counter = 0;

  function runPolicy(data: MjData, command: MotionCommand, noise: number, rng: () => number): void {
    const qpos = data.qpos as Float64Array;
    const qvel = data.qvel as Float64Array;

    const gyro = noise * SENSOR_NOISE.gyro;
    const gravity = noise * SENSOR_NOISE.gravity;
    const angle = noise * SENSOR_NOISE.jointAngle;
    const speed = noise * SENSOR_NOISE.jointSpeed;

    for (let k = 0; k < 3; k++) obs[k] = (qvel[3 + k] + uniformNoise(gyro, rng)) * ANG_VEL_SCALE;

    // Gravity direction seen from the pelvis: how the IMU knows which way is down.
    const qw = qpos[3], qx = qpos[4], qy = qpos[5], qz = qpos[6];
    obs[3] = 2 * (-qz * qx + qw * qy) + uniformNoise(gravity, rng);
    obs[4] = -2 * (qz * qy + qw * qx) + uniformNoise(gravity, rng);
    obs[5] = 1 - 2 * (qw * qw + qz * qz) + uniformNoise(gravity, rng);

    obs[6] = command.vx * CMD_SCALE[0];
    obs[7] = command.vy * CMD_SCALE[1];
    obs[8] = command.yawRate * CMD_SCALE[2];
    for (let j = 0; j < N; j++) {
      obs[9 + j] = qpos[QPOS_JOINTS + j] + uniformNoise(angle, rng) - DEFAULT_ANGLES[j];
      obs[21 + j] = (qvel[QVEL_JOINTS + j] + uniformNoise(speed, rng)) * DOF_VEL_SCALE;
      obs[33 + j] = policy.action[j];
    }
    // Gait clock: the policy was trained to step in a 0.8 s rhythm driven by this phase signal.
    const phase = ((counter * SIM_DT) % GAIT_PERIOD) / GAIT_PERIOD;
    obs[45] = Math.sin(2 * Math.PI * phase);
    obs[46] = Math.cos(2 * Math.PI * phase);

    const action = policy.forward(obs);
    for (let j = 0; j < N; j++) target[j] = action[j] * ACTION_SCALE + DEFAULT_ANGLES[j];
  }

  return {
    robot: 'g1',
    torques,
    torqueLimits,
    reset(model: MjModel) {
      if (model.nq !== QPOS_JOINTS + N || model.nu !== N) {
        throw new Error(`G1 controller expects 12 actuated joints (nq=19, nu=12), got nq=${model.nq}, nu=${model.nu}`);
      }
      policy.reset();
      target.set(DEFAULT_ANGLES);
      torques.fill(0);
      counter = 0;
    },
    step(_model: MjModel, data: MjData, command: MotionCommand, knobs: PhysicsKnobs, rng: () => number) {
      // Unitree runs the policy right after every 10th mj_step; doing it before the next step is the same moment.
      if (counter > 0 && counter % DECIMATION === 0) runPolicy(data, command, knobs.sensorNoise, rng);

      const qpos = data.qpos as Float64Array;
      const qvel = data.qvel as Float64Array;
      const ctrl = data.ctrl as Float64Array;
      const strength = knobs.motorStrength;
      for (let j = 0; j < N; j++) {
        const limit = TORQUE_LIMITS[j] * strength;
        const tau = KP[j] * strength * (target[j] - qpos[QPOS_JOINTS + j]) - KD[j] * qvel[QVEL_JOINTS + j];
        torqueLimits[j] = limit;
        torques[j] = Math.min(limit, Math.max(-limit, tau));
        ctrl[j] = torques[j];
      }
      counter++;
    },
  };
}
