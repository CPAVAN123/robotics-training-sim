/**
 * Runs one lesson: feeds it robot states with the simulated time step, reports falls once, and
 * puts a fallen robot back on its feet after a short pause so the student can see what happened.
 */
import type { RobotState } from '../core/types';
import type { Lesson, LessonDef, LessonHost, LessonResult, LessonView } from './types';

/** Simulated seconds a fallen robot lies on the floor before it is reset. */
export const FALL_RESET_DELAY_S = 1.5;

export class LessonRunner {
  readonly lesson: Lesson;
  private lastTime: number | null = null;
  private wasFallen = false;
  private fallTimer: number | null = null;
  private finished: LessonResult | null = null;

  constructor(
    readonly def: LessonDef,
    private readonly host: LessonHost,
  ) {
    this.lesson = def.create(host);
  }

  start(): void {
    this.host.resetRobot(this.lesson.respawn());
    this.lastTime = null;
    this.lesson.start();
  }

  /** Call once per frame. Returns the result on the frame the lesson ends, otherwise null. */
  update(state: RobotState): LessonResult | null {
    if (this.finished) return null;
    // Simulated time restarts from 0 when the robot is reset.
    const dt = this.lastTime === null ? 0 : state.time >= this.lastTime ? state.time - this.lastTime : state.time;
    this.lastTime = state.time;

    if (state.fallen && !this.wasFallen) {
      this.fallTimer = 0;
      this.lesson.onFall(state);
    }
    this.wasFallen = state.fallen;
    if (this.fallTimer !== null && state.fallen) {
      this.fallTimer += dt;
      if (this.fallTimer >= FALL_RESET_DELAY_S) this.standUp();
    }

    this.lesson.update(state, dt);
    const result = this.lesson.result();
    if (result) this.finished = result;
    return result;
  }

  /** The R key: puts the robot back where the lesson wants it. */
  respawn(): void {
    // A robot already on the floor has had its fall counted; R only skips the wait.
    if (!this.finished && !this.wasFallen) this.lesson.onManualReset?.();
    this.standUp();
  }

  private standUp(): void {
    this.fallTimer = null;
    this.wasFallen = false;
    this.host.resetRobot(this.lesson.respawn());
  }

  act(actionId: string): void {
    this.lesson.act(actionId);
  }

  view(): LessonView {
    return this.lesson.view();
  }

  get result(): LessonResult | null {
    return this.finished;
  }
}
