/**
 * Gamepad API polling (standard mapping): sticks drive, Start pauses, Back/Select resets.
 */
import { ZERO_AXES, gamepadToAxes, type Axes } from './mapping';
import type { KeyAction } from './keyboard';

const BUTTON_ACTIONS: Record<number, KeyAction> = { 9: 'pause', 8: 'reset' };

export class GamepadInput {
  private pressed = new Set<number>();

  constructor(private readonly onAction: (action: KeyAction) => void) {}

  /** Reads the first connected standard-layout pad; call once per frame. */
  poll(): Axes {
    const pad = firstStandardPad();
    if (!pad) {
      this.pressed.clear();
      return ZERO_AXES;
    }
    for (const [index, action] of Object.entries(BUTTON_ACTIONS)) {
      const i = Number(index);
      const down = pad.buttons[i]?.pressed ?? false;
      if (down && !this.pressed.has(i)) this.onAction(action);
      if (down) this.pressed.add(i);
      else this.pressed.delete(i);
    }
    return gamepadToAxes(pad.axes);
  }
}

/**
 * Only pads the browser reports with the standard layout are used: on other layouts axis 2 can be a
 * trigger resting at -1, which would read as a constant full turn.
 */
function firstStandardPad(): Gamepad | null {
  if (typeof navigator.getGamepads !== 'function') return null;
  let pads: (Gamepad | null)[];
  try {
    pads = navigator.getGamepads();
  } catch {
    // SecurityError where the page's Permissions Policy disallows gamepads.
    return null;
  }
  return pads.find((p): p is Gamepad => !!p && p.connected && p.mapping === 'standard') ?? null;
}
