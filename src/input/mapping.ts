/**
 * Pure input mapping: keys, gamepad sticks and the touch joystick all become "axes" in -1..1,
 * which are smoothed (ramped) and then scaled to the robot's safe command range.
 */
import type { MotionCommand } from '../core/types';

/** Normalised driving intent: forward (+) / back (-), left (+) / right (-), turn left (+) / right (-). */
export interface Axes {
  forward: number;
  left: number;
  turn: number;
}

export const ZERO_AXES: Readonly<Axes> = Object.freeze({ forward: 0, left: 0, turn: 0 });

/**
 * Keyboard scheme (KeyboardEvent.code, so it follows key positions on any keyboard layout):
 * W/S or Up/Down walk forward/back, A/D sidestep, Q/E or Left/Right turn.
 */
export const KEY_BINDINGS: Record<keyof Axes, { plus: readonly string[]; minus: readonly string[] }> = {
  forward: { plus: ['KeyW', 'ArrowUp'], minus: ['KeyS', 'ArrowDown'] },
  left: { plus: ['KeyA'], minus: ['KeyD'] },
  turn: { plus: ['KeyQ', 'ArrowLeft'], minus: ['KeyE', 'ArrowRight'] },
};

/** Every key code that drives the robot (used to stop the page scrolling on arrow keys). */
export const DRIVE_KEYS: ReadonlySet<string> = new Set(
  Object.values(KEY_BINDINGS).flatMap((b) => [...b.plus, ...b.minus]),
);

/** Held Shift walks slowly, for careful moves on ramps and through gaps. */
export const SLOW_FACTOR = 0.4;

export function keysToAxes(held: ReadonlySet<string>): Axes {
  const axis = (name: keyof Axes) => {
    const { plus, minus } = KEY_BINDINGS[name];
    return (plus.some((k) => held.has(k)) ? 1 : 0) - (minus.some((k) => held.has(k)) ? 1 : 0);
  };
  const scale = held.has('ShiftLeft') || held.has('ShiftRight') ? SLOW_FACTOR : 1;
  return { forward: axis('forward') * scale, left: axis('left') * scale, turn: axis('turn') * scale };
}

/**
 * Removes stick drift: values inside the dead zone become 0 and the rest is rescaled so the
 * output still spans the full 0..1 range.
 */
export function deadzone(value: number, zone: number): number {
  const mag = Math.abs(value);
  if (mag <= zone) return 0;
  return Math.sign(value) * Math.min(1, (mag - zone) / (1 - zone));
}

/**
 * Standard-mapping gamepad: left stick walks (up = forward, sideways = sidestep), right stick
 * turns. Stick "up" and "left" are negative on the Gamepad API, so they are flipped here.
 */
export function gamepadToAxes(axes: readonly number[], zone = 0.15): Axes {
  return {
    forward: 0 - deadzone(axes[1] ?? 0, zone),
    left: 0 - deadzone(axes[0] ?? 0, zone),
    turn: 0 - deadzone(axes[2] ?? 0, zone),
  };
}

/** Adds several sources (keyboard + gamepad + touch) and clamps each axis to -1..1. */
export function combineAxes(...sources: Axes[]): Axes {
  const sum = { forward: 0, left: 0, turn: 0 };
  for (const s of sources) {
    sum.forward += s.forward;
    sum.left += s.left;
    sum.turn += s.turn;
  }
  return { forward: clamp1(sum.forward), left: clamp1(sum.left), turn: clamp1(sum.turn) };
}

/** How fast the ramped command may change, in full-scale units per second. */
export interface RampRates {
  /** Speeding up (moving away from zero). */
  rise: number;
  /** Slowing down (moving toward zero, including the first half of a reversal). */
  fall: number;
}

/** Full speed after 0.5 s, stop within 0.25 s: gentle enough for the walking policy, snappy to drive. */
export const DEFAULT_RAMP: RampRates = { rise: 2, fall: 4 };

/**
 * Moves `current` toward `target` by at most rate·dt per axis. Sudden jumps in the command are
 * hard on a walking robot (like a person told to sprint from a standstill), so we ease in.
 */
export function rampAxes(current: Axes, target: Axes, dt: number, rates: RampRates = DEFAULT_RAMP): Axes {
  const step = (c: number, t: number) => {
    if (c === t) return t;
    // Slowing down uses the faster rate; a reversal first brakes to 0, then speeds up the other way.
    const reversing = c !== 0 && Math.sign(t) !== Math.sign(c);
    const braking = reversing || Math.abs(t) < Math.abs(c);
    const goal = reversing ? 0 : t;
    return c + Math.sign(goal - c) * Math.min(Math.abs(goal - c), (braking ? rates.fall : rates.rise) * dt);
  };
  return {
    forward: step(current.forward, target.forward),
    left: step(current.left, target.left),
    turn: step(current.turn, target.turn),
  };
}

/** Scales axes to the robot's command limits. */
export function axesToCommand(axes: Axes, max: MotionCommand): MotionCommand {
  return {
    vx: clamp1(axes.forward) * max.vx,
    vy: clamp1(axes.left) * max.vy,
    yawRate: clamp1(axes.turn) * max.yawRate,
  };
}

/**
 * Touch joystick knob offset (pixels from centre, screen y down) to a -1..1 vector, with the
 * knob limited to `radius` and a small dead zone in the middle.
 */
export function joystickVector(dx: number, dy: number, radius: number, zone = 0.12): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: 0, y: 0 };
  const mag = deadzone(Math.min(1, len / radius), zone);
  if (mag === 0) return { x: 0, y: 0 };
  return { x: (dx / len) * mag, y: (-dy / len) * mag };
}

function clamp1(v: number): number {
  return Math.max(-1, Math.min(1, v));
}
