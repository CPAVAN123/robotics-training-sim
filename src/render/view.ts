/**
 * The 3D view: a three.js scene built from the compiled MuJoCo model, updated every frame from
 * data.geom_xpos / data.geom_xmat, with warehouse lighting, shadows and the teaching overlays.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { SimulationApi } from '../core/types';
import type { LessonView } from '../lessons/types';
import { CameraRig } from './camera';
import { FLOOR_TILE_M, floorTexture } from './floor';
import { applyGeomPose, geomGeometry, geomRgba, makeMaterial, selectGeoms } from './geoms';
import { Overlays } from './overlays';
import { QUALITY_LEVELS, QualityGovernor } from './quality';

/** Pixels of the canvas covered by UI panels on each side. */
export interface ScreenInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const SHADOW_EXTENT = 9;

interface SceneModel {
  sim: SimulationApi;
  root: THREE.Group;
  dynamic: { object: THREE.Object3D; geom: number }[];
  statics: THREE.Object3D[];
  /** Walls and racks, which fade out when they hide the robot from the camera. */
  occluders: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[];
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  textures: THREE.Texture[];
  baseBody: number;
  /** Ground-contact geoms of each foot. */
  feet: { geoms: number[] }[];
}

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly overlays: Overlays;
  balanceVisible = false;
  private readonly sun: THREE.DirectionalLight;
  private current: SceneModel | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly base = new THREE.Vector3();
  private readonly com = new THREE.Vector3();
  private readonly resizeObserver: ResizeObserver;
  private readonly footPoints: [number, number, number][] = [];
  private envMap: THREE.Texture | null = null;
  private insets: ScreenInsets = { left: 0, right: 0, top: 0, bottom: 0 };
  private showcase = false;
  private readonly quality = new QualityGovernor();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly reducedMotion: boolean,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.background = new THREE.Color('#dfe6ee');
    this.scene.fog = new THREE.Fog('#dfe6ee', 28, 70);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.envMap = pmrem.fromScene(room, 0.04).texture;
    room.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    pmrem.dispose();
    this.scene.environmentIntensity = 0.45;

    // Warehouse lighting: bright sky-lights from above plus a low sun through high windows for shadows.
    this.scene.add(new THREE.HemisphereLight('#f4f8ff', '#8a8f96', 1.1));
    this.sun = new THREE.DirectionalLight('#fff6e8', 2.2);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -SHADOW_EXTENT;
    cam.right = cam.top = SHADOW_EXTENT;
    cam.near = 1;
    cam.far = 40;
    this.sun.shadow.radius = 3;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    this.addCeilingLights();

    this.rig = new CameraRig(canvas, reducedMotion);
    this.overlays = new Overlays(reducedMotion);
    this.scene.add(this.overlays.group);

    this.applyQuality();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  /** Current graphics quality level (0 = fastest), for tests and diagnostics. */
  get qualityLevel(): number {
    return this.quality.level;
  }

  /** Replaces the scene with a newly loaded simulation. */
  load(sim: SimulationApi): void {
    this.unload();
    const { mujoco, model } = sim;
    const root = new THREE.Group();
    root.matrixAutoUpdate = false;
    const meshCache = new Map<number, THREE.BufferGeometry>();
    const materialCache = new Map<string, THREE.MeshStandardMaterial>();
    const scene: SceneModel = {
      sim,
      root,
      dynamic: [],
      statics: [],
      occluders: [],
      geometries: new Set(),
      materials: new Set(),
      textures: [],
      baseBody: mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, sim.robot.baseBody),
      feet: this.footGeoms(sim),
    };

    const xpos = sim.data.geom_xpos as Float64Array;
    const xmat = sim.data.geom_xmat as Float64Array;
    for (const info of selectGeoms(mujoco, model)) {
      const geometry = geomGeometry(mujoco, model, info.id, meshCache);
      if (!geometry) continue;
      const rgba = geomRgba(model, info.id);
      const name = info.isStatic ? mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_GEOM.value, info.id) ?? '' : '';
      const paint = name.startsWith('paint_');
      const occluder = /^(wall|rack)_/.test(name);
      let material: THREE.MeshStandardMaterial;
      if (info.isPlane) {
        material = this.floorMaterial(rgba, geometry, scene);
      } else {
        const key = `${paint ? 'p' : info.isStatic ? 's' : 'r'}${rgba.map((v) => v.toFixed(3)).join(',')}`;
        material = materialCache.get(key) ?? makeMaterial(rgba, !info.isStatic);
        materialCache.set(key, material);
        if (paint) {
          // Floor paint is 2 mm thick: pull it forward in depth so it never flickers against the floor.
          material.polygonOffset = true;
          material.polygonOffsetFactor = -2;
          material.polygonOffsetUnits = -2;
        }
      }
      // Occluders get their own material so each can fade independently.
      if (occluder) material = material.clone();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.matrixAutoUpdate = false;
      if (occluder) scene.occluders.push(mesh);
      mesh.castShadow = !info.isPlane && !paint;
      mesh.receiveShadow = true;
      applyGeomPose(mesh, xpos, xmat, info.id);
      root.add(mesh);
      scene.geometries.add(geometry);
      scene.materials.add(material);
      if (info.isStatic) scene.statics.push(mesh);
      else scene.dynamic.push({ object: mesh, geom: info.id });
    }
    this.scene.add(root);
    root.updateMatrixWorld(true);
    this.current = scene;

    this.overlays.buildCheckpoints(
      sim.arena.checkpoints.map((checkpoint, i) => ({ checkpoint, number: i + 1, state: 'todo' })),
      (x, y) => this.groundHeight(x, y),
    );
    this.frameRobot();
  }

  /** Puts the camera behind the robot (driving) or in front of it (home-screen showcase). */
  frameRobot(): void {
    const s = this.current;
    if (!s) return;
    this.readBase();
    const humanoid = s.sim.robot.kind === 'humanoid';
    const heading = s.sim.getState().heading;
    if (this.showcase) this.rig.frame(this.base, heading + Math.PI - 0.7, humanoid ? 3.4 : 2.0, humanoid ? 0.5 : 0.35);
    else this.rig.frame(this.base, heading, humanoid ? 3.2 : 2.2, humanoid ? 1.9 : 1.1);
  }

  /** Call after the robot is teleported (reset) so the camera doesn't sweep across the hall. */
  snapCamera(): void {
    if (!this.current) return;
    this.readBase();
    this.rig.snap(this.base);
  }

  /** Syncs the scene with the physics and draws a frame. `dt` is wall-clock seconds. */
  render(dt: number, lesson: LessonView | null, heading: number, footContacts: readonly boolean[]): void {
    if (this.quality.frame(dt)) this.applyQuality();
    const s = this.current;
    if (s) {
      const xpos = s.sim.data.geom_xpos as Float64Array;
      const xmat = s.sim.data.geom_xmat as Float64Array;
      for (const { object, geom } of s.dynamic) applyGeomPose(object, xpos, xmat, geom);
      this.readBase();
      this.rig.update(dt, this.base, heading);
      this.fadeOccluders(s, dt);
      this.sun.position.set(this.base.x - 6, this.base.y - 8, 14);
      this.sun.target.position.set(this.base.x, this.base.y, 0);
      this.overlays.update(dt);
      const pending = lesson?.pendingPush ?? null;
      this.overlays.setPush(s.sim.activePush, pending, this.base, pending ? this.groundHeight(this.base.x, this.base.y) : 0);
      const showBalance = this.balanceVisible;
      if (showBalance) this.updateBalance(s, footContacts);
      else this.overlays.setBalance(false, this.com, []);
    }
    this.renderer.render(this.scene, this.rig.camera);
  }

  /**
   * Keeps the robot centred in the part of the screen not covered by panels, and switches the
   * home-screen showcase orbit on or off.
   */
  setLayout(insets: ScreenInsets, showcase: boolean): void {
    this.insets = insets;
    const changed = showcase !== this.showcase;
    this.showcase = showcase;
    this.rig.setShowcase(showcase, this.reducedMotion);
    this.resize();
    if (changed) this.frameRobot();
  }

  /** Floor height under a point, from the static arena geometry (ramps included). */
  groundHeight(x: number, y: number): number {
    if (!this.current) return 0;
    this.raycaster.set(new THREE.Vector3(x, y, 5), new THREE.Vector3(0, 0, -1));
    const hit = this.raycaster.intersectObjects(this.current.statics, false)[0];
    return hit ? hit.point.z : 0;
  }

  resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.rig.resize(w, h);
    const { left, right, top, bottom } = this.insets;
    const camera = this.rig.camera;
    const shiftX = w > left + right + 200 ? (left - right) / 2 : 0;
    // A panel along the bottom (portrait tablets): zoom out so the scene fits the strip above it.
    const shiftUp = bottom > 0 && bottom < h - 150 ? bottom / 2 : 0;
    camera.zoom = (h - 2 * shiftUp) / h;
    // The lesson's top bar: move the picture down so what lies ahead (checkpoint numbers) isn't under it.
    const shiftY = shiftUp - (top > 0 && top < h / 3 ? top / 2 : 0);
    if (shiftX !== 0 || shiftY !== 0) camera.setViewOffset(w, h, -shiftX, shiftY, w, h);
    else camera.clearViewOffset();
  }

  dispose(): void {
    this.unload();
    this.resizeObserver.disconnect();
    this.overlays.dispose();
    this.rig.dispose();
    this.envMap?.dispose();
    this.renderer.dispose();
  }

  private unload(): void {
    const s = this.current;
    if (!s) return;
    this.scene.remove(s.root);
    for (const g of s.geometries) g.dispose();
    for (const m of s.materials) m.dispose();
    for (const t of s.textures) t.dispose();
    this.current = null;
  }

  /** Applies the governor's quality level: resolution, shadows and reflections. */
  private applyQuality(): void {
    const q = QUALITY_LEVELS[this.quality.level];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    const shadows = q.shadowMapSize > 0;
    const lightingChanged = this.renderer.shadowMap.enabled !== shadows || (this.scene.environment !== null) !== q.environment;
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    if (shadows && this.sun.shadow.mapSize.x !== q.shadowMapSize) {
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.scene.environment = q.environment ? this.envMap : null;
    // Materials compile different shaders with and without shadows and reflections.
    if (lightingChanged) {
      this.scene.traverse((o) => {
        if (o instanceof THREE.Mesh) (o.material as THREE.Material).needsUpdate = true;
      });
    }
    this.resize();
  }

  /** Walls and racks between the camera and the robot turn see-through so the robot never disappears. */
  private fadeOccluders(s: SceneModel, dt: number): void {
    const cam = this.rig.camera.position;
    const toCamera = new THREE.Vector3().subVectors(cam, this.base);
    const distance = toCamera.length();
    this.raycaster.set(this.base, toCamera.normalize());
    this.raycaster.far = distance;
    const hits = new Set(this.raycaster.intersectObjects(s.occluders, false).map((hit) => hit.object));
    this.raycaster.far = Infinity;
    const k = 1 - Math.exp(-dt * 10);
    for (const mesh of s.occluders) {
      const m = mesh.material;
      const target = hits.has(mesh) ? 0.22 : 1;
      m.opacity += (target - m.opacity) * k;
      if (Math.abs(m.opacity - target) < 0.01) m.opacity = target;
      const transparent = m.opacity < 1;
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.depthWrite = !transparent;
        m.needsUpdate = true;
      }
    }
  }

  private readBase(): void {
    const s = this.current;
    if (!s) return;
    const xpos = s.sim.data.xpos as Float64Array;
    const b = 3 * s.baseBody;
    this.base.set(xpos[b], xpos[b + 1], xpos[b + 2]);
  }

  private updateBalance(s: SceneModel, footContacts: readonly boolean[]): void {
    const com = s.sim.data.subtree_com as Float64Array;
    const b = 3 * s.baseBody;
    this.com.set(com[b], com[b + 1], com[b + 2]);
    const xpos = s.sim.data.geom_xpos as Float64Array;
    this.footPoints.length = 0;
    s.feet.forEach((foot, i) => {
      if (!footContacts[i]) return;
      // Soft contacts let feet sink a centimetre or so into the floor, so the polygon is laid on the floor
      // itself; drawn at the feet's depth it would be hidden under it.
      foot.geoms.forEach((g) => {
        const [x, y] = [xpos[3 * g], xpos[3 * g + 1]];
        this.footPoints.push([x, y, this.groundHeight(x, y)]);
      });
    });
    this.overlays.setBalance(true, this.com, this.footPoints);
  }

  /** For each foot: its named geom, or the collision spheres of the named body (G1's sole corners). */
  private footGeoms(sim: SimulationApi): SceneModel['feet'] {
    const { mujoco, model } = sim;
    const bodyOf = model.geom_bodyid as Int32Array;
    const types = model.geom_type as Int32Array;
    const contype = model.geom_contype as Int32Array;
    const sphere = mujoco.mjtGeom.mjGEOM_SPHERE.value;
    return sim.robot.feet.map((name) => {
      const geom = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_GEOM.value, name);
      if (geom >= 0) return { geoms: [geom] };
      const body = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, name);
      const geoms: number[] = [];
      for (let g = 0; g < model.ngeom; g++) if (bodyOf[g] === body && types[g] === sphere && contype[g] !== 0) geoms.push(g);
      return { geoms };
    });
  }

  private floorMaterial(rgba: readonly number[], geometry: THREE.BufferGeometry, scene: SceneModel): THREE.MeshStandardMaterial {
    const base = new THREE.Color().setRGB(rgba[0], rgba[1], rgba[2], THREE.SRGBColorSpace);
    const map = floorTexture(this.renderer, base);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (box) map.repeat.set((box.max.x - box.min.x) / FLOOR_TILE_M, (box.max.y - box.min.y) / FLOOR_TILE_M);
    scene.textures.push(map);
    return new THREE.MeshStandardMaterial({ map, roughness: 0.62, metalness: 0 });
  }

  /** Rows of long ceiling light panels: purely visual, they make the space read as an indoor hall. */
  private addCeilingLights(): void {
    const panel = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const geo = new THREE.BoxGeometry(6, 0.35, 0.08);
    for (const x of [-10, 0, 10]) {
      for (const y of [-6, 0, 6]) {
        const m = new THREE.Mesh(geo, panel);
        m.position.set(x, y, 9);
        this.scene.add(m);
      }
    }
  }
}
