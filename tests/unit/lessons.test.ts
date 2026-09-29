/**
 * Lesson engine: scoring, saved progress, the runner, each lesson's logic with a fake host, the balance
 * geometry, and (with the real MuJoCo simulation) the calibration of the push-recovery series.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WAREHOUSE } from '../../src/core/arena';
import { Simulation } from '../../src/core/simulation';
import { DEFAULT_KNOBS, type PhysicsKnobs, type RobotId, type RobotState, type SpawnPose } from '../../src/core/types';
import { convexHull, stabilityMargin } from '../../src/lessons/balance';
import { COURSE_LESSON } from '../../src/lessons/course';
import { LESSONS, lessonById, nextLesson } from '../../src/lessons';
import { CHALLENGE_DISTANCE, ICE_FRICTION, LAB_LESSON, LAB_TARGETS, fallReason } from '../../src/lessons/lab';
import { MEET_LESSON } from '../../src/lessons/meet';
import { Progress, PROGRESS_KEY, type KeyValueStore } from '../../src/lessons/progress';
import {
  PUSH_DURATION_S,
  PUSH_JUDGE_S,
  PUSH_LESSON,
  PUSH_SERIES,
  PUSH_WARNING_S,
  SAFE_PUSH_N,
  pushDirection,
  pushLevelForce,
  pushSide,
} from '../../src/lessons/push';
import { FALL_RESET_DELAY_S, LessonRunner } from '../../src/lessons/runner';
import { COURSE_PAR, FALL_PENALTY_S, courseStars, formatTime, labStars, meetStars, pushStars } from '../../src/lessons/scoring';
import type { LessonHost, LessonResult, Tone } from '../../src/lessons/types';
import { axesToCommand, rampAxes, ZERO_AXES, type Axes } from '../../src/input/mapping';
import { wrapAngle } from '../../src/robots/autopilot';
import { ROBOTS } from '../../src/robots/registry';
import { nodeLoadFile } from './helpers/loadFile';

/** A host that records what lessons ask for, with a robot we move by hand. */
class FakeHost implements LessonHost {
  readonly arena = WAREHOUSE;
  knobs: PhysicsKnobs = { ...DEFAULT_KNOBS };
  readonly resets: SpawnPose[] = [];
  readonly pushes: { forceN: number; directionRad: number; durationS?: number }[] = [];
  readonly messages: { text: string; tone?: Tone }[] = [];
  constructor(readonly robot = ROBOTS.g1) {}
  get robotMassKg() {
    return 32.1 + this.knobs.payloadKg;
  }
  resetRobot(spawn: SpawnPose) {
    this.resets.push(spawn);
  }
  push(forceN: number, directionRad: number, durationS?: number) {
    this.pushes.push({ forceN, directionRad, durationS });
  }
  setKnobs(knobs: Partial<PhysicsKnobs>) {
    this.knobs = { ...this.knobs, ...knobs };
  }
  announce(text: string, tone?: Tone) {
    this.messages.push({ text, tone });
  }
}

function state(time: number, x: number, y: number, extra: Partial<RobotState> = {}): RobotState {
  return {
    time,
    position: [x, y, 0.75],
    heading: 0,
    velocity: [0, 0],
    tilt: 0,
    fallen: false,
    torques: new Float64Array(12),
    torqueLimits: new Float64Array(12).fill(50),
    footContacts: [true, true],
    ...extra,
  };
}

/** Feeds a runner one state per 20 ms of simulated time from `from` to `to`, walking in a straight line. */
function walk(runner: LessonRunner, t0: number, from: [number, number], to: [number, number], seconds: number): number {
  const steps = Math.round(seconds / 0.02);
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    runner.update(state(t0 + i * 0.02, from[0] + (to[0] - from[0]) * f, from[1] + (to[1] - from[1]) * f));
  }
  return t0 + steps * 0.02;
}

describe('scoring', () => {
  it('rates the obstacle course by time plus a penalty per fall', () => {
    const par = COURSE_PAR.g1;
    expect(courseStars('g1', false, 10, 0)).toBe(0);
    expect(courseStars('g1', true, par.three, 0)).toBe(3);
    expect(courseStars('g1', true, par.three - FALL_PENALTY_S + 1, 1)).toBe(2);
    expect(courseStars('g1', true, par.two, 0)).toBe(2);
    expect(courseStars('g1', true, par.two + 0.1, 0)).toBe(1);
    expect(courseStars('go2', true, COURSE_PAR.go2.three, 0)).toBe(3);
  });

  it('keeps 3-star course times reachable but harder than the autopilot (36 s G1, 30 s Go2)', () => {
    expect(COURSE_PAR.g1.three).toBeGreaterThan(36);
    expect(COURSE_PAR.go2.three).toBeGreaterThan(30);
    expect(COURSE_PAR.g1.three).toBeLessThan(COURSE_PAR.g1.two);
  });

  it('gives one meet-the-robot star each for arriving, not falling and the quiz', () => {
    expect(meetStars(false, 0, true)).toBe(0);
    expect(meetStars(true, 0, true)).toBe(3);
    expect(meetStars(true, 2, true)).toBe(2);
    expect(meetStars(true, 0, false)).toBe(2);
    expect(meetStars(true, 1, false)).toBe(1);
  });

  it('scores pushes and lab challenges', () => {
    expect(pushStars(3, [4, 6, 7])).toBe(0);
    expect(pushStars(4, [4, 6, 7])).toBe(1);
    expect(pushStars(6, [4, 6, 7])).toBe(2);
    expect(pushStars(8, [4, 6, 7])).toBe(3);
    expect(labStars(0)).toBe(0);
    expect(labStars(2)).toBe(2);
    expect(labStars(5)).toBe(3);
  });

  it('formats times for students', () => {
    expect(formatTime(5.04)).toBe('5.0 s');
    expect(formatTime(65.25)).toBe('1:05.3');
    expect(formatTime(-1)).toBe('0.0 s');
  });
});

describe('saved progress', () => {
  class MemoryStore implements KeyValueStore {
    data = new Map<string, string>();
    getItem(key: string) {
      return this.data.get(key) ?? null;
    }
    setItem(key: string, value: string) {
      this.data.set(key, value);
    }
  }
  const result = (stars: 0 | 1 | 2 | 3, best?: number): LessonResult => ({
    stars,
    counts: true,
    headline: '',
    lines: [],
    best: best === undefined ? undefined : { label: 'Best time', value: best, lowerIsBetter: true },
  });

  it('keeps the best stars and personal best per robot and lesson, and survives a reload', () => {
    const store = new MemoryStore();
    const p = new Progress(store);
    expect(p.record('g1', 'course', result(2, 80))).toEqual({ moreStars: true, newBest: false });
    expect(p.record('g1', 'course', result(1, 95))).toEqual({ moreStars: false, newBest: false });
    expect(p.record('g1', 'course', result(3, 55))).toEqual({ moreStars: true, newBest: true });
    expect(p.get('g1', 'course')).toEqual({ stars: 3, best: 55, bestLabel: 'Best time' });
    expect(p.stars('go2', 'course')).toBe(0);
    expect(new Progress(store).get('g1', 'course')).toEqual({ stars: 3, best: 55, bestLabel: 'Best time' });
    expect(new Progress(store).totalStars('g1')).toBe(3);
  });

  it('does not save runs that do not count (demos)', () => {
    const p = new Progress(new MemoryStore());
    expect(p.record('g1', 'course', { ...result(3, 40), counts: false })).toEqual({ moreStars: false, newBest: false });
    expect(p.get('g1', 'course')).toBeUndefined();
  });

  it('keeps working when storage throws or is missing', () => {
    const broken: KeyValueStore = {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('QuotaExceededError');
      },
    };
    const p = new Progress(broken);
    expect(() => p.record('go2', 'push', result(2))).not.toThrow();
    expect(p.stars('go2', 'push')).toBe(2);
    const none = new Progress(null);
    none.record('g1', 'meet', result(1));
    expect(none.stars('g1', 'meet')).toBe(1);
  });

  it('ignores corrupted or tampered saves', () => {
    const store = new MemoryStore();
    store.setItem(PROGRESS_KEY, '{not json');
    expect(new Progress(store).totalStars('g1')).toBe(0);
    store.setItem(PROGRESS_KEY, JSON.stringify({ g1: { meet: { stars: 9 }, course: { stars: 'x' }, bogus: { stars: 3 } }, r2d2: {} }));
    const p = new Progress(store);
    expect(p.stars('g1', 'meet')).toBe(3);
    expect(p.get('g1', 'course')).toBeUndefined();
    expect(p.totalStars('g1')).toBe(3);
  });
});

describe('lesson list', () => {
  it('has the four lessons in teaching order', () => {
    expect(LESSONS.map((l) => l.id)).toEqual(['meet', 'course', 'push', 'lab']);
    expect(lessonById('push').title).toBe('Push recovery');
    expect(nextLesson('meet')?.id).toBe('course');
    expect(nextLesson('lab')).toBeNull();
  });

  it('has explanations and topics for both robots', () => {
    for (const lesson of LESSONS) {
      expect(lesson.topics.length).toBeGreaterThan(0);
      for (const robot of Object.values(ROBOTS)) {
        const sections = lesson.explain(robot);
        expect(sections.length, `${lesson.id} ${robot.id}`).toBeGreaterThan(1);
        for (const s of sections) expect(s.paragraphs.join(' ')).not.toMatch(/undefined|NaN/);
      }
    }
  });
});

describe('lesson runner', () => {
  it('measures simulated time between frames, including across resets', () => {
    const host = new FakeHost();
    const runner = new LessonRunner(COURSE_LESSON, host);
    runner.start();
    expect(host.resets).toEqual([WAREHOUSE.spawns.start]);
    runner.act('go');
    runner.update(state(0, -12.5, -6));
    runner.update(state(1.5, -12.5, -6));
    expect(runner.view().timer).toBeCloseTo(1.5);
    // After a reset the physics clock restarts from 0.
    runner.update(state(0.25, -12.5, -6));
    expect(runner.view().timer).toBeCloseTo(1.75);
  });

  it('reports a fall once, then puts the robot back after a pause', () => {
    const host = new FakeHost();
    const runner = new LessonRunner(COURSE_LESSON, host);
    runner.start();
    runner.act('go');
    runner.update(state(1, -12, -6));
    for (let t = 1.02; t < 1 + FALL_RESET_DELAY_S - 0.05; t += 0.02) runner.update(state(t, -12, -6, { fallen: true }));
    expect(host.resets).toHaveLength(2);
    expect(host.messages.filter((m) => m.tone === 'bad')).toHaveLength(1);
    runner.update(state(1 + FALL_RESET_DELAY_S + 0.1, -12, -6, { fallen: true }));
    expect(host.resets).toHaveLength(3);
    expect(runner.view().status).toContain(`Falls: 1 (+${FALL_PENALTY_S} s)`);
  });
});

describe('obstacle course lesson', () => {
  const cps = WAREHOUSE.checkpoints;

  it('waits on a rules card until Start, then starts the clock from the start line', () => {
    const host = new FakeHost();
    const runner = new LessonRunner(COURSE_LESSON, host);
    runner.start();
    const card = runner.view().card;
    expect(card?.body.join(' ')).toMatch(new RegExp(`adds ${FALL_PENALTY_S} s`));
    expect(card?.actions).toEqual([{ id: 'go', label: 'Start', primary: true }]);
    // Wandering off and falling before Start costs nothing.
    walk(runner, 0, [WAREHOUSE.spawns.start.x, WAREHOUSE.spawns.start.y], [-10, -6], 3);
    runner.update(state(3.02, -10, -6, { fallen: true }));
    expect(runner.view().timer).toBe(0);
    runner.act('go');
    expect(host.resets.at(-1)).toEqual(WAREHOUSE.spawns.start);
    expect(runner.view().card).toBeNull();
    walk(runner, 0, [WAREHOUSE.spawns.start.x, WAREHOUSE.spawns.start.y], [-12, -6], 2);
    expect(runner.view().timer).toBeCloseTo(2);
    expect(runner.view().status[1]).toBe('Falls: 0');
  });

  it('charges a reset with R like a fall, but not twice for a robot already on the floor', () => {
    const host = new FakeHost();
    const runner = new LessonRunner(COURSE_LESSON, host);
    runner.start();
    runner.act('go');
    let t = walk(runner, 0, [WAREHOUSE.spawns.start.x, WAREHOUSE.spawns.start.y], [-12, -6], 2);
    const before = runner.view().timer ?? 0;
    runner.respawn();
    expect(host.messages.at(-1)?.tone).toBe('bad');
    expect(runner.view().timer).toBeCloseTo(before + FALL_PENALTY_S);
    runner.update(state((t += 0.02), -12, -6, { fallen: true }));
    runner.respawn();
    expect(runner.view().status[1]).toBe(`Falls: 1 · Resets: 1 (+${2 * FALL_PENALTY_S} s)`);
  });

  it('reaches the checkpoints in order and scores the run', () => {
    const host = new FakeHost();
    const runner = new LessonRunner(COURSE_LESSON, host);
    runner.start();
    runner.act('go');
    runner.update(state(0, WAREHOUSE.spawns.start.x, WAREHOUSE.spawns.start.y));
    // Jumping straight to checkpoint 3 does not count: checkpoints must be taken in order.
    runner.update(state(3, cps[2].x, cps[2].y));
    expect(runner.view().checkpoints.filter((c) => c.state === 'done')).toHaveLength(0);
    let t = 3;
    let at: [number, number] = [cps[2].x, cps[2].y];
    for (const cp of cps) {
      expect(runner.result).toBeNull();
      t = walk(runner, t, at, [cp.x, cp.y], 5);
      at = [cp.x, cp.y];
    }
    const result = runner.result;
    // 3 s + 6 legs of 5 s + most of the last leg (the finish ring is 0.5 m wide), no falls.
    expect(result?.counts).toBe(true);
    expect(result?.best?.value).toBeGreaterThan(36);
    expect(result?.best?.value).toBeLessThanOrEqual(38);
    expect(result?.stars).toBe(3);
    expect(result?.lines[0]).toMatch(/no falls/);
  });

  it('respawns at the last checkpoint reached, facing the next one', () => {
    const host = new FakeHost();
    const runner = new LessonRunner(COURSE_LESSON, host);
    runner.start();
    runner.act('go');
    walk(runner, 0, [WAREHOUSE.spawns.start.x, WAREHOUSE.spawns.start.y], [cps[0].x, cps[0].y], 4);
    walk(runner, 4, [cps[0].x, cps[0].y], [cps[1].x, cps[1].y], 3);
    const spawn = runner.lesson.respawn();
    expect(spawn.x).toBe(cps[1].x);
    expect(spawn.y).toBe(cps[1].y);
    expect(spawn.heading).toBeCloseTo(Math.atan2(cps[2].y - cps[1].y, cps[2].x - cps[1].x));
  });

  it('drives with the autopilot in demo mode, and a demo run earns no stars', () => {
    const host = new FakeHost();
    const runner = new LessonRunner(COURSE_LESSON, host);
    runner.start();
    expect(runner.lesson.autopilotTarget?.()).toBeNull();
    runner.act('demo');
    expect(runner.lesson.autopilotTarget?.()).toBe(cps[0]);
    let t = 0;
    let at: [number, number] = [WAREHOUSE.spawns.start.x, WAREHOUSE.spawns.start.y];
    for (const cp of cps) {
      t = walk(runner, t, at, [cp.x, cp.y], 2);
      at = [cp.x, cp.y];
    }
    expect(runner.result?.counts).toBe(false);
    expect(runner.result?.stars).toBe(0);
  });
});

describe('meet the robot lesson', () => {
  it('runs the tour, the quiz and the first walk', () => {
    const host = new FakeHost(ROBOTS.go2);
    const runner = new LessonRunner(MEET_LESSON, host);
    runner.start();
    const seen: string[] = [];
    while (runner.view().card?.actions.some((a) => a.id === 'next')) {
      seen.push(runner.view().card?.highlight ?? '-');
      runner.act('next');
    }
    expect(seen).toEqual(['-', 'motors', 'tilt', 'command']);
    const quiz = runner.view().card;
    expect(quiz?.title).toBe('Quick check');
    runner.act('answer-0');
    expect(host.messages.at(-1)?.tone).toBe('bad');
    runner.act('answer-1');
    expect(host.messages.at(-1)?.tone).toBe('good');
    expect(runner.view().checkpoints).toHaveLength(1);
    const cp = WAREHOUSE.checkpoints[0];
    walk(runner, 0, [WAREHOUSE.spawns.start.x, WAREHOUSE.spawns.start.y], [cp.x, cp.y], 5);
    // Arrived without falling, but the quiz needed two tries.
    expect(runner.result?.stars).toBe(2);
  });
});

describe('push recovery lesson', () => {
  it('warns, pushes from the announced side, then judges the save', () => {
    const host = new FakeHost();
    const runner = new LessonRunner(PUSH_LESSON, host);
    runner.start();
    expect(host.resets).toEqual([WAREHOUSE.spawns.pushPad]);
    expect(runner.view().balanceOverlay).toBe(true);
    runner.act('begin');
    let t = 0;
    const tick = (seconds: number, extra: Partial<RobotState> = {}) => {
      for (let i = 0; i < Math.round(seconds / 0.02); i++) runner.update(state((t += 0.02), 8, 4, extra));
    };
    tick(1);
    const pending = runner.view().pendingPush;
    const first = PUSH_SERIES.g1[0];
    expect(pending?.forceN).toBe(first.forceN);
    expect(pending?.directionRad).toBeCloseTo(first.fromRad + Math.PI);
    tick(PUSH_WARNING_S - 1 + 0.1);
    expect(host.pushes).toEqual([{ forceN: first.forceN, directionRad: first.fromRad + Math.PI, durationS: PUSH_DURATION_S }]);
    tick(PUSH_JUDGE_S);
    expect(runner.view().status).toContain('Saves: 1 of 1');

    // The second push knocks the robot over: it counts as a miss and the series carries on after the reset.
    tick(PUSH_WARNING_S + 0.1);
    expect(host.pushes).toHaveLength(2);
    tick(FALL_RESET_DELAY_S + 0.1, { fallen: true });
    tick(0.1);
    expect(runner.view().status).toContain('Saves: 1 of 2');
    expect(runner.view().pendingPush?.forceN).toBe(PUSH_SERIES.g1[2].forceN);
  });

  it('counts a reset with R during a push as not saved, and moves on to the next push', () => {
    const host = new FakeHost();
    const runner = new LessonRunner(PUSH_LESSON, host);
    runner.start();
    runner.act('begin');
    let t = 0;
    const tick = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds / 0.02); i++) runner.update(state((t += 0.02), 8, 4));
    };
    tick(PUSH_WARNING_S + 0.1);
    expect(host.pushes).toHaveLength(1);
    runner.respawn();
    expect(host.messages.at(-1)).toEqual({ text: expect.stringMatching(/^Reset during the push/), tone: 'bad' });
    tick(PUSH_JUDGE_S);
    expect(runner.view().status).toContain('Saves: 0 of 1');
    expect(runner.view().pendingPush?.forceN).toBe(PUSH_SERIES.g1[1].forceN);
    // R while waiting for the next push only puts the robot back on the pad.
    runner.respawn();
    tick(PUSH_WARNING_S + PUSH_JUDGE_S);
    expect(runner.view().status).toContain('Saves: 1 of 2');
  });

  it('names the side of the robot a push hits', () => {
    expect(pushSide(0, 0)).toBe('front');
    expect(pushSide(Math.PI, 0)).toBe('behind');
    expect(pushSide(Math.PI / 2, 0)).toBe('left');
    expect(pushSide(-Math.PI / 2, 0)).toBe('right');
    expect(pushSide(Math.PI / 2, Math.PI / 2)).toBe('front');
    // A push that hits the front points backwards along the robot's heading.
    expect(Math.cos(pushDirection('front', 0.3) - 0.3)).toBeCloseTo(-1);
    expect(Math.cos(pushDirection('behind', 0.3) - 0.3)).toBeCloseTo(1);
  });

  it('sizes push-menu strengths from the measured safe pushes', () => {
    expect(pushLevelForce('g1', 'front', 0)).toBe(140);
    expect(pushLevelForce('g1', 'front', 1)).toBeLessThan(SAFE_PUSH_N.g1.front);
    expect(pushLevelForce('go2', 'left', 2)).toBeGreaterThan(SAFE_PUSH_N.go2.left);
  });
});

describe('physics lab lesson', () => {
  it('runs the ice challenge with friction fixed at 0.2 and completes it after 3 m', () => {
    const host = new FakeHost();
    host.setKnobs({ payloadKg: 12, timeScale: 0.5 });
    const runner = new LessonRunner(LAB_LESSON, host);
    runner.start();
    runner.act('start:ice');
    // Only friction changes (slow motion is kept); the robot starts from the lab spawn.
    expect(host.knobs).toEqual({ ...DEFAULT_KNOBS, friction: ICE_FRICTION, timeScale: 0.5 });
    expect(host.resets.at(-1)).toEqual(WAREHOUSE.spawns.lab);
    expect(runner.view().lab?.locked).toContain('friction');
    const lab = WAREHOUSE.spawns.lab;
    walk(runner, 0, [lab.x, lab.y], [lab.x + CHALLENGE_DISTANCE - 0.2, lab.y], 3);
    expect(runner.view().lab?.challenges[0].done).toBe(false);
    expect(runner.view().lab?.attemptProgress).toBeGreaterThan(0.9);
    walk(runner, 3, [lab.x + 2.8, lab.y], [lab.x + CHALLENGE_DISTANCE + 0.1, lab.y], 1);
    expect(runner.view().lab?.challenges[0].done).toBe(true);
    expect(runner.view().lab?.locked).toEqual([]);
  });

  it('completes the backpack challenge only at the target payload, and records the best', () => {
    const host = new FakeHost(ROBOTS.go2);
    const runner = new LessonRunner(LAB_LESSON, host);
    runner.start();
    const lab = WAREHOUSE.spawns.lab;
    const target = LAB_TARGETS.go2.payloadKg;
    host.setKnobs({ payloadKg: target - 5 });
    runner.act('start:backpack');
    walk(runner, 0, [lab.x, lab.y], [lab.x, lab.y + 3.2], 4);
    expect(runner.view().lab?.challenges[1]).toMatchObject({ done: false, best: `${(target - 5).toFixed(1)} kg` });
    host.setKnobs({ payloadKg: target + 2 });
    runner.act('start:backpack');
    walk(runner, 0, [lab.x, lab.y], [lab.x, lab.y - 3.2], 4);
    expect(runner.view().lab?.challenges[1]).toMatchObject({ done: true, best: `${(target + 2).toFixed(1)} kg` });
  });

  it('fails an attempt on a fall and explains why', () => {
    const host = new FakeHost();
    const runner = new LessonRunner(LAB_LESSON, host);
    runner.start();
    host.setKnobs({ motorStrength: 0.6 });
    runner.act('start:weak');
    runner.update(state(0.5, -8, 4, { fallen: true }));
    expect(runner.view().lab?.attemptProgress).toBeNull();
    expect(host.messages.at(-1)?.text).toMatch(/motors were too soft/);
    expect(fallReason({ ...DEFAULT_KNOBS, friction: 0.1 }, 'go2')).toMatch(/slipped/);
  });

  it('keeps the lab open after the last challenge, until the student presses Finish', () => {
    const host = new FakeHost();
    const runner = new LessonRunner(LAB_LESSON, host);
    runner.start();
    const lab = WAREHOUSE.spawns.lab;
    let t = 0;
    for (const [id, knobs] of [
      ['ice', {}],
      ['backpack', { payloadKg: LAB_TARGETS.g1.payloadKg }],
      ['weak', { motorStrength: LAB_TARGETS.g1.motorStrength }],
    ] as const) {
      host.setKnobs(knobs);
      runner.act(`start:${id}`);
      t = walk(runner, t, [lab.x, lab.y], [lab.x + 3.2, lab.y], 4);
    }
    expect(runner.view().lab?.challenges.every((c) => c.done)).toBe(true);
    expect(host.messages.at(-1)?.text).toMatch(/All three challenges done: press "Finish lab & see stars"/);
    t = walk(runner, t, [lab.x, lab.y], [lab.x, lab.y + 1], 2);
    expect(runner.result).toBeNull();
    runner.act('finish');
    runner.update(state(t + 0.02, lab.x, lab.y + 1));
    expect(runner.result?.stars).toBe(3);
  });

  it('awards one star per completed challenge when the student finishes', () => {
    const host = new FakeHost();
    const runner = new LessonRunner(LAB_LESSON, host);
    runner.start();
    runner.act('start:ice');
    walk(runner, 0, [-8, 4], [-8 + 3.1, 4], 4);
    runner.act('finish');
    // The app feeds the runner every frame (even while paused); the result shows up on the next one.
    runner.update(state(4, -4.9, 4));
    expect(runner.result?.stars).toBe(1);
    expect(runner.result?.lines[0]).toMatch(/^★ Walk on ice/);
  });
});

describe('balance geometry', () => {
  it('finds the support polygon around the contact points', () => {
    const hull = convexHull([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0.5, 0.5],
      [0.5, 0],
    ]);
    expect(hull).toHaveLength(4);
    expect(convexHull([[0, 0], [0, 0]])).toEqual([[0, 0]]);
  });

  it('measures how far the centre of mass is inside (positive) or outside (negative)', () => {
    const square = convexHull([[0, 0], [2, 0], [2, 2], [0, 2]]);
    expect(stabilityMargin([1, 1], square)).toBeCloseTo(1);
    expect(stabilityMargin([1, 0.25], square)).toBeCloseTo(0.25);
    expect(stabilityMargin([3, 1], square)).toBeCloseTo(-1);
    // Two diagonal feet (a trot) have no inside at all.
    expect(stabilityMargin([0.5, 0.5], [[0, 0], [1, 1]])).toBeCloseTo(0);
    expect(stabilityMargin([1, 0], [[0, 0], [1, 1]])).toBeLessThan(0);
    expect(stabilityMargin([0, 0], [])).toBe(-Infinity);
  });
});

/**
 * Push-series calibration with the real physics, from several start times, because where the robot is in its
 * gait when a push lands matters. A student who turns the robot so each push lands on its strong side (the
 * G1's chest, the Go2's back) saves every push but the last at every start time. A robot left alone saves the
 * four gentle pushes and never the last, and only rarely earns 3 stars (the G1 sways and turns a little while
 * marching on the spot, so a lucky start time can line pushes 5-7 up with its chest).
 */
describe.each(['g1', 'go2'] as RobotId[])('push series with the real %s', (robot) => {
  const START_TIMES = [0.5, 0.78, 1.06, 1.34, 1.62];
  let sim: Simulation;
  beforeAll(async () => {
    sim = await Simulation.create({ robot, loadFile: nodeLoadFile });
  });
  afterAll(() => sim.dispose());

  function runSeries(turnToStrongSide: boolean, startTime: number): LessonResult {
    const host: LessonHost = {
      robot: sim.robot,
      arena: sim.arena,
      get knobs() {
        return sim.knobs;
      },
      robotMassKg: 0,
      resetRobot: (spawn) => sim.reset(spawn),
      push: (f, d, t) => sim.push(f, d, t),
      setKnobs: (k) => sim.setKnobs(k),
      announce: () => {},
    };
    const runner = new LessonRunner(PUSH_LESSON, host);
    runner.start();
    while (sim.data.time < startTime) sim.stepOnce();
    runner.act('begin');
    // Turn the way a student holding Q or E would: full turn key with the usual command ramp.
    let axes: Axes = { ...ZERO_AXES };
    for (let frame = 0; frame < 20_000 && !runner.result; frame++) {
      const s = sim.getState();
      runner.update(s);
      const pending = runner.view().pendingPush;
      let turn = 0;
      if (turnToStrongSide && pending) {
        const from = pending.directionRad - Math.PI;
        const error = wrapAngle((robot === 'g1' ? from : from + Math.PI) - s.heading);
        if (Math.abs(error) > 0.1) turn = Math.sign(error);
      }
      axes = rampAxes(axes, { forward: 0, left: 0, turn }, 0.02);
      sim.setCommand(axesToCommand(axes, sim.robot.maxCommand));
      for (let i = 0; i < 10; i++) sim.stepOnce();
    }
    const result = runner.result;
    if (!result) throw new Error('push series did not finish');
    return result;
  }

  it('gives 3 stars for meeting each push on the strong side, from every start time; the last push always wins', () => {
    for (const startTime of START_TIMES) {
      const result = runSeries(true, startTime);
      expect(result.headline, `start ${startTime} s`).toBe('7 of 8 pushes saved');
      expect(result.stars).toBe(3);
      expect(result.lines[7]).toMatch(/^✗ Push 8/);
    }
  });

  it('lets a robot that just stands there survive the four gentle pushes but rarely earn 3 stars', () => {
    const stars = START_TIMES.map((startTime) => {
      const result = runSeries(false, startTime);
      expect(result.lines.slice(0, 4).every((l) => l.startsWith('✓')), `start ${startTime} s`).toBe(true);
      expect(result.lines[7]).toMatch(/^✗ Push 8/);
      return result.stars;
    });
    expect(Math.min(...stars)).toBeGreaterThanOrEqual(1);
    expect(stars.filter((s) => s === 3).length).toBeLessThanOrEqual(1);
  });
});
