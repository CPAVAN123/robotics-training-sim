/**
 * Meet the robot: a short guided tour of motors, sensors and the control loop, one quiz question,
 * then a first walk to the warm-up checkpoint.
 */
import type { RobotInfo, RobotState, SpawnPose } from '../core/types';
import { ROBOT_FACTS, meetExplain } from './content';
import { meetStars } from './scoring';
import type { HudPart, Lesson, LessonCard, LessonDef, LessonHost, LessonResult, LessonView } from './types';

interface TourStep {
  title: string;
  body: string[];
  highlight?: HudPart;
}

function tour(robot: RobotInfo): TourStep[] {
  const facts = ROBOT_FACTS[robot.id];
  const g1 = robot.id === 'g1';
  return [
    {
      title: `Meet the ${robot.name}`,
      body: [
        `${facts.kindLabel} by ${facts.maker}, ${facts.country}. ${facts.size}; this model weighs ${facts.modelMassKg} kg.`,
        facts.usedFor,
      ],
    },
    {
      title: 'Joints and motors',
      highlight: 'motors',
      body: [
        g1
          ? 'Each leg has 6 joints: 3 at the hip, 1 knee and 2 at the ankle. Every joint has its own motor.'
          : 'Each leg has 3 joints (hip, thigh and knee), and every joint has its own motor.',
        'The motor bars show how hard each motor is working: its torque (turning force) divided by the most it can make.',
      ],
    },
    {
      title: 'Sensors',
      highlight: 'tilt',
      body: [
        'The IMU in the body has a gyroscope, which measures rotation, and an accelerometer, which feels the floor holding the robot up against gravity. Together they tell the robot which way is down. The tilt gauge shows it.',
        'Encoders in every joint measure the joint angles. The foot dots show which feet touch the ground.',
      ],
    },
    {
      title: 'The control loop',
      highlight: 'command',
      body: [
        'Sense → decide → act, over and over. Hz means "times per second".',
        g1
          ? 'At 50 Hz (every 20 ms) a neural network picks a target angle for all 12 leg joints. At 500 Hz (every 2 ms) each motor pushes its joint toward that target.'
          : 'At 500 Hz (every 2 ms) the controller estimates the body\'s motion, decides how hard each standing foot pushes and where each swinging foot lands.',
        'Your command (the bars under "Your command") is one of the inputs the controller reads on every loop.',
      ],
    },
  ];
}

const QUIZ = {
  question: 'Which sensor tells the robot which way is down?',
  choices: ['Joint encoder', 'IMU', 'Foot contact sensor'],
  correct: 1,
};

type Phase = 'tour' | 'quiz' | 'drive' | 'done';

export class MeetLesson implements Lesson {
  readonly id = 'meet';
  private readonly steps: TourStep[];
  private phase: Phase = 'tour';
  private step = 0;
  private quizTries = 0;
  private quizWrong: number[] = [];
  private falls = 0;
  private driveTime = 0;
  private done: LessonResult | null = null;

  constructor(private readonly host: LessonHost) {
    this.steps = tour(host.robot);
  }

  start(): void {
    this.host.announce(`Welcome! Let's meet the ${this.host.robot.name}.`);
  }

  update(state: RobotState, dt: number): void {
    if (this.phase !== 'drive' || state.fallen) return;
    this.driveTime += dt;
    const cp = this.host.arena.checkpoints[0];
    if (Math.hypot(cp.x - state.position[0], cp.y - state.position[1]) < cp.radius) this.finish();
  }

  onFall(): void {
    if (this.phase === 'drive') this.falls++;
    this.host.announce('Oops, it fell! It will be back on its feet in a moment.', 'bad');
  }

  act(actionId: string): void {
    if (this.phase === 'tour') {
      if (actionId === 'next') {
        this.step++;
        if (this.step >= this.steps.length) this.phase = 'quiz';
      } else if (actionId === 'back') {
        this.step = Math.max(0, this.step - 1);
      } else if (actionId === 'skip') {
        this.phase = 'quiz';
      }
      return;
    }
    if (this.phase === 'quiz' && actionId.startsWith('answer-')) {
      const choice = Number(actionId.slice('answer-'.length));
      this.quizTries++;
      if (choice === QUIZ.correct) {
        this.host.announce(
          'Correct! The IMU\'s accelerometer feels the floor holding the robot up against gravity, so while the robot is ' +
            'fairly still it shows which way is down. The gyroscope fills in during fast moves.',
          'good',
        );
        this.phase = 'drive';
      } else {
        this.quizWrong.push(choice);
        this.host.announce(
          choice === 0
            ? 'Not quite: encoders measure joint angles, not the direction of gravity. Try again!'
            : 'Not quite: foot sensors only say whether a foot is touching something. Try again!',
          'bad',
        );
      }
    }
  }

  respawn(): SpawnPose {
    return this.host.arena.spawns.start;
  }

  view(): LessonView {
    const cp = this.host.arena.checkpoints[0];
    return {
      goal:
        this.phase === 'tour'
          ? 'Take the tour'
          : this.phase === 'quiz'
            ? 'Answer the question'
            : this.phase === 'drive'
              ? `Walk to the glowing ring: ${cp.label}`
              : 'Checkpoint reached!',
      status:
        this.phase === 'tour'
          ? [`Step ${this.step + 1} of ${this.steps.length}`]
          : this.phase === 'quiz'
            ? ['Quiz']
            : [`Falls: ${this.falls}`],
      timer: this.phase === 'drive' ? this.driveTime : null,
      checkpoints: this.phase === 'drive' || this.phase === 'done' ? [{ checkpoint: cp, number: 1, state: this.phase === 'done' ? 'done' : 'next' }] : [],
      card: this.card(),
      balanceOverlay: false,
      pendingPush: null,
      lab: null,
      demo: { available: false, running: false },
    };
  }

  result(): LessonResult | null {
    return this.done;
  }

  private card(): LessonCard | null {
    if (this.phase === 'tour') {
      const s = this.steps[this.step];
      const last = this.step === this.steps.length - 1;
      return {
        title: s.title,
        body: s.body,
        highlight: s.highlight,
        actions: [
          ...(this.step > 0 ? [{ id: 'back', label: 'Back' }] : []),
          { id: 'next', label: last ? 'Quiz time' : 'Next', primary: true },
        ],
      };
    }
    if (this.phase === 'quiz') {
      return {
        title: 'Quick check',
        body: [QUIZ.question],
        actions: QUIZ.choices.map((label, i) => ({ id: `answer-${i}`, label: this.quizWrong.includes(i) ? `✗ ${label}` : label })),
      };
    }
    if (this.phase === 'drive') {
      return {
        title: 'Your turn: take a walk',
        body: [
          'Hold W or ↑ to walk forward. Q/E or ←/→ turn, A/D sidestep. On a tablet, use the joysticks.',
          'Walk into the glowing ring 3 m ahead. Keep it steady: no falls earns a star.',
        ],
        highlight: 'speed',
        actions: [],
      };
    }
    return null;
  }

  private finish(): void {
    this.phase = 'done';
    const firstTry = this.quizTries === 1;
    const stars = meetStars(true, this.falls, firstTry);
    this.done = {
      stars,
      counts: true,
      headline: 'You reached the checkpoint!',
      lines: [
        '★ Reached the warm-up checkpoint',
        this.falls === 0 ? '★ No falls' : `☆ ${this.falls} fall${this.falls > 1 ? 's' : ''}: walk more gently for this star`,
        firstTry ? '★ Quiz right first time' : '☆ Quiz: IMU is the answer, now you know!',
      ],
    };
    this.host.announce('Checkpoint reached!', 'good');
  }
}

export const MEET_LESSON: LessonDef = {
  id: 'meet',
  title: 'Meet the robot',
  summary: 'A quick tour of the motors, sensors and control loop, then your first walk.',
  topics: ['Motors & torque', 'IMU & encoders', 'Control loops'],
  explain: meetExplain,
  create: (host) => new MeetLesson(host),
};
