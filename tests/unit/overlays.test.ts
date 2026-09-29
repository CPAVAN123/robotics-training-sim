/**
 * Balance view geometry: the support polygon must actually be filled (it is the green area the push lesson
 * tells students to watch).
 */
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { Overlays, writeFan } from '../../src/render/overlays';

describe('balance view support polygon', () => {
  beforeAll(() => {
    // The overlays draw a few textures on canvases; Node has no DOM, and these tests do not need the pixels.
    const canvas = { width: 0, height: 0, getContext: () => null };
    (globalThis as { document?: unknown }).document ??= { createElement: () => canvas };
  });

  it('triangulates a convex polygon as a fan from its first corner', () => {
    const out = new Uint16Array(12);
    expect(writeFan(out, 4)).toBe(2);
    expect([...out.slice(0, 6)]).toEqual([0, 1, 2, 0, 2, 3]);
    out.fill(0);
    expect(writeFan(out, 6)).toBe(4);
    expect([...out]).toEqual([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5]);
    expect(writeFan(out, 2)).toBe(0);
  });

  /** Total area of the triangles the polygon mesh will draw, in m². */
  function drawnArea(overlays: Overlays): number {
    // The support polygon is the only mesh drawn with a limited index range.
    const meshes: THREE.Mesh[] = [];
    overlays.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry.getIndex() && Number.isFinite(o.geometry.drawRange.count)) meshes.push(o);
    });
    expect(meshes).toHaveLength(1);
    const mesh = meshes[0];
    const index = mesh.geometry.getIndex()!.array;
    const pos = mesh.geometry.getAttribute('position');
    const { start, count } = mesh.geometry.drawRange;
    let area = 0;
    for (let i = start; i < start + count; i += 3) {
      const [a, b, c] = [index[i], index[i + 1], index[i + 2]];
      const abx = pos.getX(b) - pos.getX(a), aby = pos.getY(b) - pos.getY(a);
      const acx = pos.getX(c) - pos.getX(a), acy = pos.getY(c) - pos.getY(a);
      area += Math.abs(abx * acy - aby * acx) / 2;
    }
    return area;
  }

  it('fills the whole polygon for four feet (a standing Go2) and for a hexagon', () => {
    const overlays = new Overlays(true);
    const com = new THREE.Vector3(0, 0, 0.3);
    // Go2-like stance: 0.39 m long, 0.28 m wide.
    const feet: [number, number, number][] = [
      [0.195, 0.14, 0],
      [0.195, -0.14, 0],
      [-0.195, 0.14, 0],
      [-0.195, -0.14, 0],
    ];
    overlays.setBalance(true, com, feet);
    expect(drawnArea(overlays)).toBeCloseTo(0.39 * 0.28, 6);

    const hexagon = Array.from({ length: 6 }, (_, i): [number, number, number] => [
      Math.cos((i * Math.PI) / 3) * 0.1,
      Math.sin((i * Math.PI) / 3) * 0.1,
      0,
    ]);
    overlays.setBalance(true, com, hexagon);
    expect(drawnArea(overlays)).toBeCloseTo(((3 * Math.sqrt(3)) / 2) * 0.1 ** 2, 6);
  });
});
