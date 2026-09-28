/**
 * Start-up checks and the loading overlay (real download progress, friendly errors).
 */
import { h, setText, svg, ICONS } from './dom';

export interface SupportProblem {
  title: string;
  message: string;
}

/** Everything the simulator needs from the browser. */
export function checkSupport(): SupportProblem | null {
  if (typeof WebAssembly !== 'object' || typeof WebAssembly.instantiate !== 'function') {
    return {
      title: 'This browser can\'t run the physics engine',
      message:
        'The simulator needs WebAssembly, which this browser has turned off or does not support. Try an up-to-date ' +
        'Chrome, Edge, Firefox or Safari. On a school device, your IT team may need to allow WebAssembly.',
    };
  }
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (!gl) {
    return {
      title: 'This browser can\'t show 3D graphics',
      message:
        'The simulator needs WebGL for its 3D view. Try an up-to-date Chrome, Edge, Firefox or Safari, and check that ' +
        '"Use graphics acceleration" (hardware acceleration) is switched on in the browser settings.',
    };
  }
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return null;
}

export class LoadingOverlay {
  readonly el: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private readonly detail: HTMLParagraphElement;
  private readonly bar: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly actions: HTMLDivElement;

  constructor() {
    this.title = h('h1', { id: 'loading-title' }, 'Robotics Training Sim');
    this.detail = h('p', { class: 'loading-detail' }, 'Starting…');
    this.fill = h('div', { class: 'progress-fill' });
    this.bar = h(
      'div',
      { class: 'progress indeterminate', role: 'progressbar', 'aria-labelledby': 'loading-title', 'aria-valuemin': 0, 'aria-valuemax': 100 },
      this.fill,
    );
    this.actions = h('div', { class: 'loading-actions' });
    this.el = h(
      'div',
      { class: 'loading', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'loading-title' },
      h('div', { class: 'loading-card' }, svg(ICONS.robot, 'loading-logo'), this.title, this.detail, this.bar, this.actions),
    );
  }

  show(title: string): void {
    setText(this.title, title);
    this.el.classList.remove('hidden', 'error');
    this.actions.replaceChildren();
    this.bar.hidden = false;
    this.stage('Starting the physics engine…', null);
  }

  /** `fraction` null = unknown (animated bar). */
  stage(text: string, fraction: number | null): void {
    setText(this.detail, text);
    this.bar.classList.toggle('indeterminate', fraction === null);
    if (fraction === null) {
      this.bar.removeAttribute('aria-valuenow');
      this.fill.style.width = '';
    } else {
      const pct = Math.round(fraction * 100);
      this.bar.setAttribute('aria-valuenow', String(pct));
      this.fill.style.width = `${pct}%`;
    }
  }

  error(problem: SupportProblem, retry?: () => void): void {
    this.el.classList.remove('hidden');
    this.el.classList.add('error');
    this.el.setAttribute('role', 'alertdialog');
    setText(this.title, problem.title);
    setText(this.detail, problem.message);
    this.bar.hidden = true;
    this.actions.replaceChildren();
    if (retry) {
      const button = h('button', { class: 'btn primary', type: 'button', onclick: () => retry() }, 'Try again');
      this.actions.append(button);
      button.focus();
    }
  }

  hide(): void {
    this.el.classList.add('hidden');
    this.el.setAttribute('role', 'dialog');
  }
}
