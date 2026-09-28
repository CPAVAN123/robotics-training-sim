/**
 * Teaching overlays drawn over the physics: checkpoint rings, push arrows and the balance view
 * (centre of mass projected on the floor plus the support polygon of the feet on the ground).
 */
import * as THREE from 'three';
import type { CheckpointMarker, PendingPush } from '../lessons/types';
import { convexHull, stabilityMargin, type Point2 } from '../lessons/balance';

const NEXT_COLOR = new THREE.Color('#ffb020');
const DONE_COLOR = new THREE.Color('#2fbf71');
const TODO_COLOR = new THREE.Color('#9fb3c8');
const PUSH_COLOR = new THREE.Color('#ff3b30');
const SAFE_COLOR = new THREE.Color('#2fbf71');
const RISK_COLOR = new THREE.Color('#ff8a00');

/** Finds the floor height under (x, y) among the static arena meshes. */
export type GroundProbe = (x: number, y: number) => number;

function numberSprite(n: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(15,23,42,0.85)';
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 64px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 64, 68);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.scale.set(0.45, 0.45, 1);
  sprite.renderOrder = 10;
  return sprite;
}

interface CheckpointMesh {
  id: string;
  group: THREE.Group;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  beacon: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  label: THREE.Sprite;
}

/** A vertical fade texture for the beacon column: opaque at the floor, clear at the top. */
function fadeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 128);
  }
  return new THREE.CanvasTexture(canvas);
}

export class Overlays {
  readonly group = new THREE.Group();
  private checkpoints: CheckpointMesh[] = [];
  private readonly fade = fadeTexture();
  private readonly pushArrow = arrow(PUSH_COLOR);
  /** Flat arrow on the floor showing where the next push will come from. */
  private readonly pendingArrow = groundArrow(PUSH_COLOR);
  /** The last push stays on screen a little longer than its 0.1 s so students can see it. */
  private shownPush: { forceN: number; directionRad: number } | null = null;
  private pushHold = 0;
  private readonly balance = new THREE.Group();
  private readonly polygon: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly outline: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly comDot: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private readonly comLine: THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial>;
  private time = 0;

  constructor(private readonly reducedMotion: boolean) {
    this.group.add(this.pushArrow, this.pendingArrow, this.balance);
    this.pushArrow.visible = false;
    this.pendingArrow.visible = false;

    const maxPoints = 32;
    const polyGeo = new THREE.BufferGeometry();
    polyGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxPoints * 3), 3));
    polyGeo.setIndex(new THREE.BufferAttribute(new Uint16Array((maxPoints - 2) * 3), 1));
    this.polygon = new THREE.Mesh(
      polyGeo,
      new THREE.MeshBasicMaterial({ color: SAFE_COLOR, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }),
    );
    const outlineGeo = new THREE.BufferGeometry();
    outlineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxPoints * 3), 3));
    this.outline = new THREE.LineLoop(outlineGeo, new THREE.LineBasicMaterial({ color: SAFE_COLOR }));
    this.comDot = new THREE.Mesh(
      new THREE.CircleGeometry(0.045, 24),
      new THREE.MeshBasicMaterial({ color: SAFE_COLOR, depthTest: false }),
    );
    this.comDot.renderOrder = 5;
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);
    this.comLine = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color: '#ffffff', dashSize: 0.05, gapSize: 0.04 }));
    this.polygon.renderOrder = 4;
    this.balance.add(this.polygon, this.outline, this.comDot, this.comLine);
    this.balance.visible = false;
  }

  /** Builds the rings for the arena's checkpoints (hidden until a lesson shows them). */
  buildCheckpoints(markers: CheckpointMarker[], ground: GroundProbe): void {
    for (const c of this.checkpoints) this.disposeCheckpoint(c);
    this.checkpoints = markers.map(({ checkpoint: cp, number }) => {
      const group = new THREE.Group();
      group.position.set(cp.x, cp.y, ground(cp.x, cp.y) + 0.012);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(cp.radius - 0.07, cp.radius, 56),
        new THREE.MeshBasicMaterial({ color: TODO_COLOR, transparent: true, opacity: 0.9, depthWrite: false }),
      );
      const beacon = new THREE.Mesh(
        new THREE.CylinderGeometry(cp.radius, cp.radius, 1.1, 40, 1, true),
        new THREE.MeshBasicMaterial({
          color: NEXT_COLOR,
          alphaMap: this.fade,
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      beacon.rotation.x = Math.PI / 2;
      beacon.position.z = 0.55;
      const label = numberSprite(number);
      label.position.z = 1.3;
      group.add(ring, beacon, label);
      group.visible = false;
      this.group.add(group);
      return { id: cp.id, group, ring, beacon, label };
    });
  }

  /** Shows the lesson's checkpoints: the next one glows, finished ones turn green. */
  setCheckpoints(markers: CheckpointMarker[]): void {
    const byId = new Map(markers.map((m) => [m.checkpoint.id, m]));
    for (const c of this.checkpoints) {
      const m = byId.get(c.id);
      c.group.visible = !!m;
      if (!m) continue;
      c.ring.material.color.copy(m.state === 'next' ? NEXT_COLOR : m.state === 'done' ? DONE_COLOR : TODO_COLOR);
      c.ring.material.opacity = m.state === 'todo' ? 0.55 : 0.95;
      c.beacon.visible = m.state === 'next';
      c.label.visible = m.state !== 'done';
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.pushHold = Math.max(0, this.pushHold - dt);
    if (this.reducedMotion) return;
    const pulse = 0.28 + 0.12 * Math.sin(this.time * 3);
    for (const c of this.checkpoints) if (c.beacon.visible) c.beacon.material.opacity = pulse;
  }

  /**
   * Push arrows point at the robot from the side the push comes from. `directionRad` is the world
   * direction the force points.
   */
  setPush(
    active: { forceN: number; directionRad: number } | null,
    pending: PendingPush | null,
    base: THREE.Vector3,
    groundZ: number,
  ): void {
    if (active) {
      this.shownPush = active;
      this.pushHold = PUSH_HOLD_S;
    }
    placeArrow(this.pushArrow, this.pushHold > 0 ? this.shownPush : null, base);

    this.pendingArrow.visible = !!pending;
    if (pending) {
      const d = pending.directionRad;
      this.pendingArrow.position.set(base.x - Math.cos(d) * 0.45, base.y - Math.sin(d) * 0.45, groundZ + 0.015);
      this.pendingArrow.rotation.set(0, 0, d);
      const material = (this.pendingArrow as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material;
      material.opacity = this.reducedMotion ? 0.7 : 0.55 + 0.3 * Math.sin(this.time * 6);
    }
  }

  /**
   * Balance view. `feet` holds ground-contact points (x, y, z) of every foot touching the floor,
   * `com` the robot's centre of mass.
   */
  setBalance(visible: boolean, com: THREE.Vector3, feet: readonly (readonly [number, number, number])[]): void {
    this.balance.visible = visible;
    if (!visible) return;
    const groundZ = feet.length ? Math.min(...feet.map((p) => p[2])) + 0.006 : com.z - 0.7;
    const hull = convexHull(feet.map((p): Point2 => [p[0], p[1]]));
    const margin = stabilityMargin([com.x, com.y], hull);
    const color = margin >= 0 ? SAFE_COLOR : RISK_COLOR;

    const pos = this.polygon.geometry.getAttribute('position') as THREE.BufferAttribute;
    const linePos = this.outline.geometry.getAttribute('position') as THREE.BufferAttribute;
    const n = Math.min(hull.length, pos.count);
    for (let i = 0; i < n; i++) {
      pos.setXYZ(i, hull[i][0], hull[i][1], groundZ);
      linePos.setXYZ(i, hull[i][0], hull[i][1], groundZ + 0.002);
    }
    const index = this.polygon.geometry.getIndex() as THREE.BufferAttribute;
    const triangles = writeFan(index.array as Uint16Array, n);
    pos.needsUpdate = linePos.needsUpdate = index.needsUpdate = true;
    this.polygon.geometry.setDrawRange(0, triangles * 3);
    this.outline.geometry.setDrawRange(0, n);
    this.polygon.material.color.copy(color);
    this.outline.material.color.copy(color);
    this.polygon.geometry.computeBoundingSphere();
    this.outline.geometry.computeBoundingSphere();

    this.comDot.position.set(com.x, com.y, groundZ + 0.004);
    this.comDot.material.color.copy(color);
    const line = this.comLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    line.setXYZ(0, com.x, com.y, com.z);
    line.setXYZ(1, com.x, com.y, groundZ);
    line.needsUpdate = true;
    this.comLine.geometry.computeBoundingSphere();
    this.comLine.computeLineDistances();
  }

  dispose(): void {
    for (const c of this.checkpoints) this.disposeCheckpoint(c);
    this.fade.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }

  private disposeCheckpoint(c: CheckpointMesh): void {
    this.group.remove(c.group);
    c.ring.geometry.dispose();
    c.ring.material.dispose();
    c.beacon.geometry.dispose();
    c.beacon.material.dispose();
    c.label.material.map?.dispose();
    c.label.material.dispose();
  }
}

/**
 * Triangulates a convex polygon of `n` vertices as a fan from vertex 0: (0, 1, 2), (0, 2, 3), …
 * Writes the indices into `out` and returns the number of triangles.
 */
export function writeFan(out: Uint16Array, n: number): number {
  const triangles = Math.max(0, n - 2);
  for (let i = 0; i < triangles; i++) {
    out[3 * i] = 0;
    out[3 * i + 1] = i + 1;
    out[3 * i + 2] = i + 2;
  }
  return triangles;
}

/** Seconds a push arrow stays visible after the push starts. */
const PUSH_HOLD_S = 0.7;

/**
 * A 3D arrow along +x with its tip at the origin (shaft + cone). Drawn on top of everything, so a
 * push from the far side of the robot is still visible.
 */
function arrow(color: THREE.Color): THREE.Group {
  const material = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 16), material);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = -0.5 - 0.16;
  shaft.name = 'shaft';
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.16, 20), material);
  head.rotation.z = -Math.PI / 2;
  head.position.x = -0.08;
  shaft.renderOrder = head.renderOrder = 20;
  const group = new THREE.Group();
  group.add(shaft, head);
  return group;
}

/**
 * A flat arrow on the floor, 1.6 m long, pointing along +x with its tip at the origin. It is drawn on
 * top of the robot (and outlined in white so it stands out from the red pad markings), because from
 * the chase camera the robot's body hides the floor on the far side.
 */
function groundArrow(color: THREE.Color): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(-0.45, 0.3);
  shape.lineTo(-0.45, 0.11);
  shape.lineTo(-1.6, 0.11);
  shape.lineTo(-1.6, -0.11);
  shape.lineTo(-0.45, -0.11);
  shape.lineTo(-0.45, -0.3);
  shape.closePath();
  const mesh = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false, depthTest: false }),
  );
  mesh.renderOrder = 6;
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(shape.getPoints()),
    new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthTest: false }),
  );
  outline.renderOrder = 7;
  mesh.add(outline);
  mesh.visible = false;
  return mesh;
}

/** Arrow length grows with force: 0.4 m + 1 m per 500 N. */
function placeArrow(group: THREE.Group, push: { forceN: number; directionRad: number } | null, base: THREE.Vector3): void {
  group.visible = !!push;
  if (!push) return;
  const length = 0.4 + push.forceN / 500;
  const shaft = group.getObjectByName('shaft');
  if (shaft) {
    shaft.scale.y = length;
    shaft.position.x = -length / 2 - 0.16;
  }
  // Tip stops just short of the robot's body, on the side the push comes from.
  const gap = 0.3;
  group.position.set(base.x - Math.cos(push.directionRad) * gap, base.y - Math.sin(push.directionRad) * gap, base.z);
  group.rotation.set(0, 0, push.directionRad);
}
