/**
 * Turns raw (noisy) sensor readings into the body state the controller works with.
 *
 * Tilt: the gyro is smooth but drifts; the gravity measurement doesn't drift but is noisy.
 * A complementary filter integrates the gyro and pulls gently towards the measured gravity
 * direction, getting the best of both. Everything is then expressed in the "heading frame":
 * level with the ground, facing where the robot faces.
 */
import type { SensorReadings } from './sensing';
import type { Vec3 } from './kinematics';

export class BodyEstimator {
  /** Base frame -> heading frame rotation, row-major 3x3. */
  readonly level = new Float64Array(9);
  roll = 0;
  pitch = 0;
  /** Heading-frame linear and angular velocity. */
  readonly velocity: Vec3 = [0, 0, 0];
  readonly angularVelocity: Vec3 = [0, 0, 0];
  private readonly gravity: Vec3 = [0, 0, -1];
  private readonly baseVelocity: Vec3 = [0, 0, 0];

  /** attitudeTau, velocityTau: filter time constants, s. */
  constructor(
    private readonly attitudeTau: number,
    private readonly velocityTau: number,
  ) {
    this.reset();
  }

  reset(): void {
    this.gravity[0] = 0;
    this.gravity[1] = 0;
    this.gravity[2] = -1;
    this.baseVelocity.fill(0);
    this.update(null, 0);
  }

  update(s: SensorReadings | null, dt: number): void {
    const g = this.gravity;
    if (s) {
      // Gravity is fixed in the world, so in the rotating base frame it turns at -ω.
      const [wx, wy, wz] = s.gyro;
      const g0 = g[0] - dt * (wy * g[2] - wz * g[1]);
      const g1 = g[1] - dt * (wz * g[0] - wx * g[2]);
      const g2 = g[2] - dt * (wx * g[1] - wy * g[0]);
      const m = Math.hypot(s.gravity[0], s.gravity[1], s.gravity[2]);
      const a = dt / this.attitudeTau;
      g[0] = g0 + a * (s.gravity[0] / m - g0);
      g[1] = g1 + a * (s.gravity[1] / m - g1);
      g[2] = g2 + a * (s.gravity[2] / m - g2);
      const n = Math.hypot(g[0], g[1], g[2]);
      g[0] /= n;
      g[1] /= n;
      g[2] /= n;
      const b = dt / this.velocityTau;
      for (let i = 0; i < 3; i++) this.baseVelocity[i] += b * (s.velocity[i] - this.baseVelocity[i]);
    }
    // Gravity in the base frame is (sin p, -sin r cos p, -cos r cos p) for roll r, pitch p.
    this.pitch = Math.asin(Math.max(-1, Math.min(1, g[0])));
    this.roll = Math.atan2(-g[1], -g[2]);
    const cr = Math.cos(this.roll), sr = Math.sin(this.roll);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    // level = Ry(pitch) · Rx(roll)
    const L = this.level;
    L[0] = cp; L[1] = sp * sr; L[2] = sp * cr;
    L[3] = 0; L[4] = cr; L[5] = -sr;
    L[6] = -sp; L[7] = cp * sr; L[8] = cp * cr;
    if (s) {
      rotate(L, this.baseVelocity, this.velocity);
      rotate(L, s.gyro, this.angularVelocity);
    } else {
      this.velocity.fill(0);
      this.angularVelocity.fill(0);
    }
  }
}

/** out = M·v for a row-major 3x3 M. */
export function rotate(M: Float64Array, v: Vec3, out: Vec3): Vec3 {
  const [x, y, z] = v;
  out[0] = M[0] * x + M[1] * y + M[2] * z;
  out[1] = M[3] * x + M[4] * y + M[5] * z;
  out[2] = M[6] * x + M[7] * y + M[8] * z;
  return out;
}

/** out = Mᵀ·v for a row-major 3x3 M. */
export function rotateBack(M: Float64Array, v: Vec3, out: Vec3): Vec3 {
  const [x, y, z] = v;
  out[0] = M[0] * x + M[3] * y + M[6] * z;
  out[1] = M[1] * x + M[4] * y + M[7] * z;
  out[2] = M[2] * x + M[5] * y + M[8] * z;
  return out;
}
