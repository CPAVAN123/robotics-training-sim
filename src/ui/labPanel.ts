/**
 * Physics lab panel: knob sliders, a live "what changed and why" explanation and the challenge list.
 */
import { DEFAULT_KNOBS, type PhysicsKnobs } from '../core/types';
import type { KnobKey, LabView } from '../lessons/types';
import { h, setText } from './dom';

interface KnobSpec {
  key: KnobKey;
  label: string;
  min: number;
  max: number;
  step: number;
  format(v: number): string;
}

export const KNOB_SPECS: KnobSpec[] = [
  { key: 'friction', label: 'Friction μ', min: 0.05, max: 1.5, step: 0.05, format: (v) => v.toFixed(2) },
  { key: 'payloadKg', label: 'Backpack', min: 0, max: 40, step: 1, format: (v) => `${v.toFixed(0)} kg` },
  { key: 'motorStrength', label: 'Motors', min: 0.1, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'sensorNoise', label: 'Sensor noise', min: 0, max: 5, step: 0.25, format: (v) => `× ${v.toFixed(2)}` },
  { key: 'timeScale', label: 'Slow motion', min: 0.1, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
];

export interface LabHandlers {
  setKnob(key: KnobKey, value: number): void;
  resetKnobs(): void;
  act(actionId: string): void;
}

export class LabPanel {
  readonly el: HTMLElement;
  private readonly inputs = new Map<KnobKey, { input: HTMLInputElement; output: HTMLOutputElement; row: HTMLElement }>();
  private readonly explainTitle: HTMLElement;
  private readonly explainBody: HTMLElement;
  private readonly challenges: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly resetBtn: HTMLButtonElement;
  private challengeKey = '';

  constructor(private readonly handlers: LabHandlers) {
    const knobs = h('div', { class: 'knobs' });
    for (const spec of KNOB_SPECS) {
      const id = `knob-${spec.key}`;
      const input = h('input', {
        id,
        type: 'range',
        min: spec.min,
        max: spec.max,
        step: spec.step,
        value: DEFAULT_KNOBS[spec.key],
        oninput: () => handlers.setKnob(spec.key, Number(input.value)),
      });
      const output = h('output', { for: id }, spec.format(DEFAULT_KNOBS[spec.key]));
      const row = h('div', { class: 'knob' }, h('label', { for: id }, spec.label), input, output);
      knobs.append(row);
      this.inputs.set(spec.key, { input, output, row });
    }
    this.resetBtn = h('button', { class: 'btn small', type: 'button', onclick: () => handlers.resetKnobs() }, 'Normal physics');
    this.explainTitle = h('h3', {});
    this.explainBody = h('div', { class: 'explain-live', 'aria-live': 'polite' });
    this.challenges = h('ol', { class: 'challenges' });
    this.progressFill = h('span', { class: 'progress-fill' });
    this.progress = h('div', { class: 'progress attempt', role: 'progressbar', 'aria-label': 'Distance walked', 'aria-valuemin': 0, 'aria-valuemax': 100, hidden: true }, this.progressFill);
    this.el = h(
      'section',
      { class: 'lab panel', 'aria-label': 'Physics lab' },
      h('div', { class: 'lab-head' }, h('h2', {}, 'Physics knobs'), this.resetBtn),
      knobs,
      h('div', { class: 'what-changed' }, this.explainTitle, this.explainBody),
      h(
        'div',
        { class: 'lab-head' },
        h('h2', {}, 'Challenges'),
        h('button', { class: 'btn small', type: 'button', onclick: () => handlers.act('finish') }, 'Finish lab & see stars'),
      ),
      this.progress,
      this.challenges,
    );
  }

  update(view: LabView, knobs: PhysicsKnobs): void {
    for (const spec of KNOB_SPECS) {
      const k = this.inputs.get(spec.key);
      if (!k) continue;
      const locked = view.locked.includes(spec.key);
      if (k.input.disabled !== locked) {
        k.input.disabled = locked;
        k.row.classList.toggle('locked', locked);
        k.row.title = locked ? 'Fixed while a challenge is running' : '';
      }
      const value = knobs[spec.key];
      if (document.activeElement !== k.input && Number(k.input.value) !== value) k.input.value = String(value);
      setText(k.output, spec.format(value));
    }
    this.resetBtn.disabled = view.locked.length > 0;
    setText(this.explainTitle, view.explanation.title);
    const body = view.explanation.lines.join('\n');
    if (this.explainBody.dataset.text !== body) {
      this.explainBody.dataset.text = body;
      this.explainBody.replaceChildren(...view.explanation.lines.map((l) => h('p', {}, l)));
    }
    this.progress.hidden = view.attemptProgress === null;
    if (view.attemptProgress !== null) {
      const pct = Math.round(view.attemptProgress * 100);
      this.progressFill.style.width = `${pct}%`;
      this.progress.setAttribute('aria-valuenow', String(pct));
    }
    this.renderChallenges(view);
  }

  private renderChallenges(view: LabView): void {
    const key = JSON.stringify(view.challenges);
    if (key === this.challengeKey) return;
    const focusedAction = (document.activeElement as HTMLElement | null)?.dataset.action;
    this.challengeKey = key;
    const running = view.challenges.some((c) => c.active);
    this.challenges.replaceChildren(
      ...view.challenges.map((c) => {
        const action = c.active ? 'cancel' : `start:${c.id}`;
        return h(
          'li',
          { class: `challenge${c.done ? ' done' : ''}${c.active ? ' active' : ''}` },
          h('div', {}, h('h3', {}, c.done ? `✓ ${c.title}` : c.title), h('p', {}, c.description), c.best ? h('p', { class: 'best' }, `Best: ${c.best}`) : null),
          h(
            'button',
            {
              class: `btn small${c.active ? '' : ' primary'}`,
              type: 'button',
              'data-action': action,
              disabled: running && !c.active,
              'aria-label': c.active ? `Cancel ${c.title}` : `Start ${c.title}`,
              onclick: () => this.handlers.act(action),
            },
            c.active ? 'Cancel' : c.done ? 'Again' : 'Start',
          ),
        );
      }),
    );
    if (focusedAction) {
      const same = this.challenges.querySelector<HTMLElement>(`[data-action="${focusedAction}"]`);
      const fallback = this.challenges.querySelector<HTMLElement>('button:not([disabled])');
      (same && !same.hasAttribute('disabled') ? same : fallback)?.focus();
    }
  }
}
