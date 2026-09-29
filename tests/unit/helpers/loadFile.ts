import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { LoadFile } from '../../../src/core/mujoco';

const PUBLIC_DIR = fileURLToPath(new URL('../../../public/', import.meta.url));

/** Node stand-in for the browser's fetch-based loader: reads the same paths from public/. */
export const nodeLoadFile: LoadFile = async (path) => new Uint8Array(await readFile(PUBLIC_DIR + path));
