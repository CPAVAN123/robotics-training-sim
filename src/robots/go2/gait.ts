/**
 * Trot timing. In a trot the diagonal legs move together: front-left with rear-right, then
 * front-right with rear-left. While one pair pushes on the ground (stance) the other pair
 * swings forward through the air.
 *
 * The robot only trots when it is asked to move or has been knocked off balance; once it has
 * been still for a moment it puts all four feet down and stands.
 */
import type { Vec3 } from './kinematics';

/** Where each leg (FL, FR, RL, RR) sits in the gait cycle: diagonal pairs are half a cycle apart. */
const LEG_OFFSET = [0, 0.5, 0.5, 0];
/** Seconds of calm before the robot stops trotting. */
const SETTLE_TIME = 0.5;

export class TrotScheduler {
  stepping = false;
  /** True for each leg that is on the ground (or should be). */
  readonly stance = [true, true, true, true];
  /** 0..1 progress through the swing for legs in the air. */
  readonly swingProgress = [0, 0, 0, 0];
  private phase = 0;
  private quiet = 0;
  /** Foot touched down before its swing time ran out. */
  private readonly landed = [false, false, false, false];

  constructor(
    readonly period: number,
    readonly duty: number,
  ) {}

  reset(): void {
    this.stepping = false;
    this.phase = 0;
    this.quiet = 0;
    this.landed.fill(false);
    this.stance.fill(true);
    this.swingProgress.fill(0);
  }

  /**
   * Advance the clock. `moving`: asked to walk; `disturbed`: body moving or tilting in a way
   * it shouldn't; `calm`: body at rest. `contact(leg)` reads a foot's contact sensor.
   */
  update(dt: number, moving: boolean, disturbed: boolean, calm: boolean, contact: (leg: number) => boolean): void {
    if (!this.stepping && (moving || disturbed)) {
      this.stepping = true;
      this.phase = this.duty; // front-left and rear-right lift first
      this.quiet = 0;
    }
    if (this.stepping) {
      this.quiet = calm && !moving ? this.quiet + dt : 0;
      const prev = this.phase;
      this.phase = (this.phase + dt / this.period) % 1;
      // Stop only at the instant a pair touches down, so all four feet end up on the ground.
      const touchdown = (prev < this.duty && this.duty <= this.phase) || this.phase < prev;
      if (this.quiet > SETTLE_TIME && touchdown) this.stepping = false;
    }
    for (let leg = 0; leg < 4; leg++) {
      const psi = (this.phase + LEG_OFFSET[leg]) % 1;
      if (!this.stepping || psi < this.duty) {
        this.landed[leg] = false;
        this.stance[leg] = true;
        this.swingProgress[leg] = 0;
        continue;
      }
      const s = (psi - this.duty) / (1 - this.duty);
      this.swingProgress[leg] = s;
      // A foot that meets the ground on its way down is treated as landed straight away.
      if (!this.landed[leg] && s > 0.5 && contact(leg)) this.landed[leg] = true;
      this.stance[leg] = this.landed[leg];
    }
  }
}

/**
 * Swing foot path at progress s (0..1), planned on the ground from the lift-off spot `start`
 * to the landing spot `end` so the foot leaves and lands with zero speed relative to the
 * floor. Horizontal motion follows a cycloid; the foot rises `clearance` above the straight
 * line at mid-swing. Writes position and velocity (per second of a `duration`-long swing).
 */
export function swingPoint(
  start: Vec3,
  end: Vec3,
  s: number,
  duration: number,
  clearance: number,
  pos: Vec3,
  vel: Vec3,
): void {
  const angle = 2 * Math.PI * s;
  const cyc = s - Math.sin(angle) / (2 * Math.PI);
  const dcyc = (1 - Math.cos(angle)) / duration;
  for (let i = 0; i < 3; i++) {
    pos[i] = start[i] + (end[i] - start[i]) * cyc;
    vel[i] = (end[i] - start[i]) * dcyc;
  }
  pos[2] += (clearance * (1 - Math.cos(angle))) / 2;
  vel[2] += (clearance * Math.PI * Math.sin(angle)) / duration;
}
