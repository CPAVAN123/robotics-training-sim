/**
 * Heads-up display: speed, heading, tilt, motor load per leg, foot contacts, command, time and falls.
 * DOM writes are throttled; motor loads are smoothed so the bars are readable (torques change every 2 ms).
 */
import type { MotionCommand, RobotInfo, RobotState } from '../core/types';
import { ROBOT_FACTS } from '../lessons/content';
import type { HudPart } from '../lessons/types';
import { h, setText } from './dom';

const UPDATE_INTERVAL_S = 1 / 20;
/** Motor-load smoothing time constant, s. */
const LOAD_TAU_S = 0.15;
/** Speed-reading smoothing time constant, s. */
const SPEED_TAU_S = 0.4;

export function loadLevel(ratio: number): 'low' | 'mid' | 'high' {
  return ratio < 0.5 ? 'low' : ratio < 0.85 ? 'mid' : 'high';
}

export class Hud {
  readonly el: HTMLElement;
  private readonly speed: HTMLElement;
  private readonly speedSub: HTMLElement;
  private readonly needle: SVGGElement;
  private readonly headingText: HTMLElement;
  private readonly tiltNeedle: SVGLineElement;
  private readonly tiltText: HTMLElement;
  private readonly tiltLimitText: HTMLElement;
  private readonly tiltLimit: SVGPathElement;
  private readonly motors: HTMLElement;
  private readonly feet: HTMLElement;
  private readonly cmdBars: Record<'vx' | 'vy' | 'yawRate', { fill: HTMLElement; text: HTMLElement }>;
  private readonly time: HTMLElement;
  private readonly falls: HTMLElement;
  private readonly sections: Record<HudPart, HTMLElement>;
  private bars: { fill: HTMLElement; ratio: number }[] = [];
  private legLabels: HTMLElement[] = [];
  private dots: HTMLElement[] = [];
  private robot: RobotInfo | null = null;
  private sinceUpdate = Infinity;
  private readonly velocity: [number, number] = [0, 0];

  constructor() {
    this.speed = h('span', { class: 'hud-big' }, '0.00');
    this.speedSub = h('span', { class: 'hud-sub' }, 'standing');
    this.headingText = h('span', { class: 'hud-sub' }, '0°');
    const compass = svgEl('svg', { viewBox: '-20 -20 40 40', class: 'compass', 'aria-hidden': 'true' });
    compass.append(svgEl('circle', { r: '18', class: 'compass-ring' }));
    this.needle = svgEl('g', {}) as SVGGElement;
    this.needle.append(svgEl('path', { d: 'M0 -14 L5 4 L0 1 L-5 4 Z', class: 'compass-needle' }));
    compass.append(this.needle);

    // Quarter dial: 0° (upright) at the top, 90° (lying flat) at the right; red past the fall limit.
    const gauge = svgEl('svg', { viewBox: '-8 -42 52 48', class: 'tilt-gauge', 'aria-hidden': 'true' });
    gauge.append(svgEl('path', { d: arc(36, 0, 90), class: 'gauge-track' }));
    this.tiltLimit = svgEl('path', { d: '', class: 'gauge-danger' }) as SVGPathElement;
    gauge.append(this.tiltLimit);
    this.tiltNeedle = svgEl('line', { x1: '0', y1: '0', x2: '0', y2: '-32', class: 'gauge-needle' }) as SVGLineElement;
    gauge.append(this.tiltNeedle, svgEl('circle', { r: '3.5', class: 'gauge-hub' }));
    this.tiltText = h('span', { class: 'hud-big' }, '0°');
    this.tiltLimitText = h('span', { class: 'hud-sub' });

    this.motors = h('div', { class: 'motor-groups' });
    this.feet = h('div', { class: 'feet' });
    const cmdRow = (label: string) => {
      const fill = h('span', { class: 'cmd-fill' });
      const text = h('span', { class: 'cmd-value' }, '0');
      const row = h('div', { class: 'cmd-row' }, h('span', { class: 'cmd-label' }, label), h('span', { class: 'cmd-track' }, fill), text);
      return { row, fill, text };
    };
    const vx = cmdRow('Forward');
    const vy = cmdRow('Sideways');
    const yaw = cmdRow('Turn');
    this.cmdBars = { vx, vy, yawRate: yaw };
    this.time = h('span', {}, '0.0 s');
    this.falls = h('span', {}, '0');

    const section = (title: string, part: HudPart, ...children: Node[]) =>
      h('section', { class: 'hud-section', 'data-part': part, 'aria-label': title }, h('h3', {}, title), ...children);

    this.sections = {
      speed: section('Speed & heading', 'speed', h('div', { class: 'hud-row' }, h('div', {}, this.speed, h('span', { class: 'hud-unit' }, ' m/s'), h('br'), this.speedSub), h('div', { class: 'compass-wrap' }, compass, this.headingText))),
      tilt: section('Tilt (IMU)', 'tilt', h('div', { class: 'hud-row' }, gauge, h('div', { class: 'tilt-text' }, this.tiltText, h('br'), this.tiltLimitText))),
      motors: section('Motor load', 'motors', this.motors),
      feet: section('Feet on ground', 'feet', this.feet),
      command: section('Your command', 'command', vx.row, vy.row, yaw.row),
    };
    this.el = h(
      'aside',
      { class: 'hud panel', 'aria-label': 'Robot dashboard' },
      this.sections.speed,
      this.sections.tilt,
      this.sections.motors,
      this.sections.feet,
      this.sections.command,
      h('div', { class: 'hud-foot' }, h('span', {}, 'Sim time ', this.time), h('span', {}, 'Falls ', this.falls)),
    );
  }

  /** Rebuilds the robot-specific parts (legs, motors, feet). */
  setRobot(robot: RobotInfo): void {
    this.robot = robot;
    this.velocity[0] = this.velocity[1] = 0;
    const facts = ROBOT_FACTS[robot.id];
    this.bars = [];
    this.legLabels = [];
    this.motors.replaceChildren(
      ...facts.legs.map((leg) => {
        const bars = h('div', { class: 'motor-bars' });
        for (const motor of leg.motors) {
          const fill = h('span', { class: 'motor-fill low' });
          bars.append(h('span', { class: 'motor-bar', title: `${leg.name}: ${motor}` }, fill));
          this.bars.push({ fill, ratio: 0 });
        }
        const label = h('span', { class: 'leg-load' }, '0%');
        this.legLabels.push(label);
        return h('div', { class: 'motor-group' }, h('span', { class: 'leg-name', title: leg.name }, leg.short), bars, label);
      }),
    );
    this.dots = facts.feet.map((name) => h('span', { class: 'foot-dot', role: 'img', title: name, 'aria-label': `${name}: in the air` }));
    this.feet.className = `feet feet-${robot.id}`;
    this.feet.replaceChildren(...this.dots.map((d, i) => h('span', { class: 'foot' }, d, h('span', { class: 'foot-name' }, facts.feet[i]))));
    const limitDeg = (robot.fallTilt * 180) / Math.PI;
    this.tiltLimit.setAttribute('d', arc(36, Math.min(90, limitDeg), 90));
    setText(this.tiltLimitText, `falls past ${Math.round(limitDeg)}°`);
  }

  highlight(part: HudPart | undefined): void {
    for (const [key, el] of Object.entries(this.sections)) el.classList.toggle('highlight', key === part);
  }

  update(state: RobotState, command: MotionCommand, falls: number, dt: number): void {
    const robot = this.robot;
    if (!robot) return;
    // Smooth motor loads every frame so short spikes still show.
    const a = 1 - Math.exp(-dt / LOAD_TAU_S);
    // Walking bodies sway every step; average the speed over a few steps so the reading is steady.
    const v = 1 - Math.exp(-dt / SPEED_TAU_S);
    this.velocity[0] += (state.velocity[0] - this.velocity[0]) * v;
    this.velocity[1] += (state.velocity[1] - this.velocity[1]) * v;
    for (let i = 0; i < this.bars.length; i++) {
      const limit = state.torqueLimits[i] || 1;
      const ratio = Math.min(1, Math.abs(state.torques[i] ?? 0) / limit);
      this.bars[i].ratio += (ratio - this.bars[i].ratio) * a;
    }
    this.sinceUpdate += dt;
    if (this.sinceUpdate < UPDATE_INTERVAL_S) return;
    this.sinceUpdate = 0;

    const [vf, vl] = this.velocity;
    const speed = Math.hypot(vf, vl);
    setText(this.speed, speed.toFixed(2));
    setText(this.speedSub, speed < 0.1 ? 'standing' : Math.abs(vf) >= Math.abs(vl) ? (vf > 0 ? 'forward' : 'backward') : vl > 0 ? 'sideways left' : 'sideways right');
    const headingDeg = (((state.heading * 180) / Math.PI) % 360 + 360) % 360;
    this.needle.setAttribute('transform', `rotate(${(-headingDeg + 90).toFixed(1)})`);
    setText(this.headingText, `${Math.round(headingDeg) % 360}°`);

    const tiltDeg = (state.tilt * 180) / Math.PI;
    this.tiltNeedle.setAttribute('transform', `rotate(${Math.min(90, tiltDeg).toFixed(1)})`);
    const tiltFrac = state.tilt / robot.fallTilt;
    this.tiltNeedle.setAttribute('class', `gauge-needle ${tiltFrac < 0.4 ? 'low' : tiltFrac < 0.75 ? 'mid' : 'high'}`);
    setText(this.tiltText, `${tiltDeg.toFixed(0)}°`);

    const facts = ROBOT_FACTS[robot.id];
    let i = 0;
    facts.legs.forEach((leg, l) => {
      let peak = 0;
      for (let m = 0; m < leg.motors.length; m++, i++) {
        const bar = this.bars[i];
        peak = Math.max(peak, bar.ratio);
        bar.fill.style.height = `${Math.round(bar.ratio * 100)}%`;
        bar.fill.className = `motor-fill ${loadLevel(bar.ratio)}`;
      }
      setText(this.legLabels[l], `${Math.round(peak * 100)}%`);
    });
    this.dots.forEach((dot, f) => {
      const down = state.footContacts[f] ?? false;
      dot.classList.toggle('down', down);
      dot.setAttribute('aria-label', `${facts.feet[f]}: ${down ? 'on the ground' : 'in the air'}`);
    });

    const max = robot.maxCommand;
    this.setCmd('vx', command.vx, max.vx, 'm/s');
    this.setCmd('vy', command.vy, max.vy, 'm/s');
    this.setCmd('yawRate', command.yawRate, max.yawRate, 'rad/s');
    setText(this.time, `${state.time.toFixed(1)} s`);
    setText(this.falls, String(falls));
  }

  private setCmd(key: 'vx' | 'vy' | 'yawRate', value: number, max: number, unit: string): void {
    const { fill, text } = this.cmdBars[key];
    const frac = max > 0 ? value / max : 0;
    // Bars grow from the centre: right/positive = forward, left, counter-clockwise.
    fill.style.left = `${50 + Math.min(0, frac) * 50}%`;
    fill.style.width = `${Math.abs(frac) * 50}%`;
    setText(text, `${value >= 0 ? ' ' : ''}${value.toFixed(2)} ${unit}`);
  }
}

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

/** SVG arc path on a circle of radius r, angles in degrees from straight up (clockwise positive). */
function arc(r: number, fromDeg: number, toDeg: number): string {
  const p = (deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
  };
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  return `M ${p(fromDeg)} A ${r} ${r} 0 ${large} 1 ${p(toDeg)}`;
}
