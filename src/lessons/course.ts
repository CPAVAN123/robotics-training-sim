/**
 * Obstacle course: reach the checkpoints in order as fast as possible. A fall, or a reset with R, costs
 * a time penalty and puts the robot back at the last checkpoint it reached. The clock starts when the
 * student presses Start on the intro card.
 */
import type { Checkpoint, RobotState, SpawnPose } from '../core/types';
import { courseExplain } from './content';
import { COURSE_PAR, FALL_PENALTY_S, courseScore, courseStars, formatTime } from './scoring';
import type { Lesson, LessonDef, LessonHost, LessonResult, LessonView } from './types';

export class CourseLesson implements Lesson {
  readonly id = 'course';
  private next = 0;
  private time = 0;
  private falls = 0;
  private resets = 0;
  private running = false;
  private demo = false;
  /** True if the autopilot drove at any point: the run is then a demo and earns no stars. */
  private usedDemo = false;
  private done: LessonResult | null = null;

  constructor(private readonly host: LessonHost) {}

  private get checkpoints(): Checkpoint[] {
    return this.host.arena.checkpoints;
  }

  start(): void {
    this.host.announce('Obstacle course: read the rules, then press Start.');
  }

  private get penalties(): number {
    return this.falls + this.resets;
  }

  update(state: RobotState, dt: number): void {
    if (!this.running || this.done) return;
    this.time += dt;
    if (state.fallen) return;
    const cp = this.checkpoints[this.next];
    if (Math.hypot(cp.x - state.position[0], cp.y - state.position[1]) >= cp.radius) return;
    this.next++;
    if (this.next === this.checkpoints.length) {
      this.finish();
    } else {
      const upcoming = this.checkpoints[this.next];
      this.host.announce(`Checkpoint ${this.next} ✓ Next: ${upcoming.label}.`, 'good');
    }
  }

  onFall(): void {
    if (this.done) return;
    if (!this.running) {
      this.host.announce('It fell! Back on its feet in a moment. The clock has not started yet.', 'bad');
      return;
    }
    this.falls++;
    this.host.announce(`Fall! +${FALL_PENALTY_S} s penalty. Back to the last checkpoint…`, 'bad');
  }

  onManualReset(): void {
    if (!this.running || this.done) return;
    this.resets++;
    this.host.announce(`Reset: +${FALL_PENALTY_S} s penalty, like a fall. Back to the last checkpoint.`, 'bad');
  }

  act(actionId: string): void {
    if (actionId === 'go' && !this.running) this.go();
    if (actionId === 'demo') {
      // The autopilot drives from the start line, so turning it on also starts the run.
      if (!this.running) this.go();
      this.demo = !this.demo;
      if (this.demo) {
        this.usedDemo = true;
        this.host.announce('Autopilot on: watch how it lines up before each gap. This run will not earn stars.');
      } else {
        this.host.announce('Autopilot off: you are driving.');
      }
    }
  }

  autopilotTarget(): Checkpoint | null {
    return this.demo && !this.done ? this.checkpoints[this.next] ?? null : null;
  }

  /** The last checkpoint reached (or the start), facing the next one. */
  respawn(): SpawnPose {
    const start = this.host.arena.spawns.start;
    const from = this.next === 0 ? start : this.checkpoints[this.next - 1];
    const to = this.checkpoints[Math.min(this.next, this.checkpoints.length - 1)];
    const heading = this.next === 0 ? start.heading : Math.atan2(to.y - from.y, to.x - from.x);
    return { x: from.x, y: from.y, heading };
  }

  view(): LessonView {
    const total = this.checkpoints.length;
    const par = COURSE_PAR[this.host.robot.id];
    const upcoming = this.checkpoints[this.next];
    const penalty = this.penalties ? ` (+${this.penalties * FALL_PENALTY_S} s)` : '';
    return {
      goal: !this.running
        ? 'Get ready: press Start'
        : upcoming
          ? `Walk to checkpoint ${this.next + 1}: ${upcoming.label}`
          : 'Course complete!',
      status: [
        `Checkpoint ${Math.min(this.next + 1, total)} of ${total}`,
        this.resets ? `Falls: ${this.falls} · Resets: ${this.resets}${penalty}` : `Falls: ${this.falls}${penalty}`,
        `3 stars: under ${par.three} s`,
      ],
      timer: this.time + this.penalties * FALL_PENALTY_S,
      checkpoints: this.checkpoints.map((checkpoint, i) => ({
        checkpoint,
        number: i + 1,
        state: i < this.next ? 'done' : i === this.next ? 'next' : 'todo',
      })),
      card: this.running
        ? null
        : {
            title: 'Obstacle course',
            body: [
              `Walk through the ${total} numbered rings in order. The clock starts when you press Start.`,
              `A fall, or pressing R to reset, adds ${FALL_PENALTY_S} s and puts the robot back at the last ring it reached. ` +
                `3 stars: under ${par.three} s. 2 stars: under ${par.two} s.`,
            ],
            actions: [{ id: 'go', label: 'Start', primary: true }],
          },
      balanceOverlay: false,
      pendingPush: null,
      lab: null,
      demo: { available: true, running: this.demo },
    };
  }

  result(): LessonResult | null {
    return this.done;
  }

  private go(): void {
    // Start from the start line, wherever the robot wandered while the rules were up.
    this.host.resetRobot(this.respawn());
    this.running = true;
    this.host.announce(`Go! Walk to checkpoint 1: ${this.checkpoints[0].label}.`);
  }

  private finish(): void {
    const robot = this.host.robot.id;
    const score = courseScore(this.time, this.penalties);
    const counts = !this.usedDemo;
    const stars = counts ? courseStars(robot, true, this.time, this.penalties) : 0;
    const par = COURSE_PAR[robot];
    this.demo = false;
    this.done = {
      stars,
      counts,
      headline: counts ? 'Course complete!' : 'Demo complete: now you try!',
      lines: [
        `Walking time ${formatTime(this.time)}` +
          (this.penalties ? ` + ${penaltyWords(this.falls, this.resets)} × ${FALL_PENALTY_S} s` : ', no falls') +
          ` = ${formatTime(score)}`,
        counts
          ? stars === 3
            ? 'Superb driving: smooth lines and no wasted steps.'
            : `For ${stars + 1} stars finish in under ${stars === 2 ? par.three : par.two} s (falls and resets add ${FALL_PENALTY_S} s).`
          : 'The autopilot drove during this run, so it earns no stars.',
        'Tip: slow down before the pallet gap and cross the ramp and cable bumps straight.',
      ],
      best: counts ? { label: 'Best time', value: score, lowerIsBetter: true } : undefined,
    };
    this.host.announce(`Finished in ${formatTime(score)}!`, 'good');
  }
}

/** "2 falls + 1 reset" */
function penaltyWords(falls: number, resets: number): string {
  const count = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
  return [falls ? count(falls, 'fall') : '', resets ? count(resets, 'reset') : ''].filter(Boolean).join(' + ');
}

export const COURSE_LESSON: LessonDef = {
  id: 'course',
  title: 'Obstacle course',
  summary: 'Weave through crates, squeeze through a pallet gap, climb the loading ramp and beat the clock.',
  topics: ['Steering', 'Friction in turns', 'Slopes'],
  explain: courseExplain,
  create: (host) => new CourseLesson(host),
};
