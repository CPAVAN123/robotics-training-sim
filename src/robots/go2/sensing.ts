/**
 * What the Go2 controller is allowed to know, read the way a real robot would sense it:
 * an IMU (gyro + gravity direction), a body-velocity estimate, joint encoders and foot
 * contact switches. Noise from the sensor-noise knob is added here, never to the physics.
 * The body velocity is the simulator's true value (plus noise), standing in for the
 * leg-odometry + IMU estimate a real robot has to compute.
 */
import type { MjData, MjModel } from '../../core/types';
import { SENSOR_NOISE, uniformNoise } from '../noise';
import { LEG_NAMES, type Vec3 } from './kinematics';

/** Body-velocity estimator error at sensorNoise = 1, m/s (real robots fuse leg odometry and the IMU). */
const NOISE_VEL = 0.1;

export interface SensorReadings {
  /** Body angular velocity, base frame, rad/s. */
  gyro: Vec3;
  /** Direction of gravity in the base frame (unit length before noise). */
  gravity: Vec3;
  /** Body linear velocity in the base frame, m/s. */
  velocity: Vec3;
  q: Float64Array;
  qd: Float64Array;
}

/** Where the Go2's state lives inside a (possibly bigger) MuJoCo model. */
export interface Go2Indices {
  qposBase: number;
  qvelBase: number;
  qpos: Int32Array;
  qvel: Int32Array;
  actuators: Int32Array;
  feet: Int32Array;
}

export function findIndices(model: MjModel): Go2Indices {
  const base = model.body('base');
  const baseJoint = model.body_jntadr[base.id];
  base.delete();
  const idx: Go2Indices = {
    qposBase: model.jnt_qposadr[baseJoint],
    qvelBase: model.jnt_dofadr[baseJoint],
    qpos: new Int32Array(12),
    qvel: new Int32Array(12),
    actuators: new Int32Array(12),
    feet: new Int32Array(4),
  };
  const joints = ['hip', 'thigh', 'calf'];
  for (let leg = 0; leg < 4; leg++) {
    const foot = model.geom(LEG_NAMES[leg]);
    idx.feet[leg] = foot.id;
    foot.delete();
    for (let j = 0; j < 3; j++) {
      const act = model.actuator(`${LEG_NAMES[leg]}_${joints[j]}`);
      const joint = model.actuator_trnid[2 * act.id];
      idx.actuators[3 * leg + j] = act.id;
      idx.qpos[3 * leg + j] = model.jnt_qposadr[joint];
      idx.qvel[3 * leg + j] = model.jnt_dofadr[joint];
      act.delete();
    }
  }
  return idx;
}

export function createReadings(): SensorReadings {
  return { gyro: [0, 0, 0], gravity: [0, 0, -1], velocity: [0, 0, 0], q: new Float64Array(12), qd: new Float64Array(12) };
}

/** Fills `out` from the simulation state, with noise scaled by `noise` (the sensorNoise knob). */
export function readSensors(data: MjData, idx: Go2Indices, noise: number, rng: () => number, out: SensorReadings): void {
  const qpos = data.qpos as Float64Array;
  const qvel = data.qvel as Float64Array;
  const [w, x, y, z] = [qpos[idx.qposBase + 3], qpos[idx.qposBase + 4], qpos[idx.qposBase + 5], qpos[idx.qposBase + 6]];
  // Entries of the base orientation matrix R (base frame -> world); Rᵀv reads a world vector in the base frame.
  const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - w * z), r02 = 2 * (x * z + w * y);
  const r10 = 2 * (x * y + w * z), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - w * x);
  const r20 = 2 * (x * z - w * y), r21 = 2 * (y * z + w * x), r22 = 1 - 2 * (x * x + y * y);
  const v = qvel.subarray(idx.qvelBase, idx.qvelBase + 6);
  out.velocity[0] = r00 * v[0] + r10 * v[1] + r20 * v[2];
  out.velocity[1] = r01 * v[0] + r11 * v[1] + r21 * v[2];
  out.velocity[2] = r02 * v[0] + r12 * v[1] + r22 * v[2];
  out.gravity[0] = -r20;
  out.gravity[1] = -r21;
  out.gravity[2] = -r22;
  // MuJoCo's free-joint angular velocity is already in the base frame, like a gyro's.
  out.gyro[0] = v[3];
  out.gyro[1] = v[4];
  out.gyro[2] = v[5];
  for (let i = 0; i < 12; i++) {
    out.q[i] = qpos[idx.qpos[i]];
    out.qd[i] = qvel[idx.qvel[i]];
  }
  if (noise <= 0) return;
  for (let i = 0; i < 3; i++) {
    out.gyro[i] += uniformNoise(SENSOR_NOISE.gyro * noise, rng);
    out.gravity[i] += uniformNoise(SENSOR_NOISE.gravity * noise, rng);
    out.velocity[i] += uniformNoise(NOISE_VEL * noise, rng);
  }
  for (let i = 0; i < 12; i++) {
    out.q[i] += uniformNoise(SENSOR_NOISE.jointAngle * noise, rng);
    out.qd[i] += uniformNoise(SENSOR_NOISE.jointSpeed * noise, rng);
  }
}

/** Foot contact switches: out[leg] is true if that foot touches anything. */
export function readFootContacts(data: MjData, idx: Go2Indices, out: boolean[]): void {
  out.fill(false);
  // data.contact is a fresh copy of the contact list on every access; both it and each
  // element must be freed.
  const contacts = data.contact;
  try {
    for (let i = 0; i < data.ncon; i++) {
      const c = contacts.get(i);
      if (!c) continue;
      for (let leg = 0; leg < 4; leg++) {
        if (c.geom1 === idx.feet[leg] || c.geom2 === idx.feet[leg]) out[leg] = true;
      }
      c.delete();
    }
  } finally {
    contacts.delete();
  }
}
