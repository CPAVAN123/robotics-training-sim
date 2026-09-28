/**
 * Modal dialogs (native <dialog>: focus is trapped and Esc closes them): Explain + glossary,
 * controls help, and the lesson result.
 */
import type { RobotInfo } from '../core/types';
import { GLOSSARY } from '../lessons/content';
import type { LessonDef, LessonResult } from '../lessons/types';
import { ICONS, append, h, stars, svg } from './dom';

abstract class Modal {
  readonly el: HTMLDialogElement;
  protected readonly body: HTMLElement;
  private readonly heading: HTMLElement;
  onClose: () => void = () => {};

  constructor(className: string, title: string) {
    const id = `${className}-title`;
    this.heading = h('h2', { id }, title);
    this.body = h('div', { class: 'dialog-body' });
    this.el = h(
      'dialog',
      { class: `dialog ${className}`, 'aria-labelledby': id },
      h(
        'div',
        { class: 'dialog-head' },
        this.heading,
        h('button', { class: 'tool', type: 'button', 'aria-label': 'Close', onclick: () => this.close() }, svg(ICONS.close)),
      ),
      this.body,
    );
    this.el.addEventListener('close', () => this.onClose());
    // Clicking the dimmed backdrop closes the dialog.
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
  }

  get isOpen(): boolean {
    return this.el.open;
  }

  protected setTitle(text: string): void {
    this.heading.textContent = text;
  }

  show(): void {
    if (!this.el.open) this.el.showModal();
  }

  close(): void {
    if (this.el.open) this.el.close();
  }
}

export class ExplainDialog extends Modal {
  private readonly tabs: HTMLButtonElement[];
  private readonly panels: HTMLElement[];

  constructor() {
    super('explain', 'Explain');
    const lessonPanel = h('div', { class: 'tab-panel', role: 'tabpanel', id: 'explain-lesson', 'aria-labelledby': 'tab-lesson' });
    const glossaryPanel = h(
      'div',
      { class: 'tab-panel', role: 'tabpanel', id: 'explain-glossary', 'aria-labelledby': 'tab-glossary', hidden: true },
      h('dl', { class: 'glossary' }, ...GLOSSARY.flatMap((g) => [h('dt', {}, g.term), h('dd', {}, g.definition)])),
    );
    this.panels = [lessonPanel, glossaryPanel];
    this.tabs = [
      h('button', { class: 'tab', role: 'tab', id: 'tab-lesson', type: 'button', 'aria-controls': 'explain-lesson', 'aria-selected': 'true' }, 'This lesson'),
      h('button', { class: 'tab', role: 'tab', id: 'tab-glossary', type: 'button', 'aria-controls': 'explain-glossary', 'aria-selected': 'false', tabindex: -1 }, 'Glossary'),
    ];
    this.tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => this.select(i));
      tab.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        this.select(1 - i);
        this.tabs[1 - i].focus();
      });
    });
    this.body.append(h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Explanations' }, ...this.tabs), ...this.panels);
  }

  open(lesson: LessonDef, robot: RobotInfo): void {
    this.setTitle(`Explain: ${lesson.title}`);
    this.panels[0].replaceChildren(
      ...lesson.explain(robot).map((section) => h('section', {}, h('h3', {}, section.title), ...section.paragraphs.map((p) => h('p', {}, p)))),
    );
    this.select(0);
    this.show();
  }

  private select(index: number): void {
    this.tabs.forEach((t, i) => {
      t.setAttribute('aria-selected', String(i === index));
      t.tabIndex = i === index ? 0 : -1;
      this.panels[i].hidden = i !== index;
    });
  }
}

const KEYS: [string, string][] = [
  ['W / ↑', 'Walk forward'],
  ['S / ↓', 'Walk backward'],
  ['A / D', 'Sidestep left / right'],
  ['Q / E  or  ← / →', 'Turn left / right'],
  ['Shift (hold)', 'Walk slowly and carefully'],
  ['Space', 'Pause / resume'],
  ['R', 'Reset the robot'],
  ['P', 'Push menu'],
  ['1 / 2 / 3', 'Push: nudge / shove / huge'],
  ['B', 'Balance view (centre of mass)'],
  ['C', 'Chase camera on / off'],
  ['X', 'Explain panel'],
  ['H or ?', 'This help'],
  ['Esc', 'Close a panel'],
];

export class HelpDialog extends Modal {
  constructor() {
    super('help', 'Controls');
    this.body.append(
      h('h3', {}, 'Keyboard'),
      h('table', { class: 'keys' }, h('tbody', {}, ...KEYS.map(([k, v]) => h('tr', {}, h('th', { scope: 'row' }, h('kbd', {}, k)), h('td', {}, v))))),
      h('h3', {}, 'Mouse and touch'),
      h('p', {}, 'Drag to look around, scroll or pinch to zoom, right-drag or two-finger drag to pan. On a touch screen, the left joystick walks and the right one turns.'),
      h('h3', {}, 'Gamepad'),
      h(
        'p',
        {},
        'Left stick walks and sidesteps, right stick turns. Start pauses, Back/Select resets. Works with controllers ' +
          'your browser reports as standard layout, such as most Xbox and PlayStation controllers.',
      ),
    );
  }
}

export interface ResultActions {
  retry(): void;
  next(): void;
  home(): void;
}

export class ResultDialog extends Modal {
  constructor(private readonly actions: ResultActions) {
    super('result', 'Result');
  }

  open(lesson: LessonDef, result: LessonResult, improved: { moreStars: boolean; newBest: boolean }, hasNext: boolean): void {
    this.setTitle(lesson.title);
    const buttons = [
      h('button', { class: 'btn', type: 'button', onclick: () => this.pick(this.actions.retry) }, 'Try again'),
      hasNext ? h('button', { class: 'btn primary', type: 'button', onclick: () => this.pick(this.actions.next) }, 'Next lesson →') : null,
      h('button', { class: `btn${hasNext ? '' : ' primary'}`, type: 'button', onclick: () => this.pick(this.actions.home) }, 'All lessons'),
    ];
    const badges = [
      improved.moreStars ? h('span', { class: 'badge good' }, 'New star record!') : null,
      improved.newBest ? h('span', { class: 'badge good' }, 'New personal best!') : null,
    ].filter((b) => b !== null);
    this.body.replaceChildren();
    append(
      this.body,
      h('div', { class: 'result-stars' }, stars(result.stars)),
      h('p', { class: 'result-headline' }, result.headline),
      badges.length ? h('p', { class: 'badges' }, ...badges) : null,
      h('ul', { class: 'result-lines' }, ...result.lines.map((l) => h('li', {}, l))),
      h('div', { class: 'card-actions' }, ...buttons),
    );
    this.show();
    const primary = this.body.querySelector<HTMLElement>('.btn.primary');
    primary?.focus();
  }

  private pick(action: () => void): void {
    this.onClose = () => {};
    this.close();
    action();
  }
}
