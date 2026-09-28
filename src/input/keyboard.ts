/**
 * Keyboard: tracks held driving keys and turns single presses into app actions.
 */
import { DRIVE_KEYS } from './mapping';

export type KeyAction = 'pause' | 'reset' | 'pushMenu' | 'push1' | 'push2' | 'push3' | 'help' | 'balance' | 'camera' | 'explain';

/** Action keys by KeyboardEvent.code. */
export const ACTION_KEYS: Record<string, KeyAction> = {
  Space: 'pause',
  KeyR: 'reset',
  KeyP: 'pushMenu',
  Digit1: 'push1',
  Digit2: 'push2',
  Digit3: 'push3',
  Numpad1: 'push1',
  Numpad2: 'push2',
  Numpad3: 'push3',
  KeyH: 'help',
  Slash: 'help',
  KeyB: 'balance',
  KeyC: 'camera',
  KeyX: 'explain',
};

/** Elements that use the keyboard themselves; action keys are left to them. */
function ownsKeys(target: EventTarget | null, code: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    // Sliders use the arrow keys; letters still drive the robot.
    return target.type !== 'range' || code.startsWith('Arrow') || code === 'Home' || code === 'End' || code.startsWith('Page');
  }
  // Buttons and links are pressed with Space and Enter.
  return (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) && (code === 'Space' || code === 'Enter');
}

export class Keyboard {
  readonly held = new Set<string>();

  constructor(private readonly onAction: (action: KeyAction) => void) {
    const release = () => this.held.clear();
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', release);
  }

  private keyDown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (ownsKeys(e.target, e.code)) return;
    if (DRIVE_KEYS.has(e.code) || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      this.held.add(e.code);
      if (e.code.startsWith('Arrow')) e.preventDefault();
      return;
    }
    const action = ACTION_KEYS[e.code] ?? (e.key === '?' ? 'help' : undefined);
    if (!action || e.repeat) return;
    e.preventDefault();
    this.onAction(action);
  }
}
