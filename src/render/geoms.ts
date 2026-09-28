/**
 * three.js geometry and materials built from the compiled MuJoCo model (sizes, colours and mesh data
 * all come from the model, so any MJCF renders without extra assets).
 */
import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MjModel, Mujoco } from '../core/types';

/** Faces meeting at less than this angle are shaded smoothly; sharper edges stay crisp. */
const CREASE_ANGLE = (35 * Math.PI) / 180;
const DEFAULT_RGBA = [0.5, 0.5, 0.5, 1];

export interface GeomInfo {
  id: number;
  body: number;
  type: number;
  /** World body (arena) geoms never move. */
  isStatic: boolean;
  isPlane: boolean;
}

/**
 * Which geoms to draw. Robot MJCFs often carry each part twice: a detailed visual mesh (contype =
 * conaffinity = 0, in its own group: G1 group 1, Go2 group 2) and a simpler collision shape (G1 group 0,
 * Go2 group 3). Draw the visual geoms of a body when it has any, otherwise its collision geoms.
 * Everything on the world body (the arena, including non-colliding floor paint) is always drawn.
 */
export function selectGeoms(mujoco: Mujoco, model: MjModel): GeomInfo[] {
  const bodyOf = model.geom_bodyid as Int32Array;
  const contype = model.geom_contype as Int32Array;
  const conaffinity = model.geom_conaffinity as Int32Array;
  const rgba = model.geom_rgba as Float32Array;
  const types = model.geom_type as Int32Array;
  const planeType = mujoco.mjtGeom.mjGEOM_PLANE.value;
  const isVisual = (g: number) => contype[g] === 0 && conaffinity[g] === 0;
  const bodyHasVisual = new Set<number>();
  for (let g = 0; g < model.ngeom; g++) if (bodyOf[g] !== 0 && isVisual(g)) bodyHasVisual.add(bodyOf[g]);

  const out: GeomInfo[] = [];
  for (let g = 0; g < model.ngeom; g++) {
    const body = bodyOf[g];
    if (rgba[4 * g + 3] === 0) continue;
    if (body !== 0 && bodyHasVisual.has(body) !== isVisual(g)) continue;
    out.push({ id: g, body, type: types[g], isStatic: body === 0, isPlane: types[g] === planeType });
  }
  return out;
}

/** Geometry for one geom, in the geom's own frame (MuJoCo z-up). Mesh geometries are cached per mesh. */
export function geomGeometry(
  mujoco: Mujoco,
  model: MjModel,
  g: number,
  meshCache: Map<number, THREE.BufferGeometry>,
): THREE.BufferGeometry | null {
  const t = mujoco.mjtGeom;
  const size = (model.geom_size as Float64Array).subarray(3 * g, 3 * g + 3);
  const type = (model.geom_type as Int32Array)[g];
  switch (type) {
    case t.mjGEOM_PLANE.value: {
      // A zero plane size means "infinite": draw a generous square.
      const w = size[0] > 0 ? 2 * size[0] : 100;
      const h = size[1] > 0 ? 2 * size[1] : 100;
      return new THREE.PlaneGeometry(w, h);
    }
    case t.mjGEOM_SPHERE.value:
      return new THREE.SphereGeometry(size[0], 24, 16);
    case t.mjGEOM_ELLIPSOID.value: {
      const geo = new THREE.SphereGeometry(1, 24, 16);
      geo.scale(size[0], size[1], size[2]);
      return geo;
    }
    case t.mjGEOM_CAPSULE.value: {
      const geo = new THREE.CapsuleGeometry(size[0], 2 * size[1], 8, 20);
      geo.rotateX(Math.PI / 2);
      return geo;
    }
    case t.mjGEOM_CYLINDER.value: {
      const geo = new THREE.CylinderGeometry(size[0], size[0], 2 * size[1], 28);
      geo.rotateX(Math.PI / 2);
      return geo;
    }
    case t.mjGEOM_BOX.value:
      return new THREE.BoxGeometry(2 * size[0], 2 * size[1], 2 * size[2]);
    case t.mjGEOM_MESH.value: {
      const mesh = (model.geom_dataid as Int32Array)[g];
      if (mesh < 0) return null;
      let geo = meshCache.get(mesh);
      if (!geo) {
        geo = meshGeometry(model, mesh);
        meshCache.set(mesh, geo);
      }
      return geo;
    }
    default:
      return null;
  }
}

/** Triangles from mesh_vert / mesh_face, with normals smoothed except across sharp creases. */
function meshGeometry(model: MjModel, mesh: number): THREE.BufferGeometry {
  const vertAdr = (model.mesh_vertadr as Int32Array)[mesh];
  const vertNum = (model.mesh_vertnum as Int32Array)[mesh];
  const faceAdr = (model.mesh_faceadr as Int32Array)[mesh];
  const faceNum = (model.mesh_facenum as Int32Array)[mesh];
  const verts = Float32Array.from((model.mesh_vert as Float32Array).subarray(3 * vertAdr, 3 * (vertAdr + vertNum)));
  const faces = Uint32Array.from((model.mesh_face as Int32Array).subarray(3 * faceAdr, 3 * (faceAdr + faceNum)));
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  indexed.setIndex(new THREE.BufferAttribute(faces, 1));
  const creased = toCreasedNormals(indexed, CREASE_ANGLE);
  // Creasing un-shares every vertex; share them again wherever position and normal agree (about 3x fewer).
  const geo = mergeVertices(creased, 1e-5);
  indexed.dispose();
  creased.dispose();
  geo.computeBoundingSphere();
  return geo;
}

/** RGBA of a geom: its own colour, or its material's when the geom colour was left at MuJoCo's default. */
export function geomRgba(model: MjModel, g: number): [number, number, number, number] {
  const rgba = (model.geom_rgba as Float32Array).subarray(4 * g, 4 * g + 4);
  const mat = (model.geom_matid as Int32Array)[g];
  const isDefault = rgba.every((v, i) => Math.abs(v - DEFAULT_RGBA[i]) < 1e-6);
  const src = mat >= 0 && isDefault ? (model.mat_rgba as Float32Array).subarray(4 * mat, 4 * mat + 4) : rgba;
  return [src[0], src[1], src[2], src[3]];
}

/**
 * A PBR material for a geom colour. Robots get a slightly glossy finish, the warehouse a matte one.
 * Pure black parts are lifted a little so their shape still reads under the lights.
 */
export function makeMaterial(rgba: readonly number[], robot: boolean): THREE.MeshStandardMaterial {
  const lift = (v: number) => (robot ? 0.045 + v * 0.955 : v);
  const color = new THREE.Color().setRGB(lift(rgba[0]), lift(rgba[1]), lift(rgba[2]), THREE.SRGBColorSpace);
  const dark = rgba[0] + rgba[1] + rgba[2] < 0.9;
  return new THREE.MeshStandardMaterial({
    color,
    roughness: robot ? (dark ? 0.45 : 0.38) : 0.85,
    metalness: robot ? (dark ? 0.1 : 0.35) : 0.02,
    transparent: rgba[3] < 1,
    opacity: rgba[3],
  });
}

const tmp = new THREE.Matrix4();

/** Copies geom_xpos / geom_xmat (row-major 3x3) of geom `g` into an object's matrix. */
export function applyGeomPose(object: THREE.Object3D, xpos: Float64Array, xmat: Float64Array, g: number): void {
  const p = 3 * g;
  const r = 9 * g;
  tmp.set(
    xmat[r], xmat[r + 1], xmat[r + 2], xpos[p],
    xmat[r + 3], xmat[r + 4], xmat[r + 5], xpos[p + 1],
    xmat[r + 6], xmat[r + 7], xmat[r + 8], xpos[p + 2],
    0, 0, 0, 1,
  );
  object.matrix.copy(tmp);
  object.matrixWorldNeedsUpdate = true;
}
