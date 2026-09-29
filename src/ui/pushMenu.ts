/**
 * Push menu (P): pick the side to push, then a strength (also keys 1, 2, 3).
 */
import type { RobotId } from '../core/types';
import { PUSH_LEVELS, pushLevelForce, type PushSide } from '../lessons/push';
import { h } from './dom';

const SIDES: { side: PushSide; label: string }[] = [
  { side: 'front', label: 'Front' },
  { side: 'left', label: 'Left' },
  { side: 'right', label: 'Right' },
  { side: 'behind', label: 'Behind' },
];

export class PushMenu {
  readonly el: HTMLElement;
  side: PushSide = 'front';
  private robot: RobotId = 'g1';
  private readonly sideButtons: HTMLButtonElement[];
  private readonly levelButtons: HTMLButtonElement[];

  constructor(private readonly onPush: (level: 0 | 1 | 2) => void, onClose: () => void) {
    this.sideButtons = SIDES.map(({ side, label }) =>
      h('button', { class: 'btn small', type: 'button', 'aria-pressed': 'false', 'data-side': side, onclick: () => this.setSide(side) }, label),
    );
    this.levelButtons = PUSH_LEVELS.map((_, i) =>
      h('button', { class: 'btn small push-level', type: 'button', onclick: () => this.onPush(i as 0 | 1 | 2) }),
    );
    this.el = h(
      'section',
      { class: 'push-menu panel', 'aria-label': 'Push the robot', hidden: true },
      h('div', { class: 'push-head' }, h('h2', {}, 'Push the robot'), h('button', { class: 'tool', type: 'button', 'aria-label': 'Close push menu', onclick: onClose }, '×')),
      h('p', { class: 'hint' }, 'Push it on its…'),
      h('div', { class: 'side-grid', role: 'group', 'aria-label': 'Side to push' }, ...this.sideButtons),
      h('p', { class: 'hint' }, 'Strength (or keys 1, 2, 3) for 0.1 s:'),
      h('div', { class: 'level-row' }, ...this.levelButtons),
    );
    this.setSide('front');
  }

  setRobot(robot: RobotId): void {
    this.robot = robot;
    this.refresh();
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  toggle(open = !this.open): void {
    this.el.hidden = !open;
    if (open) this.sideButtons.find((b) => b.dataset.side === this.side)?.focus();
  }

  force(level: 0 | 1 | 2): number {
    return pushLevelForce(this.robot, this.side, level);
  }

  private setSide(side: PushSide): void {
    this.side = side;
    for (const b of this.sideButtons) b.setAttribute('aria-pressed', String(b.dataset.side === side));
    this.refresh();
  }

  private refresh(): void {
    this.levelButtons.forEach((b, i) => {
      b.textContent = `${i + 1} · ${PUSH_LEVELS[i].name} ${this.force(i as 0 | 1 | 2)} N`;
    });
  }
}
