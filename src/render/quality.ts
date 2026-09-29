/**
 * Adaptive graphics quality. School laptops range from fast to very slow GPUs, and a smooth frame
 * rate matters more than pretty shadows: physics only keeps up with real time above ~10 frames per
 * second (the simulation catches up at most 0.1 s per frame).
 */

export interface QualityLevel {
  /** Upper limit for the device pixel ratio. */
  pixelRatio: number;
  /** Shadow map size, or 0 for no shadows. */
  shadowMapSize: number;
  /** Image-based lighting (reflections on the robot's metal parts). */
  environment: boolean;
}

/** From cheapest to prettiest. */
export const QUALITY_LEVELS: QualityLevel[] = [
  { pixelRatio: 0.5, shadowMapSize: 0, environment: false },
  { pixelRatio: 0.75, shadowMapSize: 0, environment: false },
  { pixelRatio: 1, shadowMapSize: 1024, environment: true },
  { pixelRatio: 1.5, shadowMapSize: 2048, environment: true },
];

/** Average frame time above which quality drops, s (below 24 fps). */
export const SLOW_FRAME_S = 1 / 24;
/** Average frame time below which quality may rise again, s (above 50 fps). */
export const FAST_FRAME_S = 1 / 50;
/** Frames are averaged over windows of at least this long, s. */
const WINDOW_S = 1.5;
/** A level that proved too slow is not retried for this long, s. */
const RETRY_AFTER_S = 30;

/**
 * Watches frame times and decides when to change the quality level. Pure logic: feed it frame
 * durations, it answers with the level to use.
 */
export class QualityGovernor {
  level: number;
  private windowTime = 0;
  private windowFrames = 0;
  private sinceDowngrade = Infinity;

  constructor(start = QUALITY_LEVELS.length - 1) {
    this.level = start;
  }

  /** Records one frame; returns true when the level changed. */
  frame(dt: number): boolean {
    if (dt <= 0) return false;
    this.windowTime += dt;
    this.windowFrames++;
    this.sinceDowngrade += dt;
    if (this.windowTime < WINDOW_S) return false;
    const average = this.windowTime / this.windowFrames;
    this.windowTime = 0;
    this.windowFrames = 0;
    if (average > SLOW_FRAME_S && this.level > 0) {
      this.level--;
      this.sinceDowngrade = 0;
      return true;
    }
    if (average < FAST_FRAME_S && this.level < QUALITY_LEVELS.length - 1 && this.sinceDowngrade > RETRY_AFTER_S) {
      this.level++;
      return true;
    }
    return false;
  }
}
