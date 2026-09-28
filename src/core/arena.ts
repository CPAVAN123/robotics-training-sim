/**
 * The warehouse arena: a 30 m x 20 m hall with an obstacle course along the south side,
 * an open push-test pad and a physics-lab area to the north.
 *
 *   y = +10 ┌──────────────────────────────────────────────────┐
 *           │  storage racks along the north wall              │
 *           │     [ physics lab ]            [ push pad ]      │
 *           │ ──────────────── walkway ─────────────────────── │
 *           │ START → 1 → slalom 2,3,4 → gap 5 → ramp 6 → 7    │
 *   y = -10 └──────────────────────────────────────────────────┘
 *        x = -15                                            x = +15
 *
 * Everything the robots can touch is a box (or the floor plane); floor paint is non-colliding.
 */
import type { ArenaLayout, Checkpoint, Obstacle } from './types';

const HALF_X = 15;
const HALF_Y = 10;
const LANE_Y = -6;

const WALL_RGBA: Obstacle['rgba'] = [0.8, 0.82, 0.85, 1];
const RACK_RGBA: Obstacle['rgba'] = [0.2, 0.36, 0.62, 1];
const CRATE_RGBA: Obstacle['rgba'] = [0.76, 0.56, 0.33, 1];
const PALLET_RGBA: Obstacle['rgba'] = [0.58, 0.44, 0.28, 1];
const RAMP_RGBA: Obstacle['rgba'] = [0.45, 0.5, 0.56, 1];
const BUMP_RGBA: Obstacle['rgba'] = [0.95, 0.72, 0.08, 1];

const YELLOW: Rgba = [0.98, 0.8, 0.1, 1];
const WHITE: Rgba = [0.95, 0.95, 0.95, 1];
const GREEN: Rgba = [0.2, 0.7, 0.35, 1];
const RED: Rgba = [0.85, 0.2, 0.2, 1];
const BLUE: Rgba = [0.2, 0.5, 0.9, 1];

type Rgba = [number, number, number, number];

/** Floor paint: a flat rectangle drawn just above the floor. Visual only (contype = conaffinity = 0). */
export interface FloorMarking {
  name: string;
  x: number;
  y: number;
  halfX: number;
  halfY: number;
  rgba: Rgba;
}

/**
 * Loading ramp: up-ramp, flat top, down-ramp (8 cm rise over 2.5 m, about 1.8 degrees).
 * The G1 policy was trained only on flat floors. Measured: it walks straight over this ramp at every
 * speed from 0.3 to 0.8 m/s, while 15-20 cm ramps made it fall; random sidestepping and turning on
 * the ramp tipped it over in about 1 of 24 tries (0 of 24 on flat floor).
 */
const RAMP = { upStart: 3.5, upEnd: 6, downStart: 7.5, downEnd: 10, rise: 0.08, halfWidth: 1.2 };
/**
 * Cable protectors across the lane: 2 cm tall, like the ones on real warehouse floors.
 * Measured: G1 crosses 2-3 cm bumps walking straight at any speed; 4-5 cm bumps made it fall at 0.3 m/s.
 */
const BUMP_XS = [11, 12];
const BUMP_HEIGHT = 0.02;
const FINISH_X = 13.2;

function box(name: string, kind: Obstacle['kind'], pos: Obstacle['pos'], halfSize: Obstacle['halfSize'], rgba: Obstacle['rgba']): Obstacle {
  return { name, kind, pos, halfSize, rgba };
}

/**
 * A tilted box whose top face rises from the floor at x0 to height `rise` at x1 (x1 < x0 for a down-ramp).
 * The rest of the box is buried below the floor or hidden under the ramp top.
 */
function ramp(name: string, x0: number, x1: number, y: number, halfWidth: number, rise: number): Obstacle {
  const thickness = 0.1;
  const run = Math.abs(x1 - x0);
  const slope = Math.atan2(rise, run);
  const dir = Math.sign(x1 - x0);
  // Pitch about +y tilts +x downwards, so a surface rising along +x needs negative pitch.
  const pitch = -dir * slope;
  const halfT = thickness / 2;
  return {
    name,
    kind: 'ramp',
    pos: [(x0 + x1) / 2 + dir * halfT * Math.sin(slope), y, rise / 2 - halfT * Math.cos(slope)],
    halfSize: [Math.hypot(run, rise) / 2, halfWidth, halfT],
    pitch,
    rgba: RAMP_RGBA,
  };
}

function walls(): Obstacle[] {
  const t = 0.15;
  const h = 0.75;
  return [
    box('wall_north', 'wall', [0, HALF_Y + t, h], [HALF_X + 2 * t, t, h], WALL_RGBA),
    box('wall_south', 'wall', [0, -HALF_Y - t, h], [HALF_X + 2 * t, t, h], WALL_RGBA),
    box('wall_east', 'wall', [HALF_X + t, 0, h], [t, HALF_Y, h], WALL_RGBA),
    box('wall_west', 'wall', [-HALF_X - t, 0, h], [t, HALF_Y, h], WALL_RGBA),
  ];
}

function course(): Obstacle[] {
  const crate = (name: string, x: number, y: number) => box(name, 'crate', [x, y, 0.45], [0.4, 0.4, 0.45], CRATE_RGBA);
  const gapHalf = 0.45;
  const palletHalfY = 1.5;
  const palletY = gapHalf + palletHalfY;
  const { upStart, upEnd, downStart, downEnd, rise, halfWidth } = RAMP;
  return [
    crate('crate_1', -7, LANE_Y + 0.8),
    crate('crate_2', -4.5, LANE_Y - 0.8),
    crate('crate_3', -2, LANE_Y + 0.8),
    box('pallets_north', 'pallet', [1.5, LANE_Y + palletY, 0.3], [0.6, palletHalfY, 0.3], PALLET_RGBA),
    box('pallets_south', 'pallet', [1.5, LANE_Y - palletY, 0.3], [0.6, palletHalfY, 0.3], PALLET_RGBA),
    ramp('ramp_up', upStart, upEnd, LANE_Y, halfWidth, rise),
    box('ramp_top', 'ramp', [(upEnd + downStart) / 2, LANE_Y, rise / 2], [(downStart - upEnd) / 2, halfWidth, rise / 2], RAMP_RGBA),
    ramp('ramp_down', downEnd, downStart, LANE_Y, halfWidth, rise),
    ...BUMP_XS.map((x, i) =>
      box(`cable_bump_${i + 1}`, 'bump', [x, LANE_Y, BUMP_HEIGHT / 2], [0.06, 2.7, BUMP_HEIGHT / 2], BUMP_RGBA),
    ),
  ];
}

function storageRacks(): Obstacle[] {
  return [-11, -5, 1, 7].map((x, i) => box(`rack_${i + 1}`, 'wall', [x, HALF_Y - 0.5, 1.1], [2, 0.45, 1.1], RACK_RGBA));
}

const CHECKPOINTS: Checkpoint[] = [
  { id: 'cp1', label: 'Warm-up', x: -9.5, y: LANE_Y, radius: 0.5 },
  { id: 'cp2', label: 'Slalom 1', x: -7, y: LANE_Y - 0.6, radius: 0.5 },
  { id: 'cp3', label: 'Slalom 2', x: -4.5, y: LANE_Y + 0.6, radius: 0.5 },
  { id: 'cp4', label: 'Slalom 3', x: -2, y: LANE_Y - 0.6, radius: 0.5 },
  { id: 'cp5', label: 'Pallet gap', x: 1.5, y: LANE_Y, radius: 0.4 },
  { id: 'cp6', label: 'Ramp top', x: (RAMP.upEnd + RAMP.downStart) / 2, y: LANE_Y, radius: 0.5 },
  { id: 'cp7', label: 'Finish', x: FINISH_X, y: LANE_Y, radius: 0.5 },
];

export const WAREHOUSE: ArenaLayout = {
  size: [2 * HALF_X, 2 * HALF_Y],
  obstacles: [...walls(), ...storageRacks(), ...course()],
  checkpoints: CHECKPOINTS,
  spawns: {
    start: { x: -12.5, y: LANE_Y, heading: 0 },
    pushPad: { x: 8, y: 4, heading: 0 },
    lab: { x: -8, y: 4, heading: 0 },
  },
};

function outline(name: string, x: number, y: number, halfX: number, halfY: number, rgba: Rgba, w = 0.05): FloorMarking[] {
  return [
    { name: `${name}_n`, x, y: y + halfY, halfX: halfX + w, halfY: w, rgba },
    { name: `${name}_s`, x, y: y - halfY, halfX: halfX + w, halfY: w, rgba },
    { name: `${name}_e`, x: x + halfX, y, halfX: w, halfY: halfY - w, rgba },
    { name: `${name}_w`, x: x - halfX, y, halfX: w, halfY: halfY - w, rgba },
  ];
}

/** Safety lines and zone markings painted on the warehouse floor. */
export const WAREHOUSE_MARKINGS: FloorMarking[] = [
  // Course lane edges and walkway between the course and the open areas.
  { name: 'lane_north', x: 0, y: LANE_Y + 2.8, halfX: 14.2, halfY: 0.06, rgba: YELLOW },
  { name: 'lane_south', x: 0, y: LANE_Y - 2.8, halfX: 14.2, halfY: 0.06, rgba: YELLOW },
  { name: 'walkway', x: 0, y: 0.3, halfX: 14.2, halfY: 0.06, rgba: YELLOW },
  // An outline, not a filled square, so the green support polygon of the balance view shows up on it.
  ...outline('start_pad', WAREHOUSE.spawns.start.x, LANE_Y, 0.8, 0.8, GREEN, 0.06),
  { name: 'finish_line', x: FINISH_X, y: LANE_Y, halfX: 0.15, halfY: 2.7, rgba: WHITE },
  ...outline('push_pad', WAREHOUSE.spawns.pushPad.x, WAREHOUSE.spawns.pushPad.y, 3, 3, RED),
  { name: 'push_pad_x', x: WAREHOUSE.spawns.pushPad.x, y: WAREHOUSE.spawns.pushPad.y, halfX: 0.5, halfY: 0.04, rgba: RED },
  { name: 'push_pad_y', x: WAREHOUSE.spawns.pushPad.x, y: WAREHOUSE.spawns.pushPad.y, halfX: 0.04, halfY: 0.5, rgba: RED },
  ...outline('lab', WAREHOUSE.spawns.lab.x, WAREHOUSE.spawns.lab.y, 4, 3, BLUE),
];

const fmt = (v: number) => (Math.abs(v) < 1e-12 ? '0' : Number(v.toFixed(6)).toString());
const vec = (v: readonly number[]) => v.map(fmt).join(' ');

/** Rotation about z by `yaw`, then about the new y axis by `pitch`, as a MuJoCo (w x y z) quaternion. */
function obstacleQuat(yaw: number, pitch: number): number[] {
  const a = Math.cos(yaw / 2), b = Math.sin(yaw / 2), c = Math.cos(pitch / 2), d = Math.sin(pitch / 2);
  return [a * c, -b * d, a * d, b * c];
}

/**
 * MJCF elements for the arena (lights, floor, obstacles, floor paint), to be placed inside <mujoco>
 * after the robot's <include>.
 */
export function arenaMjcf(layout: ArenaLayout, markings: FloorMarking[] = WAREHOUSE_MARKINGS): string {
  const [sx, sy] = layout.size;
  const lines = [
    '  <visual>',
    '    <headlight ambient="0.35 0.35 0.35" diffuse="0.5 0.5 0.5" specular="0 0 0"/>',
    '  </visual>',
    '  <worldbody>',
    `    <light name="sun" directional="true" pos="0 0 12" dir="0.3 0.4 -1" diffuse="0.8 0.8 0.78" castshadow="true"/>`,
    `    <light name="hall_west" pos="${fmt(-sx / 4)} 0 8" dir="0 0 -1" diffuse="0.35 0.35 0.35" castshadow="false"/>`,
    `    <light name="hall_east" pos="${fmt(sx / 4)} 0 8" dir="0 0 -1" diffuse="0.35 0.35 0.35" castshadow="false"/>`,
    `    <geom name="floor" type="plane" size="${fmt(sx / 2)} ${fmt(sy / 2)} 0.05" rgba="0.56 0.57 0.58 1"/>`,
  ];
  for (const o of layout.obstacles) {
    const rot = o.yaw || o.pitch ? ` quat="${vec(obstacleQuat(o.yaw ?? 0, o.pitch ?? 0))}"` : '';
    lines.push(`    <geom name="${o.name}" type="box" pos="${vec(o.pos)}" size="${vec(o.halfSize)}"${rot} rgba="${vec(o.rgba)}"/>`);
  }
  for (const m of markings) {
    lines.push(
      `    <geom name="paint_${m.name}" type="box" pos="${fmt(m.x)} ${fmt(m.y)} 0.001" size="${fmt(m.halfX)} ${fmt(m.halfY)} 0.001"` +
        ` contype="0" conaffinity="0" rgba="${vec(m.rgba)}"/>`,
    );
  }
  lines.push('  </worldbody>');
  return lines.join('\n') + '\n';
}
