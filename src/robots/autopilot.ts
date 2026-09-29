/**
 * A very simple "drive to a point" controller, used by tests and the "Watch a demo" button.
 * Turn toward the target in proportion to the heading error, and walk forward faster the better
 * the robot is lined up and the farther away the target is.
 */
import type { MotionCommand, RobotInfo, RobotState } from '../core/types';

/** Turning gain: yaw rate (rad/s) per radian of heading error. */
const K_TURN = 1.5;
/** Forward-speed gain: m/s per metre of remaining distance, so the robot slows down near the target. */
const K_DIST = 0.8;
/** Heading errors above this (rad) mean "turn on the spot first". */
const TURN_IN_PLACE = 1.0;

export interface AutopilotOptions {
  /** Fraction of robot.maxCommand to use (0..1). Default 1. */
  speed?: number;
}

export function waypointCommand(
  state: RobotState,
  target: { x: number; y: number },
  robot: RobotInfo,
  options: AutopilotOptions = {},
): MotionCommand {
  const speed = options.speed ?? 1;
  const dx = target.x - state.position[0];
  const dy = target.y - state.position[1];
  const distance = Math.hypot(dx, dy);
  const error = wrapAngle(Math.atan2(dy, dx) - state.heading);

  const maxYaw = robot.maxCommand.yawRate * speed;
  const yawRate = clamp(K_TURN * error, -maxYaw, maxYaw);
  const alignment = Math.abs(error) > TURN_IN_PLACE ? 0 : Math.cos(error);
  const vx = Math.min(robot.maxCommand.vx * speed, K_DIST * distance) * alignment;
  return { vx, vy: 0, yawRate };
}

/** Angle in (-pi, pi]. */
export function wrapAngle(a: number): number {
  return a - 2 * Math.PI * Math.ceil((a - Math.PI) / (2 * Math.PI));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
