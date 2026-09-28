/**
 * The application: owns the simulation, the 3D view, input, the running lesson and every screen,
 * and runs the frame loop (input → physics → lesson → render → HUD).
 */
import { fetchFile } from '../core/mujoco';
import { Simulation, TIMESTEP } from '../core/simulation';
import { DEFAULT_KNOBS, type MotionCommand, type PhysicsKnobs, type RobotId, type RobotState } from '../core/types';
import { Controls } from '../input/controls';
import type { KeyAction } from '../input/keyboard';
import { lessonById, nextLesson } from '../lessons';
import { Progress } from '../lessons/progress';
import { pushDirection } from '../lessons/push';
import { LessonRunner } from '../lessons/runner';
import type { KnobKey, LessonHost, LessonId, LessonResult, LessonView, Tone } from '../lessons/types';
import { SceneView } from '../render/view';
import { waypointCommand } from '../robots/autopilot';
import { ROBOTS } from '../robots/registry';
import { ExplainDialog, HelpDialog, ResultDialog } from './dialogs';
import { HomeScreen } from './home';
import { Hud } from './hud';
import { LabPanel } from './labPanel';
import { LessonScreen } from './lessonScreen';
import { LoadingOverlay } from './loading';
import { PushMenu } from './pushMenu';

const ROBOT_KEY = 'robotics-training-sim.robot';
const STOP: MotionCommand = { vx: 0, vy: 0, yawRate: 0 };

/** Hooks for automated tests (window.__app). */
export interface TestHooks {
  selectRobot(id: RobotId): Promise<void>;
  startLesson(id: LessonId): void;
  exitLesson(): void;
  lessonView(): LessonView | null;
  /** Simulated seconds and wall-clock seconds since the last resetStats(). */
  stats(): { simSeconds: number; wallSeconds: number; frames: number; quality: number };
  resetStats(): void;
  readonly ready: boolean;
}

declare global {
  interface Window {
    /** The current Simulation (tests and curious students with devtools). */
    __sim?: Simulation;
    __app?: TestHooks;
  }
}

export class App {
  private sim: Simulation | null = null;
  private readonly view: SceneView;
  private readonly controls: Controls;
  private readonly progress = new Progress();
  private robotId: RobotId;
  private runner: LessonRunner | null = null;
  private lessonView: LessonView | null = null;
  private lastState: RobotState | null = null;
  private falls = 0;
  private loading = false;
  private loadToken = 0;
  private pausedByDialog = false;
  private lastFrame = 0;
  /** Simulated seconds the previous frame advanced: how long this frame's command will act for. */
  private simDt = 0;
  private frameFailed = false;
  private stats = { simSeconds: 0, wallSeconds: 0, frames: 0 };
  private offSimEvents: (() => void)[] = [];

  private readonly loadingOverlay = new LoadingOverlay();
  private readonly home: HomeScreen;
  private readonly lessonScreen: LessonScreen;
  private readonly hud = new Hud();
  private readonly lab: LabPanel;
  private readonly pushMenu: PushMenu;
  private readonly explain = new ExplainDialog();
  private readonly help = new HelpDialog();
  private readonly result: ResultDialog;

  constructor(
    private readonly root: HTMLElement,
    canvas: HTMLCanvasElement,
    reducedMotion: boolean,
  ) {
    this.robotId = readSavedRobot();
    this.view = new SceneView(canvas, reducedMotion);
    this.controls = new Controls((a) => this.onAction(a));
    this.home = new HomeScreen(this.progress, {
      selectRobot: (id) => void this.selectRobot(id),
      startLesson: (id) => this.startLesson(id),
      openHelp: () => this.openDialog(this.help),
    });
    this.lessonScreen = new LessonScreen({
      exit: () => this.exitLesson(),
      act: (id) => this.runner?.act(id),
      explain: () => this.openExplain(),
      help: () => this.openDialog(this.help),
      togglePause: () => this.togglePause(),
      reset: () => this.resetRobot(),
      togglePushMenu: () => this.pushMenu.toggle(),
      toggleBalance: () => (this.view.balanceVisible = !this.view.balanceVisible),
      toggleCamera: () => (this.view.rig.chase = !this.view.rig.chase),
      toggleDemo: () => this.runner?.act('demo'),
    });
    this.lab = new LabPanel({
      setKnob: (key, value) => this.setKnob(key, value),
      resetKnobs: () => this.setKnobs({ ...DEFAULT_KNOBS }),
      act: (id) => this.runner?.act(id),
    });
    this.pushMenu = new PushMenu(
      (level) => this.pushLevel(level),
      () => this.pushMenu.toggle(false),
    );
    this.result = new ResultDialog({
      retry: () => this.runner && this.startLesson(this.runner.def.id),
      next: () => {
        const next = this.runner && nextLesson(this.runner.def.id);
        if (next) this.startLesson(next.id);
      },
      home: () => this.exitLesson(),
    });
    for (const dialog of [this.explain, this.help]) dialog.onClose = () => this.resumeAfterDialog();

    this.root.append(
      this.home.el,
      this.lessonScreen.el,
      this.hud.el,
      this.lab.el,
      this.pushMenu.el,
      this.controls.joysticks.el,
      this.explain.el,
      this.help.el,
      this.result.el,
      this.loadingOverlay.el,
    );
    this.showScreen('home');
    window.addEventListener('resize', () => this.layout());
    // The home panel's height follows its content, lesson cards come and go and the top bar can wrap.
    const panels = new ResizeObserver(() => this.layout());
    panels.observe(this.home.el);
    panels.observe(this.lessonScreen.cardBox);
    panels.observe(this.lessonScreen.topbar);
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.anyDialogOpen() && this.pushMenu.open) this.pushMenu.toggle(false);
    });
    // After a mouse or touch press, hand the keyboard back to driving: otherwise Space would press the
    // last-clicked button again (instead of pausing) and the arrows would nudge the last-dragged slider.
    // Keyboard users keep their focus; buttons inside dialogs keep theirs too.
    window.addEventListener('pointerup', () => {
      const el = document.activeElement;
      if (el instanceof HTMLElement && el.matches('button, input[type="range"]') && !el.closest('dialog')) el.blur();
    });
    this.exposeTestHooks();
  }

  async start(): Promise<void> {
    requestAnimationFrame((t) => this.frame(t));
    await this.selectRobot(this.robotId);
  }

  async selectRobot(id: RobotId): Promise<void> {
    const token = ++this.loadToken;
    if (this.runner) this.exitLesson();
    this.robotId = id;
    saveRobot(id);
    this.loading = true;
    this.home.render(id, true);
    this.loadingOverlay.show(`Loading the ${ROBOTS[id].name}`);
    this.disposeSim();
    try {
      // The physics engine download has no progress events; the robot files do.
      const sim = await Simulation.create({
        robot: id,
        loadFile: fetchFile,
        onProgress: (loaded, total) => {
          if (token === this.loadToken) this.loadingOverlay.stage(`Downloading robot files: ${loaded} of ${total}`, loaded / total);
        },
      });
      if (token !== this.loadToken) {
        sim.dispose();
        return;
      }
      this.loadingOverlay.stage('Building the 3D scene…', 1);
      this.sim = sim;
      window.__sim = sim;
      this.offSimEvents = [
        sim.on('reset', () => this.view.snapCamera()),
        sim.on('fall', () => this.falls++),
      ];
      this.view.load(sim);
      this.hud.setRobot(sim.robot);
      this.pushMenu.setRobot(id);
      this.loading = false;
      this.home.render(id, false);
      this.loadingOverlay.hide();
    } catch (err) {
      if (token !== this.loadToken) return;
      console.error(err);
      this.loading = false;
      this.loadingOverlay.error(
        {
          title: 'The robot could not be loaded',
          message:
            'Something went wrong while downloading or starting the simulator. Check your internet connection and try ' +
            `again. (${err instanceof Error ? err.message : String(err)})`,
        },
        () => void this.selectRobot(id),
      );
    }
  }

  startLesson(id: LessonId): void {
    const sim = this.sim;
    if (!sim || this.loading) return;
    this.result.close();
    const def = lessonById(id);
    sim.paused = false;
    sim.setKnobs({ ...DEFAULT_KNOBS });
    this.controls.clear();
    this.falls = 0;
    this.runner = new LessonRunner(def, this.host(sim));
    this.lessonScreen.setLesson(def, sim.robot.name);
    this.runner.start();
    this.lessonView = this.runner.view();
    this.view.balanceVisible = this.lessonView.balanceOverlay;
    this.showScreen('lesson');
    // Start every lesson looking over the robot's shoulder, whatever the camera did before.
    this.view.frameRobot();
    this.lessonScreen.focus();
  }

  exitLesson(): void {
    this.runner = null;
    this.lessonView = null;
    this.result.close();
    this.pushMenu.toggle(false);
    const sim = this.sim;
    if (sim) {
      sim.paused = false;
      sim.setKnobs({ ...DEFAULT_KNOBS });
      sim.reset(sim.arena.spawns.start);
    }
    this.view.balanceVisible = false;
    this.view.overlays.setCheckpoints([]);
    this.controls.clear();
    this.home.render(this.robotId, this.loading);
    this.showScreen('home');
    this.home.focus();
  }

  private host(sim: Simulation): LessonHost {
    return {
      robot: sim.robot,
      arena: sim.arena,
      get knobs() {
        return sim.knobs;
      },
      get robotMassKg() {
        return robotMass(sim);
      },
      resetRobot: (spawn) => {
        sim.reset(spawn);
        this.controls.clear();
      },
      push: (forceN, dir, duration) => sim.push(forceN, dir, duration),
      setKnobs: (knobs) => sim.setKnobs(knobs),
      announce: (text, tone) => this.announce(text, tone),
    };
  }

  private frame(now: number): void {
    // Ask for the next frame first, so one failing frame can't stop the app for good.
    requestAnimationFrame((t) => this.frame(t));
    try {
      this.step(now);
    } catch (err) {
      if (!this.frameFailed) console.error('A frame failed; carrying on with the next one.', err);
      this.frameFailed = true;
    }
  }

  private step(now: number): void {
    const elapsed = this.lastFrame ? (now - this.lastFrame) / 1000 : 0;
    const dt = Math.min(0.25, elapsed);
    this.lastFrame = now;
    const sim = this.sim;
    if (!sim || this.loading) return;
    // The command ramps over simulated time (the previous frame's step, one frame behind), so slow
    // motion slows the ramp too and a key held while paused changes nothing.
    const drive = this.controls.update(this.simDt, sim.robot.maxCommand);
    sim.setCommand(this.runner && !this.anyDialogOpen() ? this.command(drive, sim) : STOP);
    const steps = sim.advance(dt);
    this.simDt = steps * TIMESTEP;
    this.stats.simSeconds += steps * TIMESTEP;
    this.stats.wallSeconds += elapsed;
    this.stats.frames++;
    const state = sim.getState();
    this.lastState = state;
    if (this.runner) this.updateLesson(state);
    this.view.render(dt, this.lessonView, state.heading, state.footContacts);
    if (this.runner) {
      this.hud.update(state, sim.command, this.falls, dt);
      this.lessonScreen.update(this.lessonView as LessonView, dt, {
        // The result dialog freezes the robot; its pause is not one the student can undo with Space.
        paused: sim.paused && !this.result.isOpen,
        balance: this.view.balanceVisible,
        chase: this.view.rig.chase,
      });
      if (this.lessonView?.lab) this.lab.update(this.lessonView.lab, sim.knobs);
    }
  }

  private command(drive: MotionCommand, sim: Simulation): MotionCommand {
    const target = this.runner?.lesson.autopilotTarget?.();
    if (target && this.lastState) return waypointCommand(this.lastState, target, sim.robot);
    return drive;
  }

  private updateLesson(state: RobotState): void {
    const runner = this.runner;
    if (!runner) return;
    const result = runner.update(state);
    this.lessonView = runner.view();
    this.view.overlays.setCheckpoints(this.lessonView.checkpoints);
    this.hud.highlight(this.lessonView.card?.highlight);
    if (result) this.finishLesson(result);
  }

  private finishLesson(result: LessonResult): void {
    const runner = this.runner;
    const sim = this.sim;
    if (!runner || !sim) return;
    const improved = this.progress.record(sim.robot.id, runner.def.id, result);
    this.controls.clear();
    // The lesson has stopped watching the robot (nothing would stand it back up), so freeze it behind the result.
    sim.paused = true;
    this.result.onClose = () => this.exitLesson();
    this.result.open(runner.def, result, improved, nextLesson(runner.def.id) !== null);
  }

  private onAction(action: KeyAction): void {
    if (action === 'help') {
      if (this.help.isOpen) this.help.close();
      else this.openDialog(this.help);
      return;
    }
    if (this.anyDialogOpen() || !this.runner || !this.sim) return;
    switch (action) {
      case 'pause':
        this.togglePause();
        break;
      case 'reset':
        this.resetRobot();
        break;
      case 'pushMenu':
        this.pushMenu.toggle();
        break;
      case 'push1':
      case 'push2':
      case 'push3':
        this.pushLevel(Number(action.slice(4)) - 1 as 0 | 1 | 2);
        break;
      case 'balance':
        this.view.balanceVisible = !this.view.balanceVisible;
        break;
      case 'camera':
        this.view.rig.chase = !this.view.rig.chase;
        break;
      case 'explain':
        this.openExplain();
        break;
    }
  }

  private togglePause(): void {
    if (!this.sim) return;
    this.sim.paused = !this.sim.paused;
    this.announce(this.sim.paused ? 'Paused.' : 'Running.');
  }

  private resetRobot(): void {
    if (!this.runner) return;
    // First, so a lesson's own message about the reset (a penalty, a missed push) replaces it.
    this.announce('Robot reset.');
    this.runner.respawn();
  }

  private pushLevel(level: 0 | 1 | 2): void {
    const sim = this.sim;
    if (!sim || !this.runner) return;
    const force = this.pushMenu.force(level);
    sim.push(force, pushDirection(this.pushMenu.side, sim.getState().heading), 0.1);
    this.announce(`Pushed with ${force} N on its ${this.pushMenu.side === 'behind' ? 'back' : this.pushMenu.side}.`);
  }

  private setKnob(key: KnobKey, value: number): void {
    this.setKnobs({ [key]: value });
    this.runner?.act(`knob:${key}`);
  }

  private setKnobs(knobs: Partial<PhysicsKnobs>): void {
    this.sim?.setKnobs(knobs);
  }

  private openExplain(): void {
    if (!this.runner || !this.sim) return;
    this.explain.open(this.runner.def, this.sim.robot);
    this.pauseForDialog();
  }

  private openDialog(dialog: HelpDialog): void {
    dialog.show();
    this.pauseForDialog();
  }

  private pauseForDialog(): void {
    const sim = this.sim;
    if (!sim || !this.runner || sim.paused) return;
    sim.paused = true;
    this.pausedByDialog = true;
    this.controls.clear();
  }

  /** Resumes a pause that a dialog caused, once the last open dialog has closed. */
  private resumeAfterDialog(): void {
    if (!this.pausedByDialog || this.anyDialogOpen()) return;
    if (this.sim) this.sim.paused = false;
    this.pausedByDialog = false;
  }

  private anyDialogOpen(): boolean {
    return this.explain.isOpen || this.help.isOpen || this.result.isOpen;
  }

  private announce(text: string, tone: Tone = 'info'): void {
    this.lessonScreen.announce(text, tone);
  }

  private showScreen(screen: 'home' | 'lesson'): void {
    const lesson = screen === 'lesson';
    this.root.dataset.screen = screen;
    this.home.el.hidden = lesson;
    this.lessonScreen.el.hidden = !lesson;
    this.hud.el.hidden = !lesson;
    this.lab.el.hidden = !(lesson && this.lessonView?.lab);
    this.controls.joysticks.el.hidden = !lesson;
    if (!lesson) this.pushMenu.toggle(false);
    this.layout();
  }

  /** Tells the 3D view which screen edges are covered by panels, so the robot stays in the open part. */
  private layout(): void {
    const lesson = this.root.dataset.screen === 'lesson';
    const covered = (el: HTMLElement) => (el.hidden ? 0 : el.getBoundingClientRect().width + 12);
    if (lesson) {
      const card = this.lessonScreen.cardBox;
      // Narrow screens lift toasts above the lesson card (styles.css).
      this.root.style.setProperty('--card-h', `${card.hidden ? 0 : card.getBoundingClientRect().height}px`);
      const left = Math.max(covered(this.lab.el), covered(card));
      const top = this.lessonScreen.topbar.getBoundingClientRect().bottom;
      this.view.setLayout({ left, right: covered(this.hud.el), top, bottom: 0 }, false);
      return;
    }
    // On portrait tablets the home panel is a sheet along the bottom (styles.css), elsewhere a column on the left.
    const home = this.home.el.getBoundingClientRect();
    const sheet = home.width > window.innerWidth * 0.75 && home.top > 0.2 * window.innerHeight;
    this.view.setLayout(
      { left: sheet ? 0 : covered(this.home.el), right: 0, top: 0, bottom: sheet ? window.innerHeight - home.top + 12 : 0 },
      true,
    );
  }

  private disposeSim(): void {
    for (const off of this.offSimEvents) off();
    this.offSimEvents = [];
    this.sim?.dispose();
    this.sim = null;
    window.__sim = undefined;
  }

  private exposeTestHooks(): void {
    // Always exposed: lets the Playwright tests drive the app, and costs nothing for students.
    const app = this;
    window.__app = {
      selectRobot: (id) => app.selectRobot(id),
      startLesson: (id) => app.startLesson(id),
      exitLesson: () => app.exitLesson(),
      lessonView: () => app.lessonView,
      stats: () => ({ ...app.stats, quality: app.view.qualityLevel }),
      resetStats: () => {
        app.stats = { simSeconds: 0, wallSeconds: 0, frames: 0 };
      },
      get ready() {
        return !!app.sim && !app.loading;
      },
    };
  }
}

/** Mass of every body in the robot's tree (payload included), kg. */
function robotMass(sim: Simulation): number {
  const { mujoco, model } = sim;
  const base = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, sim.robot.baseBody);
  const root = model.body_rootid as Int32Array;
  const mass = model.body_mass as Float64Array;
  let total = 0;
  for (let b = 0; b < model.nbody; b++) if (root[b] === base) total += mass[b];
  return total;
}

function readSavedRobot(): RobotId {
  try {
    const saved = localStorage.getItem(ROBOT_KEY);
    return saved === 'go2' ? 'go2' : 'g1';
  } catch {
    return 'g1';
  }
}

function saveRobot(id: RobotId): void {
  try {
    localStorage.setItem(ROBOT_KEY, id);
  } catch {
    // Not saved: the choice still applies for this visit.
  }
}

