/**
 * Procedural polished-concrete texture with a faint 1 m grid, so students can judge distances.
 */
import * as THREE from 'three';

/** Metres covered by one texture tile. */
export const FLOOR_TILE_M = 2;

export function floorTexture(renderer: THREE.WebGLRenderer, base: THREE.Color): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  ctx.fillStyle = `#${base.getHexString(THREE.SRGBColorSpace)}`;
  ctx.fillRect(0, 0, size, size);

  // Speckle and soft blotches like troweled concrete (deterministic, so screenshots are stable).
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const x = rand() * size, y = rand() * size, r = 20 + rand() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const shade = rand() < 0.5 ? '0,0,0' : '255,255,255';
    g.addColorStop(0, `rgba(${shade},0.035)`);
    g.addColorStop(1, `rgba(${shade},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.06)';
    ctx.fillRect(rand() * size, rand() * size, 1.5, 1.5);
  }

  // 1 m grid: expansion joints on the tile edges, lighter lines in the middle.
  ctx.strokeStyle = 'rgba(40,45,55,0.35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(40,45,55,0.16)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(size / 2, 0);
  ctx.lineTo(size / 2, size);
  ctx.moveTo(0, size / 2);
  ctx.lineTo(size, size / 2);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}
