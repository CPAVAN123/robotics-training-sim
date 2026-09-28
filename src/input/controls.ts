/**
 * Combines keyboard, gamepad and touch joysticks into one smoothly ramped MotionCommand.
 */
import type { MotionCommand } from '../core/types';
import { GamepadInput } from './gamepad';
import { Keyboard, type KeyAction } from './keyboard';
import { TouchJoysticks } from './joystick';
import { ZERO_AXES, axesToCommand, combineAxes, keysToAxes, rampAxes, type Axes } from './mapping';

export class Controls {
  readonly keyboard: Keyboard;
  readonly gamepad: GamepadInput;
  readonly joysticks = new TouchJoysticks();
  private axes: Axes = { ...ZERO_AXES };

  constructor(onAction: (action: KeyAction) => void) {
    this.keyboard = new Keyboard(onAction);
    this.gamepad = new GamepadInput(onAction);
  }

  /**
   * The ramped command for this frame. `dt` is the simulated time the command will act for, so the ramp
   * takes the same simulated time in slow motion and stands still while the simulation is paused.
   */
  update(dt: number, max: MotionCommand): MotionCommand {
    const target = combineAxes(keysToAxes(this.keyboard.held), this.gamepad.poll(), this.joysticks.axes());
    this.axes = rampAxes(this.axes, target, Math.min(dt, 0.1));
    return axesToCommand(this.axes, max);
  }

  /** Forget held input (after a reset, when a dialog opens, or when switching lessons). */
  clear(): void {
    this.keyboard.held.clear();
    this.joysticks.reset();
    this.axes = { ...ZERO_AXES };
  }
}
