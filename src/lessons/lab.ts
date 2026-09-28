/**
 * Physics lab: free play with the physics knobs, plus three mini-challenges that each change one
 * thing about the world and ask the student to walk 3 m.
 */
import { DEFAULT_KNOBS, type PhysicsKnobs, type RobotId, type RobotState, type SpawnPose } from '../core/types';
import { knobExplanation, labExplain } from './content';
import { labStars } from './scoring';
import type { KnobKey, LabChallengeView, Lesson, LessonDef, LessonHost, LessonResult, LessonView } from './types';

/** Distance to walk in every challenge, metres. */
export const CHALLENGE_DISTANCE = 3;
export const ICE_FRICTION = 0.2;

/**
 * Targets for the backpack and weak-motor challenges, from measured limits (walk 3 m from the lab
 * spawn at full and 40% stick, two gait phases each):
 *   G1:  15 kg always made it, 18 kg fell 2 of 4 times, 25 kg always fell. 70% motors made it, 65% always fell.
 *   Go2: even 30 kg made it (slowly). 30% motors made it, 25% always fell.
 */
export const LAB_TARGETS: Record<RobotId, { payloadKg: number; motorStrength: number }> = {
  g1: { payloadKg: 10, motorStrength: 0.8 },
  go2: { payloadKg: 15, motorStrength: 0.4 },
};

type ChallengeId = 'ice' | 'backpack' | 'weak';

interface Challenge {
  id: ChallengeId;
  title: string;
  description: string;
  /** The knob this challenge is about. */
  knob: KnobKey;
  done: boolean;
  best: number | null;
}

interface Attempt {
  challenge: Challenge;
  knobs: PhysicsKnobs;
  distance: number;
}

type ExplainedKnob = 'friction' | 'payloadKg' | 'motorStrength' | 'sensorNoise' | 'timeScale';

export class LabLesson implements Lesson {
  readonly id = 'lab';
  private readonly challenges: Challenge[];
  private attempt: Attempt | null = null;
  private lastKnob: ExplainedKnob = 'friction';
  private finished: LessonResult | null = null;

  constructor(private readonly host: LessonHost) {
    const t = LAB_TARGETS[host.robot.id];
    this.challenges = [
      {
        id: 'ice',
        title: 'Walk on ice',
        description: `Friction drops to ${ICE_FRICTION}, like shoes on ice. Walk ${CHALLENGE_DISTANCE} m.`,
        knob: 'friction',
        done: false,
        best: null,
      },
      {
        id: 'backpack',
        title: 'Heavy backpack',
        description: `Set the backpack, then carry it ${CHALLENGE_DISTANCE} m. ${t.payloadKg} kg or more completes it.`,
        knob: 'payloadKg',
        done: false,
        best: null,
      },
      {
        id: 'weak',
        title: 'Weakest motors',
        description: `Turn the motors down, then walk ${CHALLENGE_DISTANCE} m. ${Math.round(t.motorStrength * 100)}% or less completes it.`,
        knob: 'motorStrength',
        done: false,
        best: null,
      },
    ];
  }

  start(): void {
    this.host.announce('Welcome to the lab. Change the knobs and see what happens, or try a challenge.');
  }

  update(state: RobotState, _dt: number): void {
    const a = this.attempt;
    if (!a || state.fallen) return;
    const spawn = this.respawn();
    a.distance = Math.hypot(state.position[0] - spawn.x, state.position[1] - spawn.y);
    if (a.distance >= CHALLENGE_DISTANCE) this.succeed(a);
  }

  onFall(): void {
    const a = this.attempt;
    const why = fallReason(this.host.knobs, this.host.robot.id);
    if (a) {
      this.attempt = null;
      this.host.announce(`Attempt failed: ${why} Change something and try again.`, 'bad');
    } else {
      this.host.announce(`It fell: ${why}`, 'bad');
    }
  }

  act(actionId: string): void {
    if (actionId.startsWith('knob:')) {
      this.lastKnob = actionId.slice(5) as ExplainedKnob;
      return;
    }
    if (actionId.startsWith('start:')) {
      const challenge = this.challenges.find((c) => c.id === actionId.slice(6));
      if (challenge) this.begin(challenge);
      return;
    }
    if (actionId === 'cancel') {
      this.attempt = null;
      this.host.announce('Attempt cancelled.');
      return;
    }
    if (actionId === 'finish') this.finish();
  }

  respawn(): SpawnPose {
    return this.host.arena.spawns.lab;
  }

  view(): LessonView {
    const a = this.attempt;
    const knobs = this.host.knobs;
    const challenges: LabChallengeView[] = this.challenges.map((c) => ({
      id: c.id,
      title: c.title,
      description: c.description,
      done: c.done,
      best: c.best === null ? null : formatBest(c.id, c.best),
      active: a?.challenge === c,
    }));
    const completed = this.challenges.filter((c) => c.done).length;
    return {
      goal: a ? `${a.challenge.title}: walk ${CHALLENGE_DISTANCE} m` : 'Experiment with the knobs or start a challenge',
      status: [`Challenges: ${completed} of ${this.challenges.length}`],
      timer: null,
      checkpoints: [],
      card: null,
      balanceOverlay: false,
      pendingPush: null,
      lab: {
        locked: a ? (Object.keys(DEFAULT_KNOBS) as KnobKey[]).filter((k) => k !== 'timeScale') : [],
        challenges,
        explanation: knobExplanation(this.host.robot, this.lastKnob, knobs[this.lastKnob], this.host.robotMassKg),
        attemptProgress: a ? Math.min(1, a.distance / CHALLENGE_DISTANCE) : null,
      },
      demo: { available: false, running: false },
    };
  }

  result(): LessonResult | null {
    return this.finished;
  }

  private begin(challenge: Challenge): void {
    const knobs = this.host.knobs;
    // Every challenge starts from normal physics except its own knob (slow motion is kept).
    const settings: PhysicsKnobs = { ...DEFAULT_KNOBS, timeScale: knobs.timeScale };
    if (challenge.id === 'ice') settings.friction = ICE_FRICTION;
    if (challenge.id === 'backpack') settings.payloadKg = knobs.payloadKg;
    if (challenge.id === 'weak') settings.motorStrength = knobs.motorStrength;
    this.host.setKnobs(settings);
    this.host.resetRobot(this.respawn());
    this.lastKnob = challenge.knob as ExplainedKnob;
    this.attempt = { challenge, knobs: settings, distance: 0 };
    this.host.announce(`${challenge.title}: go! Walk ${CHALLENGE_DISTANCE} m.`);
  }

  private succeed(a: Attempt): void {
    const c = a.challenge;
    const t = LAB_TARGETS[this.host.robot.id];
    this.attempt = null;
    let message: string;
    if (c.id === 'ice') {
      c.done = true;
      c.best = a.knobs.friction;
      message = 'You crossed the ice! A foot can push sideways with at most μ × the weight on it, so gentle starts, stops and turns slip least.';
    } else if (c.id === 'backpack') {
      const kg = a.knobs.payloadKg;
      c.best = Math.max(c.best ?? 0, kg);
      const was = c.done;
      c.done ||= kg >= t.payloadKg;
      message = c.done && !was
        ? `Carried ${kg.toFixed(1)} kg: challenge complete! Try even more.`
        : kg >= t.payloadKg
          ? `Carried ${kg.toFixed(1)} kg. Can it take more?`
          : `Carried ${kg.toFixed(1)} kg. Try at least ${t.payloadKg} kg to complete the challenge.`;
    } else {
      const s = a.knobs.motorStrength;
      c.best = Math.min(c.best ?? Infinity, s);
      const was = c.done;
      c.done ||= s <= t.motorStrength + 1e-9;
      message = c.done && !was
        ? `Walked with ${Math.round(s * 100)}% motors: challenge complete! How low can you go?`
        : s <= t.motorStrength + 1e-9
          ? `Walked with ${Math.round(s * 100)}% motors. Try weaker still?`
          : `Walked with ${Math.round(s * 100)}% motors. Go down to ${Math.round(t.motorStrength * 100)}% to complete the challenge.`;
    }
    const allDone = this.challenges.every((ch) => ch.done);
    // The lab never ends on its own: the student may want to keep pushing a limit.
    this.host.announce(allDone ? `${message} All three challenges done: press "Finish lab & see stars" whenever you are ready.` : message, 'good');
  }

  private finish(): void {
    const completed = this.challenges.filter((c) => c.done);
    this.attempt = null;
    this.finished = {
      stars: labStars(completed.length),
      counts: true,
      headline: completed.length === 3 ? 'Lab complete: all three challenges!' : `Lab finished: ${completed.length} of 3 challenges`,
      lines: this.challenges.map(
        (c) => `${c.done ? '★' : '☆'} ${c.title}${c.best !== null ? ` (best: ${formatBest(c.id, c.best)})` : ''}`,
      ),
    };
  }
}

function formatBest(id: ChallengeId, value: number): string {
  if (id === 'ice') return `μ ${value.toFixed(2)}`;
  if (id === 'backpack') return `${value.toFixed(1)} kg`;
  return `${Math.round(value * 100)}% motors`;
}

/** The most likely reason for a fall with these knob settings, in plain words. */
export function fallReason(knobs: PhysicsKnobs, robot: RobotId): string {
  if (knobs.friction < 0.3) return 'its feet slipped. With so little friction the floor cannot push back hard enough.';
  if (knobs.motorStrength < LAB_TARGETS[robot].motorStrength) {
    return robot === 'g1'
      ? 'the motors were too soft. The network expects stiffer joints than these.'
      : 'the motors were too weak to catch each step in time.';
  }
  if (knobs.payloadKg > LAB_TARGETS[robot].payloadKg) return 'the backpack was too heavy for the leg motors.';
  if (knobs.sensorNoise >= 3) return 'the sensors were so noisy that the controller reacted to movements that were not happening.';
  return 'it lost its balance.';
}

export const LAB_LESSON: LessonDef = {
  id: 'lab',
  title: 'Physics lab',
  summary: 'Turn the knobs on friction, weight, motors and sensors, and find out what makes robots fall.',
  topics: ['Friction', 'Weight & torque', 'Sensor noise'],
  explain: labExplain,
  create: (host) => new LabLesson(host),
};
