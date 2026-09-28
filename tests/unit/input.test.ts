/**
 * Input mapping: keyboard scheme, gamepad sticks, touch joystick, command ramping and scaling.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RAMP,
  SLOW_FACTOR,
  ZERO_AXES,
  axesToCommand,
  combineAxes,
  deadzone,
  gamepadToAxes,
  joystickVector,
  keysToAxes,
  rampAxes,
  type Axes,
} from '../../src/input/mapping';

const keys = (...codes: string[]) => keysToAxes(new Set(codes));

describe('keyboard scheme', () => {
  it('walks forward and back with W/S and the up/down arrows', () => {
    expect(keys('KeyW')).toEqual({ forward: 1, left: 0, turn: 0 });
    expect(keys('ArrowUp').forward).toBe(1);
    expect(keys('KeyS').forward).toBe(-1);
    expect(keys('ArrowDown').forward).toBe(-1);
  });

  it('sidesteps with A/D (left is positive, like MotionCommand.vy)', () => {
    expect(keys('KeyA').left).toBe(1);
    expect(keys('KeyD').left).toBe(-1);
  });

  it('turns with Q/E and the left/right arrows (counter-clockwise is positive)', () => {
    expect(keys('KeyQ').turn).toBe(1);
    expect(keys('ArrowLeft').turn).toBe(1);
    expect(keys('KeyE').turn).toBe(-1);
    expect(keys('ArrowRight').turn).toBe(-1);
  });

  it('cancels opposite keys and does not double up duplicates', () => {
    expect(keys('KeyW', 'KeyS').forward).toBe(0);
    expect(keys('KeyW', 'ArrowUp').forward).toBe(1);
    expect(keys('KeyQ', 'KeyE').turn).toBe(0);
  });

  it('combines walking and turning at the same time', () => {
    expect(keys('KeyW', 'KeyA', 'KeyE')).toEqual({ forward: 1, left: 1, turn: -1 });
  });

  it('walks slowly while Shift is held', () => {
    expect(keys('KeyW', 'ShiftLeft').forward).toBeCloseTo(SLOW_FACTOR);
    expect(keys('ArrowLeft', 'ShiftRight').turn).toBeCloseTo(SLOW_FACTOR);
  });

  it('ignores keys that do not drive', () => {
    expect(keys('KeyZ', 'Space', 'KeyR')).toEqual(ZERO_AXES);
  });
});

describe('gamepad and touch', () => {
  it('removes stick drift with a dead zone and rescales the rest to the full range', () => {
    expect(deadzone(0.1, 0.15)).toBe(0);
    expect(deadzone(-0.15, 0.15)).toBe(0);
    expect(deadzone(1, 0.15)).toBe(1);
    expect(deadzone(-1, 0.15)).toBe(-1);
    expect(deadzone(0.575, 0.15)).toBeCloseTo(0.5);
  });

  it('maps the standard layout: left stick walks, right stick turns, up and left are negative on the API', () => {
    const a = gamepadToAxes([-1, -1, 1, 0]);
    expect(a.forward).toBeCloseTo(1);
    expect(a.left).toBeCloseTo(1);
    expect(a.turn).toBeCloseTo(-1);
    expect(gamepadToAxes([0.05, -0.1, 0.12, 0])).toEqual({ forward: 0, left: 0, turn: 0 });
    expect(gamepadToAxes([])).toEqual({ forward: 0, left: 0, turn: 0 });
  });

  it('turns a joystick drag into a vector, clamped to the rim, screen-down meaning backward', () => {
    const up = joystickVector(0, -100, 50);
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(1);
    const right = joystickVector(25, 0, 50, 0);
    expect(right.x).toBeCloseTo(0.5);
    expect(joystickVector(2, 2, 50)).toEqual({ x: 0, y: 0 });
    expect(joystickVector(0, 0, 50)).toEqual({ x: 0, y: 0 });
  });

  it('adds sources and clamps each axis', () => {
    const a: Axes = { forward: 1, left: 0.5, turn: -0.8 };
    const b: Axes = { forward: 0.7, left: -0.5, turn: -0.8 };
    expect(combineAxes(a, b)).toEqual({ forward: 1, left: 0, turn: -1 });
    expect(combineAxes()).toEqual({ forward: 0, left: 0, turn: 0 });
  });
});

describe('command ramping', () => {
  const run = (from: Axes, to: Axes, seconds: number, dt = 1 / 60) => {
    let a = from;
    for (let t = 0; t < seconds - 1e-9; t += dt) a = rampAxes(a, to, dt);
    return a;
  };
  const full: Axes = { forward: 1, left: 0, turn: 0 };

  it('reaches full speed in 1 / rise seconds, not instantly', () => {
    const riseTime = 1 / DEFAULT_RAMP.rise;
    expect(rampAxes(ZERO_AXES, full, 1 / 60).forward).toBeCloseTo(DEFAULT_RAMP.rise / 60);
    expect(run(ZERO_AXES, full, riseTime / 2).forward).toBeCloseTo(0.5, 1);
    expect(run(ZERO_AXES, full, riseTime + 0.02).forward).toBe(1);
  });

  it('brakes faster than it accelerates', () => {
    const stopTime = 1 / DEFAULT_RAMP.fall;
    expect(run(full, ZERO_AXES, stopTime / 2).forward).toBeCloseTo(0.5, 1);
    expect(run(full, ZERO_AXES, stopTime + 0.02).forward).toBe(0);
  });

  it('reverses by braking to zero first, then speeding up the other way', () => {
    const back: Axes = { forward: -1, left: 0, turn: 0 };
    let a = full;
    let crossedAt = -1;
    for (let i = 1; i <= 120; i++) {
      a = rampAxes(a, back, 1 / 60);
      if (crossedAt < 0 && a.forward <= 0) crossedAt = i / 60;
    }
    expect(crossedAt).toBeCloseTo(1 / DEFAULT_RAMP.fall, 1);
    expect(a.forward).toBe(-1);
  });

  it('never overshoots the target, even with a long frame', () => {
    expect(rampAxes(ZERO_AXES, { forward: 0.3, left: -0.2, turn: 0 }, 5)).toEqual({ forward: 0.3, left: -0.2, turn: 0 });
  });

  it('scales axes to the robot command limits', () => {
    const max = { vx: 0.8, vy: 0.4, yawRate: 1.0 };
    expect(axesToCommand({ forward: 1, left: -0.5, turn: 0.25 }, max)).toEqual({ vx: 0.8, vy: -0.2, yawRate: 0.25 });
    expect(axesToCommand({ forward: 3, left: 0, turn: -3 }, max)).toEqual({ vx: 0.8, vy: 0, yawRate: -1 });
  });
});
