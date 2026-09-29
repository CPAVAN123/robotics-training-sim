/**
 * Lesson contracts. A lesson never touches the DOM or MuJoCo directly: it drives the robot through a
 * LessonHost and describes what the UI should show through a LessonView, so it can be unit-tested
 * with a fake host and synthetic robot states.
 */
import type { ArenaLayout, Checkpoint, PhysicsKnobs, RobotInfo, RobotState, SpawnPose } from '../core/types';

export type LessonId = 'meet' | 'course' | 'push' | 'lab';
export type Stars = 0 | 1 | 2 | 3;
export type Tone = 'info' | 'good' | 'bad';

/** What a lesson may do to the world. Implemented by the app over the Simulation. */
export interface LessonHost {
  readonly robot: RobotInfo;
  readonly arena: ArenaLayout;
  readonly knobs: PhysicsKnobs;
  /** Total robot mass right now (including any payload), kg. */
  readonly robotMassKg: number;
  resetRobot(spawn: SpawnPose): void;
  push(forceN: number, directionRad: number, durationS?: number): void;
  setKnobs(knobs: Partial<PhysicsKnobs>): void;
  /** Short feedback for the student: shown as a toast and read out by screen readers. */
  announce(text: string, tone?: Tone): void;
}

/** Parts of the HUD a tour step can point at. */
export type HudPart = 'motors' | 'tilt' | 'feet' | 'speed' | 'command';

export interface CardAction {
  id: string;
  label: string;
  primary?: boolean;
}

/** A box of text with buttons: tour steps, quiz questions, "start" prompts. */
export interface LessonCard {
  title: string;
  body: string[];
  actions: CardAction[];
  highlight?: HudPart;
}

export interface CheckpointMarker {
  checkpoint: Checkpoint;
  state: 'done' | 'next' | 'todo';
  /** Number shown above the ring (1-based order). */
  number: number;
}

/** A push that is about to happen, so the view can show where it will come from. */
export interface PendingPush {
  forceN: number;
  directionRad: number;
  inS: number;
}

export type KnobKey = keyof PhysicsKnobs;

export interface LabChallengeView {
  id: string;
  title: string;
  description: string;
  done: boolean;
  best: string | null;
  active: boolean;
}

/** Everything the Physics Lab panel needs. */
export interface LabView {
  /** Knobs the student may not change right now (fixed by the running challenge). */
  locked: KnobKey[];
  challenges: LabChallengeView[];
  /** Live explanation of the most recently changed knob. */
  explanation: { title: string; lines: string[] };
  /** Progress of a running attempt, 0..1. */
  attemptProgress: number | null;
}

export interface LessonView {
  goal: string;
  /** Short status lines, e.g. "Checkpoint 2 of 7". */
  status: string[];
  /** Lesson clock in seconds, or null to hide it. */
  timer: number | null;
  checkpoints: CheckpointMarker[];
  card: LessonCard | null;
  /** Show the centre-of-mass / support-polygon overlay by default. */
  balanceOverlay: boolean;
  pendingPush: PendingPush | null;
  lab: LabView | null;
  /** The course lesson offers a "watch the autopilot" demo. */
  demo: { available: boolean; running: boolean };
}

export interface LessonResult {
  stars: Stars;
  /** False when the run doesn't count (e.g. a demo) and shouldn't be saved. */
  counts: boolean;
  headline: string;
  lines: string[];
  /** A number worth remembering as a personal best (e.g. course time). */
  best?: { label: string; value: number; lowerIsBetter: boolean };
}

export interface Lesson {
  readonly id: LessonId;
  /** Called once when the lesson begins (the robot has just been reset). */
  start(): void;
  /** Called every frame with the robot's state and the simulated seconds since the last call. */
  update(state: RobotState, dt: number): void;
  /** Called once when the robot falls (the rising edge of state.fallen). */
  onFall(state: RobotState): void;
  /**
   * The student reset the robot (R) while it was still standing, just before it is put back. Lessons
   * that score falls count this too, so R can't be used to dodge a fall that is about to happen.
   */
  onManualReset?(): void;
  /** A button on the lesson card or panel was pressed. */
  act(actionId: string): void;
  /** Where "R" (reset) puts the robot. */
  respawn(): SpawnPose;
  view(): LessonView;
  /** Non-null once the lesson is over. */
  result(): LessonResult | null;
  /** The course demo: the app drives with the autopilot toward this checkpoint. */
  autopilotTarget?(): Checkpoint | null;
}

export interface ExplainSection {
  title: string;
  paragraphs: string[];
}

export interface LessonDef {
  id: LessonId;
  title: string;
  summary: string;
  /** Big ideas covered, shown on the lesson card. */
  topics: string[];
  explain(robot: RobotInfo): ExplainSection[];
  create(host: LessonHost): Lesson;
}
