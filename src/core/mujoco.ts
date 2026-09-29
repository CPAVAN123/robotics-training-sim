/**
 * Loading MuJoCo and compiling the scene (robot MJCF + warehouse arena).
 * Files come from a `loadFile(path)` callback so the same code runs in the browser (fetch) and in Node (fs).
 */
import loadMujocoModule from '@mujoco/mujoco';
import { arenaMjcf } from './arena';
import type { ArenaLayout, MjModel, Mujoco, RobotInfo } from './types';

/** Reads a file by its path relative to the site root, e.g. 'models/g1/g1_12dof.xml'. */
export type LoadFile = (path: string) => Promise<Uint8Array>;
/** Download progress, counted in files. */
export type LoadProgress = (loaded: number, total: number) => void;

let mujocoPromise: Promise<Mujoco> | null = null;

/** Loads the MuJoCo WebAssembly module once; later calls share the same instance. */
export function loadMujoco(): Promise<Mujoco> {
  mujocoPromise ??= loadMujocoModule().catch((err: unknown) => {
    mujocoPromise = null;
    throw err;
  });
  return mujocoPromise;
}

/** Browser `LoadFile`: fetches from the site's base URL, so it works from any sub-path. */
export async function fetchFile(path: string): Promise<Uint8Array> {
  const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
  if (!res.ok) throw new Error(`Could not download ${path} (HTTP ${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

const MESH_ELEMENTS = new Set(['mesh', 'hfield', 'skin']);

/**
 * Files an MJCF file refers to (meshes, textures, includes), as paths relative to the MJCF's folder.
 * Mesh-like assets are looked up in <compiler meshdir>, textures in texturedir, both falling back to assetdir.
 */
export function referencedFiles(mjcf: string): string[] {
  const compiler = /<compiler\b[^>]*>/.exec(mjcf)?.[0] ?? '';
  const dirAttr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(compiler)?.[1];
  const assetDir = dirAttr('assetdir');
  const meshDir = dirAttr('meshdir') ?? assetDir;
  const textureDir = dirAttr('texturedir') ?? assetDir;

  const files = new Set<string>();
  for (const [, element, file] of mjcf.matchAll(/<(\w+)\b[^>]*?\sfile="([^"]+)"/g)) {
    const dir = MESH_ELEMENTS.has(element) ? meshDir : element === 'texture' ? textureDir : undefined;
    files.add(joinPath(dir, file));
  }
  return [...files];
}

/**
 * Downloads the robot's MJCF and every file it references, writes them into MuJoCo's in-memory file
 * system, adds the arena around the robot and compiles the scene. The caller owns (and must delete) the model.
 */
export async function compileScene(
  mujoco: Mujoco,
  robot: RobotInfo,
  arena: ArenaLayout,
  loadFile: LoadFile,
  onProgress?: LoadProgress,
): Promise<MjModel> {
  const modelDir = robot.modelDir.replace(/\/+$/, '');
  const robotXml = await loadFile(`${modelDir}/${robot.mjcf}`);
  const assets = referencedFiles(new TextDecoder().decode(robotXml));
  const total = assets.length + 1;
  let loaded = 1;
  onProgress?.(loaded, total);
  const contents = await Promise.all(
    assets.map(async (file) => {
      const bytes = await loadFile(`${modelDir}/${file}`);
      onProgress?.(++loaded, total);
      return bytes;
    }),
  );

  // Everything lives in one folder per robot: MuJoCo resolves <include> and meshdir relative to scene.xml.
  // The folder name must stay the same on every load, because MuJoCo keeps compiled meshes in a global
  // cache keyed by file path: a new path each time would add another copy of every mesh to the cache
  // (about 50 MB per G1 load, and WebAssembly memory never shrinks), while the same path reuses them.
  const root = `/scene-${robot.id}`;
  const written: string[] = [];
  const write = (file: string, data: Uint8Array | string) => {
    const path = `${root}/${file}`;
    mujoco.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')), 0o777);
    mujoco.FS.writeFile(path, data);
    written.push(path);
  };
  try {
    write(robot.mjcf, robotXml);
    assets.forEach((file, i) => write(file, contents[i]));
    write('scene.xml', sceneXml(robot.mjcf, arena));
    return mujoco.MjModel.from_xml_path(`${root}/scene.xml`);
  } finally {
    // The compiled model holds its own copy of every mesh, so the files can go.
    for (const path of written) mujoco.FS.unlink(path);
    removeEmptyDirs(mujoco, root);
  }
}

function sceneXml(robotFile: string, arena: ArenaLayout): string {
  return `<mujoco model="warehouse">\n  <include file="${robotFile}"/>\n${arenaMjcf(arena)}</mujoco>\n`;
}

function joinPath(dir: string | undefined, file: string): string {
  const path = dir ? `${dir.replace(/\/+$/, '')}/${file}` : file;
  return path.replace(/^\.\//, '').replace(/\/\.\//g, '/');
}

function removeEmptyDirs(mujoco: Mujoco, dir: string): void {
  for (const name of mujoco.FS.readdir(dir) as string[]) {
    if (name !== '.' && name !== '..') removeEmptyDirs(mujoco, `${dir}/${name}`);
  }
  mujoco.FS.rmdir(dir);
}
