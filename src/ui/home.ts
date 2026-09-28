/**
 * Home screen: choose a robot, then a lesson. Shows the stars earned so far.
 */
import type { RobotId } from '../core/types';
import { ROBOT_FACTS } from '../lessons/content';
import { LESSONS } from '../lessons';
import type { Progress } from '../lessons/progress';
import type { LessonId } from '../lessons/types';
import { formatTime } from '../lessons/scoring';
import { ROBOTS } from '../robots/registry';
import { ICONS, h, stars, svg } from './dom';

export interface HomeHandlers {
  selectRobot(id: RobotId): void;
  startLesson(id: LessonId): void;
  openHelp(): void;
}

export class HomeScreen {
  readonly el: HTMLElement;
  private readonly robotList: HTMLDivElement;
  private readonly lessonList: HTMLOListElement;
  private readonly total: HTMLParagraphElement;
  private robot: RobotId = 'g1';
  private busy = false;

  constructor(
    private readonly progress: Progress,
    private readonly handlers: HomeHandlers,
  ) {
    this.robotList = h('div', { class: 'robot-cards', role: 'radiogroup', 'aria-labelledby': 'robot-heading' });
    this.lessonList = h('ol', { class: 'lesson-list' });
    this.total = h('p', { class: 'total-stars' });
    this.el = h(
      'main',
      { class: 'home panel', 'aria-labelledby': 'app-title' },
      h(
        'header',
        { class: 'home-header' },
        svg(ICONS.robot, 'home-logo'),
        h('div', {}, h('h1', { id: 'app-title' }, 'Robotics Training Sim'), h('p', { class: 'tagline' }, 'Drive real robot models, feel real physics.')),
      ),
      h('h2', { id: 'robot-heading' }, '1. Choose your robot'),
      this.robotList,
      h('div', { class: 'lessons-heading' }, h('h2', {}, '2. Pick a lesson'), this.total),
      this.lessonList,
      h(
        'p',
        { class: 'home-foot' },
        h('button', { class: 'link', type: 'button', onclick: () => handlers.openHelp() }, 'Controls & keyboard shortcuts'),
        ' · Physics by MuJoCo · Robot models by Unitree (BSD-3)',
      ),
    );
  }

  render(robot: RobotId, busy: boolean): void {
    this.robot = robot;
    this.busy = busy;
    const restore = this.focusedSelector();
    this.renderRobots();
    this.renderLessons();
    if (restore) (this.el.querySelector(restore) as HTMLElement | null)?.focus();
  }

  focus(): void {
    (this.robotList.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus();
  }

  /**
   * Rendering replaces the buttons, which would drop keyboard focus to the page. This names the button to
   * focus again afterwards: the selected robot card (focus follows selection in a radio group) or the
   * same lesson's Start button.
   */
  private focusedSelector(): string | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !this.el.contains(active)) return null;
    if (active.dataset.robot) return `[data-robot="${this.robot}"]`;
    if (active.dataset.lesson) return `[data-lesson="${active.dataset.lesson}"]`;
    return null;
  }

  private renderRobots(): void {
    const ids: RobotId[] = ['g1', 'go2'];
    this.robotList.replaceChildren(
      ...ids.map((id) => {
        const info = ROBOTS[id];
        const facts = ROBOT_FACTS[id];
        const selected = id === this.robot;
        const card = h(
          'button',
          {
            class: `robot-card${selected ? ' selected' : ''}`,
            type: 'button',
            role: 'radio',
            'aria-checked': selected ? 'true' : 'false',
            tabindex: selected ? 0 : -1,
            'data-robot': id,
            onclick: () => {
              if (!selected) this.handlers.selectRobot(id);
            },
            onkeydown: (e: Event) => this.radioKeys(e as KeyboardEvent, id),
          },
          h(
            'span',
            { class: 'robot-card-top' },
            svg(info.kind === 'humanoid' ? ICONS.humanoid : ICONS.quadruped, 'robot-icon'),
            h(
              'span',
              {},
              h('span', { class: 'robot-name' }, info.name),
              h('span', { class: 'robot-kind' }, facts.kindLabel),
              h('span', { class: 'robot-maker' }, `${facts.maker} · ${facts.country}`),
            ),
          ),
          h(
            'dl',
            { class: 'robot-facts' },
            h('dt', {}, 'Used for'),
            h('dd', {}, facts.usedFor),
            h('dt', {}, 'Controlled by'),
            h('dd', {}, h('strong', {}, facts.controlTitle), `: ${facts.controlLine}`),
          ),
        );
        return card;
      }),
    );
  }

  private radioKeys(e: KeyboardEvent, id: RobotId): void {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    this.handlers.selectRobot(id === 'g1' ? 'go2' : 'g1');
  }

  private renderLessons(): void {
    const total = this.progress.totalStars(this.robot);
    this.total.textContent = `★ ${total} / ${LESSONS.length * 3}`;
    this.total.setAttribute('aria-label', `${total} of ${LESSONS.length * 3} stars earned with the ${ROBOTS[this.robot].name}`);
    this.lessonList.replaceChildren(
      ...LESSONS.map((lesson, i) => {
        const record = this.progress.get(this.robot, lesson.id);
        const best =
          record?.best !== undefined
            ? `${record.bestLabel ?? 'Best'}: ${lesson.id === 'course' ? formatTime(record.best) : record.best}`
            : null;
        return h(
          'li',
          { class: 'lesson-item' },
          h('span', { class: 'lesson-number', 'aria-hidden': 'true' }, String(i + 1)),
          h(
            'div',
            { class: 'lesson-text' },
            h('h3', {}, lesson.title),
            h('p', {}, lesson.summary),
            h('p', { class: 'topics' }, ...lesson.topics.map((t) => h('span', { class: 'chip' }, t))),
          ),
          h(
            'div',
            { class: 'lesson-side' },
            stars(record?.stars ?? 0),
            best ? h('span', { class: 'best' }, best) : null,
            h(
              'button',
              {
                class: 'btn primary',
                type: 'button',
                'data-lesson': lesson.id,
                disabled: this.busy,
                'aria-label': `Start lesson ${i + 1}: ${lesson.title}`,
                onclick: () => this.handlers.startLesson(lesson.id),
              },
              svg(ICONS.play),
              'Start',
            ),
          ),
        );
      }),
    );
  }
}
