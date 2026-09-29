/**
 * The in-lesson interface: top bar (goal, timer, tools), the lesson card (tour steps, quiz, prompts)
 * and the feedback toast, which doubles as the aria-live region for screen readers.
 */
import type { LessonCard, LessonDef, LessonView, Tone } from '../lessons/types';
import { formatTime } from '../lessons/scoring';
import { ICONS, append, h, setText, svg } from './dom';

export interface LessonScreenHandlers {
  exit(): void;
  act(actionId: string): void;
  explain(): void;
  help(): void;
  handbook(): void;
  togglePause(): void;
  reset(): void;
  togglePushMenu(): void;
  toggleBalance(): void;
  toggleCamera(): void;
  toggleDemo(): void;
}

const TOAST_S = 5;
const CARD_BODY_ID = 'lesson-card-body';

export class LessonScreen {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly goal: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly status: HTMLElement;
  /** The top bar and the lesson card; the app keeps the robot clear of both. */
  readonly topbar: HTMLElement;
  readonly cardBox: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly live: HTMLElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly balanceBtn: HTMLButtonElement;
  private readonly cameraBtn: HTMLButtonElement;
  private readonly demoBtn: HTMLButtonElement;
  private readonly pausedBadge: HTMLElement;
  private cardKey = '';
  private toastTimer = 0;
  private shownPaused: boolean | null = null;
  private focusCard = false;

  constructor(private readonly handlers: LessonScreenHandlers) {
    const tool = (label: string, icon: string, onclick: () => void, key?: string) =>
      h(
        'button',
        { class: 'tool', type: 'button', onclick, title: key ? `${label} (${key})` : label, 'aria-keyshortcuts': key },
        svg(icon),
        h('span', { class: 'tool-label' }, label),
      );
    this.title = h('span', { class: 'lesson-title' });
    this.goal = h('p', { class: 'goal', id: 'lesson-goal' });
    this.timer = h('span', { class: 'timer', role: 'timer', 'aria-label': 'Lesson time' });
    this.status = h('ul', { class: 'status-chips', 'aria-label': 'Lesson status' });
    this.pauseBtn = tool('Pause', ICONS.pause, () => handlers.togglePause(), 'Space');
    this.balanceBtn = tool('Balance', ICONS.balance, () => handlers.toggleBalance(), 'B');
    this.cameraBtn = tool('Chase cam', ICONS.camera, () => handlers.toggleCamera(), 'C');
    this.demoBtn = tool('Watch demo', ICONS.robot, () => handlers.toggleDemo());
    this.demoBtn.hidden = true;
    this.pausedBadge = h('div', { class: 'paused-badge', hidden: true }, 'Paused: press Space to continue');

    this.topbar = h(
      'header',
      { class: 'topbar panel' },
      h(
        'button',
        { class: 'tool home-btn', type: 'button', onclick: () => handlers.exit(), title: 'Back to lessons', 'aria-label': 'Back to lessons' },
        svg(ICONS.home),
      ),
      h('div', { class: 'goal-box' }, this.title, this.goal),
      this.timer,
      h(
        'nav',
        { class: 'tools', 'aria-label': 'Simulation tools' },
        tool('Explain', ICONS.book, () => handlers.explain(), 'X'),
        this.pauseBtn,
        tool('Reset', ICONS.reset, () => handlers.reset(), 'R'),
        tool('Push', ICONS.push, () => handlers.togglePushMenu(), 'P'),
        this.balanceBtn,
        this.cameraBtn,
        this.demoBtn,
        tool('Handbook', ICONS.info, () => handlers.handbook(), 'I'),
        tool('Controls', ICONS.keyboard, () => handlers.help(), 'H'),
      ),
    );
    this.cardBox = h('section', { class: 'lesson-card panel', 'aria-label': 'Lesson', hidden: true });
    // Holding Enter repeats it: never let one long press click through several cards or pick a quiz answer.
    this.cardBox.addEventListener('keydown', (e) => {
      if (e.repeat && e.key === 'Enter') e.preventDefault();
    });
    this.live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    this.toast = h('div', { class: 'toast', 'aria-hidden': 'true' });
    this.el = h(
      'main',
      { class: 'lesson-screen', tabindex: -1, 'aria-labelledby': 'lesson-goal' },
      this.topbar,
      this.status,
      this.cardBox,
      this.toast,
      this.live,
      this.pausedBadge,
    );
  }

  /** Moves keyboard focus into the lesson: onto the card's main button once it appears, else the screen. */
  focus(): void {
    this.focusCard = true;
    this.el.focus({ preventScroll: true });
  }

  setLesson(def: LessonDef, robotName: string): void {
    setText(this.title, `${def.title} · ${robotName}`);
    this.cardKey = '';
    this.cardBox.hidden = true;
    this.toast.classList.remove('show');
  }

  update(view: LessonView, dt: number, state: { paused: boolean; balance: boolean; chase: boolean }): void {
    setText(this.goal, view.goal);
    this.timer.hidden = view.timer === null;
    if (view.timer !== null) setText(this.timer, formatTime(view.timer));
    const statusText = view.status.join('|');
    if (this.status.dataset.text !== statusText) {
      this.status.dataset.text = statusText;
      this.status.replaceChildren(...view.status.map((s) => h('li', { class: 'chip' }, s)));
    }
    this.renderCard(view.card);
    this.demoBtn.hidden = !view.demo.available;
    this.demoBtn.setAttribute('aria-pressed', String(view.demo.running));
    setText(this.demoBtn.querySelector('.tool-label') as HTMLElement, view.demo.running ? 'Stop demo' : 'Watch demo');
    if (this.shownPaused !== state.paused) {
      this.shownPaused = state.paused;
      this.pauseBtn.setAttribute('aria-pressed', String(state.paused));
      this.pauseBtn.querySelector('svg')?.replaceWith(svg(state.paused ? ICONS.play : ICONS.pause));
      setText(this.pauseBtn.querySelector('.tool-label') as HTMLElement, state.paused ? 'Resume' : 'Pause');
    }
    this.balanceBtn.setAttribute('aria-pressed', String(state.balance));
    this.cameraBtn.setAttribute('aria-pressed', String(state.chase));
    this.pausedBadge.hidden = !state.paused;

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('show');
    }
  }

  announce(text: string, tone: Tone = 'info'): void {
    this.toast.textContent = text;
    this.toast.className = `toast show ${tone}`;
    this.toastTimer = TOAST_S;
    // Re-set the live region so repeated identical messages are still read out.
    this.live.textContent = '';
    queueMicrotask(() => (this.live.textContent = text));
  }

  private renderCard(card: LessonCard | null): void {
    const key = card ? JSON.stringify(card) : '';
    if (key === this.cardKey) return;
    const hadFocus = this.cardBox.contains(document.activeElement) || this.focusCard;
    this.focusCard = false;
    this.cardKey = key;
    this.cardBox.hidden = !card;
    if (!card) {
      this.cardBox.replaceChildren();
      return;
    }
    // Buttons and the heading are described by the card's text, so a screen reader reads the new card
    // when focus moves onto it.
    const described = { 'aria-describedby': CARD_BODY_ID };
    const actions = card.actions.map((a) =>
      h(
        'button',
        { class: `btn${a.primary ? ' primary' : ''}`, type: 'button', 'data-action': a.id, onclick: () => this.handlers.act(a.id), ...described },
        a.label,
      ),
    );
    const heading = h('h2', { tabindex: -1, ...described }, card.title);
    this.cardBox.replaceChildren();
    append(
      this.cardBox,
      heading,
      h('div', { class: 'card-body', id: CARD_BODY_ID }, ...card.body.map((p) => h('p', {}, p))),
      actions.length ? h('div', { class: 'card-actions' }, ...actions) : null,
    );
    // Keep keyboard users in the flow: when the card they were using changes, focus its main button. A card
    // without one (the quiz) focuses its heading, so an extra Enter can't pick the first answer.
    const primary = actions.find((b) => b.classList.contains('primary'));
    if (hadFocus) (primary ?? heading).focus();
  }
}
