/**
 * Balance: share the force and twisting moment the body needs among the feet on the ground.
 *
 * Every foot on the ground can push on the body. Given where the feet are (relative to the
 * centre of mass) we look for the smallest set of foot forces whose total equals the wanted
 * force and whose total moment equals the wanted moment, then keep each force inside what
 * the ground can deliver: feet can push but not pull, and can't slip sideways more than
 * friction allows.
 */
import type { Vec3 } from './kinematics';

const REGULARISATION = 1e-4;

/**
 * Writes one ground force per foot into `out` (3 values per foot, same order as `feet`).
 * `feet` are foot positions relative to the centre of mass in the level heading frame.
 */
export function distributeForces(feet: readonly Vec3[], force: Vec3, moment: Vec3, mu: number, out: Vec3[]): void {
  const n = feet.length;
  const m: Vec3 = [moment[0], moment[1], moment[2]];
  if (n === 2) {
    // Two feet can't twist the body about the line joining them: that moment is fixed by the
    // total force, so ask only for what is physically possible.
    const [a, b] = feet;
    const u: Vec3 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const len = Math.hypot(u[0], u[1], u[2]);
    u[0] /= len;
    u[1] /= len;
    u[2] /= len;
    const ua = cross(u, a);
    const fixed = dot(ua, force) - dot(m, u);
    m[0] += fixed * u[0];
    m[1] += fixed * u[1];
    m[2] += fixed * u[2];
  }

  // Minimum-norm solution f = Aᵀ(AAᵀ)⁻¹b, where foot j contributes [I; [r_j]×] to A.
  // Then f_j = y_force + y_moment × r_j.
  const M = new Float64Array(36);
  const sum: Vec3 = [0, 0, 0];
  for (const r of feet) {
    sum[0] += r[0];
    sum[1] += r[1];
    sum[2] += r[2];
    const rr = dot(r, r);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) M[(3 + i) * 6 + 3 + j] += (i === j ? rr : 0) - r[i] * r[j];
    }
  }
  const S = [
    [0, -sum[2], sum[1]],
    [sum[2], 0, -sum[0]],
    [-sum[1], sum[0], 0],
  ];
  for (let i = 0; i < 3; i++) {
    M[i * 6 + i] = n;
    for (let j = 0; j < 3; j++) {
      M[(3 + i) * 6 + j] = S[i][j];
      M[i * 6 + 3 + j] = -S[i][j];
    }
  }
  for (let i = 0; i < 6; i++) M[i * 6 + i] += REGULARISATION;
  const y = new Float64Array([force[0], force[1], force[2], m[0], m[1], m[2]]);
  solveSymmetric(M, y, 6);

  for (let k = 0; k < n; k++) {
    const r = feet[k];
    const f = out[k];
    f[0] = y[0] + y[4] * r[2] - y[5] * r[1];
    f[1] = y[1] + y[5] * r[0] - y[3] * r[2];
    f[2] = Math.max(y[2] + y[3] * r[1] - y[4] * r[0], 0);
    const tangential = Math.hypot(f[0], f[1]);
    if (tangential > mu * f[2]) {
      const scale = (mu * f[2]) / tangential;
      f[0] *= scale;
      f[1] *= scale;
    }
  }
}

/** Solves M·x = b in place (x overwrites b) by Gaussian elimination; M is n×n row-major. */
function solveSymmetric(M: Float64Array, b: Float64Array, n: number): void {
  for (let col = 0; col < n; col++) {
    const pivot = M[col * n + col];
    for (let row = col + 1; row < n; row++) {
      const factor = M[row * n + col] / pivot;
      if (factor === 0) continue;
      for (let k = col; k < n; k++) M[row * n + k] -= factor * M[col * n + k];
      b[row] -= factor * b[col];
    }
  }
  for (let row = n - 1; row >= 0; row--) {
    let acc = b[row];
    for (let k = row + 1; k < n; k++) acc -= M[row * n + k] * b[k];
    b[row] = acc / M[row * n + row];
  }
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
