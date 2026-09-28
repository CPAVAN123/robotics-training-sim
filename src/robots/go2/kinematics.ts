/**
 * Go2 leg geometry (from go2.xml) and closed-form leg kinematics.
 *
 * Each leg has three joints: hip abduction (about the body's x axis), thigh and calf (both
 * about y). Positions are in the base frame (x forward, y left, z up), relative to the leg's
 * hip joint unless noted. Legs are numbered in actuator order: FL, FR, RL, RR.
 */
export type Vec3 = [number, number, number];

export const LEG_NAMES = ['FL', 'FR', 'RL', 'RR'] as const;
/** Hip (abduction) joint positions in the base frame. */
export const HIP_POS: readonly Vec3[] = [
  [0.1934, 0.0465, 0],
  [0.1934, -0.0465, 0],
  [-0.1934, 0.0465, 0],
  [-0.1934, -0.0465, 0],
];
/** +1 for left legs, -1 for right legs. */
export const SIDE = [1, -1, 1, -1] as const;
export const HIP_LEN = 0.0955;
export const THIGH_LEN = 0.213;
export const CALF_LEN = 0.213;
export const FOOT_RADIUS = 0.022;
/** Knee angles the IK is allowed to ask for (joint range is -2.72..-0.84 rad). */
const KNEE_MIN = -2.7;
const KNEE_MAX = -0.85;

/** Foot centre relative to the hip joint, for joint angles q0 (abduction), q1 (thigh), q2 (calf). */
export function legFk(q0: number, q1: number, q2: number, side: number, out: Vec3): Vec3 {
  const x = -THIGH_LEN * Math.sin(q1) - CALF_LEN * Math.sin(q1 + q2);
  const z = -THIGH_LEN * Math.cos(q1) - CALF_LEN * Math.cos(q1 + q2);
  const y = side * HIP_LEN;
  const c = Math.cos(q0);
  const s = Math.sin(q0);
  out[0] = x;
  out[1] = y * c - z * s;
  out[2] = y * s + z * c;
  return out;
}

/** d(foot position)/d(joint angles), row-major 3x3. */
export function legJacobian(q0: number, q1: number, q2: number, side: number, out: Float64Array): Float64Array {
  const x = -THIGH_LEN * Math.sin(q1) - CALF_LEN * Math.sin(q1 + q2);
  const z = -THIGH_LEN * Math.cos(q1) - CALF_LEN * Math.cos(q1 + q2);
  const y = side * HIP_LEN;
  const c = Math.cos(q0);
  const s = Math.sin(q0);
  const dx2 = -CALF_LEN * Math.cos(q1 + q2);
  const dz2 = CALF_LEN * Math.sin(q1 + q2);
  out[0] = 0;
  out[1] = z;
  out[2] = dx2;
  out[3] = -(y * s + z * c);
  out[4] = s * x;
  out[5] = -s * dz2;
  out[6] = y * c - z * s;
  out[7] = -c * x;
  out[8] = c * dz2;
  return out;
}

/** Joint angles that put the foot centre at p (relative to the hip joint). */
export function legIk(p: Vec3, side: number, out: Vec3): Vec3 {
  const [px, py, pz] = p;
  // Leg length in the thigh/calf plane once the fixed hip offset is taken out.
  const zl = -Math.sqrt(Math.max(py * py + pz * pz - HIP_LEN * HIP_LEN, 1e-6));
  let q0 = Math.atan2(pz, py) - Math.atan2(zl, side * HIP_LEN);
  if (q0 > Math.PI) q0 -= 2 * Math.PI;
  else if (q0 < -Math.PI) q0 += 2 * Math.PI;
  const c2 = (px * px + zl * zl - THIGH_LEN * THIGH_LEN - CALF_LEN * CALF_LEN) / (2 * THIGH_LEN * CALF_LEN);
  const q2 = clamp(-Math.acos(clamp(c2, -1, 1)), KNEE_MIN, KNEE_MAX);
  const q1 = Math.atan2(-px, -zl) - Math.atan2(CALF_LEN * Math.sin(q2), THIGH_LEN + CALF_LEN * Math.cos(q2));
  out[0] = q0;
  out[1] = q1;
  out[2] = q2;
  return out;
}

/** Solves the 3x3 system J·x = b (row-major J). Returns false if J is (nearly) singular. */
export function solve3(J: Float64Array, b: Vec3, out: Vec3): boolean {
  const [a, bb, c, d, e, f, g, h, i] = J;
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + bb * B + c * C;
  if (Math.abs(det) < 1e-5) return false;
  const [x, y, z] = b;
  out[0] = (A * x + (c * h - bb * i) * y + (bb * f - c * e) * z) / det;
  out[1] = (B * x + (a * i - c * g) * y + (c * d - a * f) * z) / det;
  out[2] = (C * x + (bb * g - a * h) * y + (a * e - bb * d) * z) / det;
  return true;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
