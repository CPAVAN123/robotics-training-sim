/**
 * Entry point: check the browser can run the simulator, then start the app.
 */
import './styles.css';
import { App } from './ui/app';
import { LoadingOverlay, checkSupport } from './ui/loading';

const root = document.getElementById('app') as HTMLElement;
const canvas = document.getElementById('view') as HTMLCanvasElement;

// Touch joysticks appear on touch screens (and as soon as anyone touches the screen).
const markTouch = () => (root.dataset.touch = 'true');
if (matchMedia('(pointer: coarse)').matches) markTouch();
window.addEventListener('pointerdown', (e) => e.pointerType === 'touch' && markTouch(), { passive: true });

function fail(title: string, message: string): void {
  const overlay = new LoadingOverlay();
  root.append(overlay.el);
  overlay.error({ title, message });
}

const problem = checkSupport();
if (problem) {
  fail(problem.title, problem.message);
} else {
  try {
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    void new App(root, canvas, reducedMotion).start();
  } catch (err) {
    console.error(err);
    fail(
      'The 3D view could not start',
      'Your browser supports WebGL but could not create a 3D canvas (the graphics driver may be blocked). Try ' +
        'restarting the browser or switching on hardware acceleration in its settings.',
    );
  }
}
