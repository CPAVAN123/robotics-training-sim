/**
 * Star rules for every lesson, kept as pure functions so they are easy to test and to explain.
 */
import type { RobotId } from '../core/types';
import type { Stars } from './types';

/** Seconds added to the obstacle-course time for every fall (and every reset with R). */
export const FALL_PENALTY_S = 10;

/**
 * Obstacle-course target times (seconds, penalties included). The autopilot needs about 36 s with the
 * G1 and 30 s with the Go2 at full speed; 3 stars asks for a clean, confident run.
 */
export const COURSE_PAR: Record<RobotId, { three: number; two: number }> = {
  g1: { three: 60, two: 95 },
  go2: { three: 50, two: 80 },
};

/** `penalties`: falls plus resets. */
export function courseScore(timeS: number, penalties: number): number {
  return timeS + penalties * FALL_PENALTY_S;
}

export function courseStars(robot: RobotId, finished: boolean, timeS: number, penalties: number): Stars {
  if (!finished) return 0;
  const score = courseScore(timeS, penalties);
  const par = COURSE_PAR[robot];
  if (score <= par.three) return 3;
  if (score <= par.two) return 2;
  return 1;
}

/** Meet the robot: one star each for reaching the checkpoint, not falling, and the quiz on the first try. */
export function meetStars(reached: boolean, falls: number, quizFirstTry: boolean): Stars {
  if (!reached) return 0;
  return (1 + (falls === 0 ? 1 : 0) + (quizFirstTry ? 1 : 0)) as Stars;
}

/** Push recovery: stars for how many pushes of the series the robot rode out. */
export function pushStars(survived: number, thresholds: readonly [number, number, number]): Stars {
  if (survived >= thresholds[2]) return 3;
  if (survived >= thresholds[1]) return 2;
  if (survived >= thresholds[0]) return 1;
  return 0;
}

/** Physics lab: one star per completed challenge. */
export function labStars(completed: number): Stars {
  return Math.max(0, Math.min(3, Math.floor(completed))) as Stars;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return m > 0 ? `${m}:${rest.toFixed(1).padStart(4, '0')}` : `${rest.toFixed(1)} s`;
}
