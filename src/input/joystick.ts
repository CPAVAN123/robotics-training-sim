/**
 * On-screen touch joysticks: the left one walks (forward/back and sidestep), the right one turns.
 * Pointer events cover touch, pen and mouse, so they can also be tried on a laptop.
 */
import { ZERO_AXES, joystickVector, type Axes } from './mapping';

class Stick {
  readonly el: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private pointer: number | null = null;
  private center = { x: 0, y: 0 };
  value = { x: 0, y: 0 };

  constructor(label: string, className: string, private readonly horizontalOnly: boolean) {
    this.el = document.createElement('div');
    this.el.className = `joystick ${className}`;
    this.el.setAttribute('aria-hidden', 'true');
    this.knob = document.createElement('div');
    this.knob.className = 'joystick-knob';
    const caption = document.createElement('span');
    caption.className = 'joystick-label';
    caption.textContent = label;
    this.el.append(this.knob, caption);
    this.el.addEventListener('pointerdown', (e) => this.down(e));
    this.el.addEventListener('pointermove', (e) => this.move(e));
    this.el.addEventListener('pointerup', (e) => this.up(e));
    this.el.addEventListener('pointercancel', (e) => this.up(e));
  }

  private get radius(): number {
    return this.el.clientWidth / 2 - this.knob.clientWidth / 4;
  }

  private down(e: PointerEvent): void {
    if (this.pointer !== null) return;
    this.pointer = e.pointerId;
    this.el.setPointerCapture(e.pointerId);
    const r = this.el.getBoundingClientRect();
    this.center = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    this.move(e);
    e.preventDefault();
  }

  private move(e: PointerEvent): void {
    if (e.pointerId !== this.pointer) return;
    const dx = e.clientX - this.center.x;
    const dy = this.horizontalOnly ? 0 : e.clientY - this.center.y;
    const v = joystickVector(dx, dy, this.radius);
    this.value = v;
    const r = this.radius;
    this.knob.style.transform = `translate(calc(-50% + ${v.x * r}px), calc(-50% + ${-v.y * r}px))`;
  }

  private up(e: PointerEvent): void {
    if (e.pointerId !== this.pointer) return;
    this.pointer = null;
    this.value = { x: 0, y: 0 };
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  reset(): void {
    this.pointer = null;
    this.value = { x: 0, y: 0 };
    this.knob.style.transform = 'translate(-50%, -50%)';
  }
}

export class TouchJoysticks {
  readonly el: HTMLDivElement;
  private readonly move = new Stick('Walk', 'joystick-move', false);
  private readonly turn = new Stick('Turn', 'joystick-turn', true);

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'joysticks';
    this.el.append(this.move.el, this.turn.el);
  }

  axes(): Axes {
    const m = this.move.value;
    const t = this.turn.value;
    if (m.x === 0 && m.y === 0 && t.x === 0) return ZERO_AXES;
    return { forward: m.y, left: 0 - m.x, turn: 0 - t.x };
  }

  reset(): void {
    this.move.reset();
    this.turn.reset();
  }
}
