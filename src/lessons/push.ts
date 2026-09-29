/**
 * Push recovery: a series of shoves of increasing strength from marked directions. The student can
 * turn the robot to take each push on its strongest side.
 */
import type { RobotId, RobotState, SpawnPose } from '../core/types';
import { pushExplain } from './content';
import { pushStars } from './scoring';
import type { Lesson, LessonDef, LessonHost, LessonResult, LessonView, PendingPush } from './types';

export interface ScheduledPush {
  /** World angle the push comes FROM (where the pusher stands), rad: 0 = +x (east), π/2 = +y (north). */
  fromRad: number;
  forceN: number;
}

/** How long each shove lasts, s. */
export const PUSH_DURATION_S = 0.1;
/** Warning time before each push, s (enough to turn the robot about 90°–180°). */
export const PUSH_WARNING_S = 4;
/** The robot must still be up this long after a push to count as a save, s. */
export const PUSH_JUDGE_S = 3;
/** Stars for 4, 6 and 7 saves out of 8. The last push is deliberately too strong for any direction. */
export const PUSH_STAR_THRESHOLDS: readonly [number, number, number] = [4, 6, 7];

const E = 0, N = Math.PI / 2, W = Math.PI, S = -Math.PI / 2;

export type PushSide = 'front' | 'left' | 'behind' | 'right';

/**
 * Largest 0.1 s push that the standing robot ALWAYS survived, by the side it hits (push pad, robot facing
 * east, six different gait phases each). One step up (+50 N) the G1 survived front 5/6, behind 5/6, left 5/6,
 * right 4/6 times; 250 N from either side never survived for the Go2.
 */
export const SAFE_PUSH_N: Record<RobotId, Record<PushSide, number>> = {
  g1: { front: 350, behind: 300, left: 150, right: 200 },
  go2: { front: 350, behind: 400, left: 200, right: 200 },
};

/** Push-menu strengths (keys 1, 2, 3) as fractions of the safe push for that side. */
export const PUSH_LEVELS = [
  { name: 'Nudge', fraction: 0.4 },
  { name: 'Shove', fraction: 0.9 },
  { name: 'Huge', fraction: 1.6 },
] as const;

/** Force of a push-menu level, rounded to 10 N. */
export function pushLevelForce(robot: RobotId, side: PushSide, level: 0 | 1 | 2): number {
  return Math.round((SAFE_PUSH_N[robot][side] * PUSH_LEVELS[level].fraction) / 10) * 10;
}

/** World direction a push points when it hits the given side of a robot facing `heading`. */
export function pushDirection(side: PushSide, heading: number): number {
  const from = { front: 0, left: Math.PI / 2, behind: Math.PI, right: -Math.PI / 2 }[side];
  return heading + from + Math.PI;
}

/**
 * The lesson's series. Pushes 1-4 are safe from any side. Pushes 5-7 are only safe if the student turns the
 * robot to take them on its strong side (the G1's chest, the Go2's back); push 8 is too strong from any side.
 * Measured with the real lesson from 16 (G1) and 12 (Go2) start times, i.e. gait phases: turning to meet
 * pushes 5-7 gave 3 stars every time for both robots. Left alone, the Go2 always got 1 star; the G1 (which sways and turns a little
 * while marching on the spot) got 1 star 10 times, 2 stars 4 times and 3 stars twice. 360 N is the largest
 * push the G1 always survived on its chest; from the side it survived 360 N in about 4 (left) to 7 (right)
 * of 12 gait phases.
 */
export const PUSH_SERIES: Record<RobotId, ScheduledPush[]> = {
  g1: [
    { fromRad: E, forceN: 120 },
    { fromRad: W, forceN: 150 },
    { fromRad: N, forceN: 150 },
    { fromRad: S, forceN: 150 },
    { fromRad: N, forceN: 360 },
    { fromRad: S, forceN: 360 },
    { fromRad: N, forceN: 360 },
    { fromRad: E, forceN: 600 },
  ],
  go2: [
    { fromRad: E, forceN: 120 },
    { fromRad: W, forceN: 150 },
    { fromRad: N, forceN: 150 },
    { fromRad: S, forceN: 150 },
    { fromRad: N, forceN: 300 },
    { fromRad: S, forceN: 300 },
    { fromRad: E, forceN: 390 },
    { fromRad: W, forceN: 600 },
  ],
};

/** Which side of the robot a push from world angle `fromRad` hits, given the robot's heading. */
export function pushSide(fromRad: number, heading: number): PushSide {
  const rel = Math.atan2(Math.sin(fromRad - heading), Math.cos(fromRad - heading));
  if (Math.abs(rel) <= Math.PI / 4) return 'front';
  if (Math.abs(rel) >= (3 * Math.PI) / 4) return 'behind';
  return rel > 0 ? 'left' : 'right';
}

export function sideLabel(side: PushSide): string {
  return side === 'front' ? 'the front' : side === 'behind' ? 'its back' : `its ${side}`;
}

type Phase = 'intro' | 'countdown' | 'judging' | 'recovering' | 'done';

interface Outcome {
  push: ScheduledPush;
  side: PushSide;
  saved: boolean;
}

export class PushLesson implements Lesson {
  readonly id = 'push';
  private readonly series: ScheduledPush[];
  private phase: Phase = 'intro';
  private index = 0;
  private clock = 0;
  private heading = 0;
  private outcomes: Outcome[] = [];
  private finished: LessonResult | null = null;

  constructor(private readonly host: LessonHost) {
    this.series = PUSH_SERIES[host.robot.id];
  }

  start(): void {
    this.host.announce('Push recovery: get ready to test the robot\'s balance.');
  }

  update(state: RobotState, dt: number): void {
    this.heading = state.heading;
    if (this.phase === 'intro' || this.phase === 'done') return;
    if (this.phase === 'recovering') {
      // Wait until the runner has put the robot back on its feet, then warn about the next push.
      if (!state.fallen) this.nextOrFinish();
      return;
    }
    this.clock += dt;
    if (this.phase === 'countdown' && this.clock >= PUSH_WARNING_S) {
      const push = this.series[this.index];
      this.host.push(push.forceN, push.fromRad + Math.PI, PUSH_DURATION_S);
      this.outcomes.push({ push, side: pushSide(push.fromRad, state.heading), saved: false });
      this.phase = 'judging';
      this.clock = 0;
    } else if (this.phase === 'judging' && this.clock >= PUSH_JUDGE_S) {
      const outcome = this.outcomes[this.outcomes.length - 1];
      outcome.saved = true;
      this.host.announce(`Saved! ${outcome.push.forceN} N on ${sideLabel(outcome.side)}.`, 'good');
      this.index++;
      this.nextOrFinish();
    }
  }

  onFall(): void {
    if (this.phase === 'judging') {
      const outcome = this.outcomes[this.outcomes.length - 1];
      const sideways = outcome.side === 'left' || outcome.side === 'right';
      this.host.announce(
        `Down! ${outcome.push.forceN} N on ${sideLabel(outcome.side)} was too much.` +
          (sideways ? ' Sideways pushes are the hardest: try turning to meet the next one.' : ''),
        'bad',
      );
      this.index++;
    } else {
      this.host.announce('It fell! Back on the pad in a moment.', 'bad');
    }
    if (this.phase === 'countdown' || this.phase === 'judging') this.phase = 'recovering';
  }

  onManualReset(): void {
    if (this.phase !== 'judging') return;
    // Otherwise R right after a shove would "save" every push, even the impossible last one.
    const outcome = this.outcomes[this.outcomes.length - 1];
    this.host.announce(`Reset during the push: ${outcome.push.forceN} N on ${sideLabel(outcome.side)} counts as not saved.`, 'bad');
    this.index++;
    this.nextOrFinish();
  }

  act(actionId: string): void {
    if (actionId === 'begin' && this.phase === 'intro') this.nextOrFinish();
  }

  respawn(): SpawnPose {
    return this.host.arena.spawns.pushPad;
  }

  view(): LessonView {
    const total = this.series.length;
    const saves = this.outcomes.filter((o) => o.saved).length;
    const upcoming = this.phase === 'countdown' ? this.series[this.index] : null;
    const pendingPush: PendingPush | null = upcoming
      ? { forceN: upcoming.forceN, directionRad: upcoming.fromRad + Math.PI, inS: Math.max(0, PUSH_WARNING_S - this.clock) }
      : null;
    const status = [`Saves: ${saves} of ${this.outcomes.length}`, `Push ${Math.min(this.index + 1, total)} of ${total}`];
    if (upcoming) status.unshift(`Next: ${upcoming.forceN} N, hits ${sideLabel(pushSide(upcoming.fromRad, this.heading))}`);
    return {
      goal:
        this.phase === 'intro'
          ? 'Get ready'
          : upcoming
            ? `Push ${this.index + 1}: ${upcoming.forceN} N in ${Math.ceil(pendingPush?.inS ?? 0)} s. Watch the red arrow!`
            : this.phase === 'judging'
              ? 'Hold on…'
              : this.phase === 'recovering'
                ? 'Getting back up…'
                : 'Series complete',
      status,
      timer: null,
      checkpoints: [],
      card:
        this.phase === 'intro'
          ? {
              title: 'Push recovery',
              body: [
                `${total} shoves: four gentle ones, three hard ones and a last one that is too strong. ` +
                  `A red arrow shows where each one will come from, ${PUSH_WARNING_S} s ahead.`,
                'Robots resist pushes better from some sides than others. Turn the robot to meet each push on its strongest side. ' +
                  'The balance view shows the centre of mass (dot) and the support polygon (green).',
              ],
              actions: [{ id: 'begin', label: 'Start the pushes', primary: true }],
            }
          : null,
      balanceOverlay: true,
      pendingPush,
      lab: null,
      demo: { available: false, running: false },
    };
  }

  result(): LessonResult | null {
    return this.finished;
  }

  private nextOrFinish(): void {
    if (this.index >= this.series.length) {
      this.finish();
      return;
    }
    this.phase = 'countdown';
    this.clock = 0;
  }

  private finish(): void {
    this.phase = 'done';
    const saves = this.outcomes.filter((o) => o.saved).length;
    const g1 = this.host.robot.id === 'g1';
    const stars = pushStars(saves, PUSH_STAR_THRESHOLDS);
    this.finished = {
      stars,
      counts: true,
      headline: `${saves} of ${this.series.length} pushes saved`,
      lines: [
        ...this.outcomes.map((o, i) => `${o.saved ? '✓' : '✗'} Push ${i + 1}: ${o.push.forceN} N on ${sideLabel(o.side)}`),
        g1
          ? 'The G1 is strongest when pushed on its chest and weakest from the side, where it has to step sideways.'
          : 'The Go2 is strongest when pushed from behind and weakest from the side, where it has to step sideways.',
        'The last push is too strong from any side: every robot has limits.',
      ],
      best: { label: 'Most saves', value: saves, lowerIsBetter: false },
    };
    this.host.announce(`Series complete: ${saves} saves.`, 'good');
  }
}

export const PUSH_LESSON: LessonDef = {
  id: 'push',
  title: 'Push recovery',
  summary: 'Shove the robot harder and harder, and discover why balance is all about where you put your feet.',
  topics: ['Centre of mass', 'Support polygon', 'Impulse'],
  explain: pushExplain,
  create: (host) => new PushLesson(host),
};
