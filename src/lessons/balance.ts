/**
 * Static balance geometry: the support polygon (the smallest convex shape around every point where
 * the feet touch the ground) and where the centre of mass sits relative to it.
 */

export type Point2 = readonly [number, number];

/** Convex hull, counter-clockwise, without collinear points (Andrew's monotone chain). */
export function convexHull(points: readonly Point2[]): Point2[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return dedupe(pts);
  const cross = (o: Point2, a: Point2, b: Point2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-12) lower.pop();
    lower.push(p);
  }
  const upper: Point2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-12) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return dedupe(lower.concat(upper));
}

/**
 * Signed distance from `p` to the edge of a convex counter-clockwise polygon: positive inside
 * (how far the centre of mass could move before leaving it), negative outside.
 * A polygon with one or two points (a single foot point, or two diagonal feet) has no inside,
 * so the result is minus the distance to that point or segment.
 */
export function stabilityMargin(p: Point2, hull: readonly Point2[]): number {
  if (hull.length === 0) return -Infinity;
  if (hull.length === 1) return -Math.hypot(p[0] - hull[0][0], p[1] - hull[0][1]);
  if (hull.length === 2) return -segmentDistance(p, hull[0], hull[1]);
  let inside = true;
  let nearest = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    if (ex * (p[1] - a[1]) - ey * (p[0] - a[0]) < 0) inside = false;
    nearest = Math.min(nearest, segmentDistance(p, a, b));
  }
  return inside ? nearest : -nearest;
}

function segmentDistance(p: Point2, a: Point2, b: Point2): number {
  const ex = b[0] - a[0], ey = b[1] - a[1];
  const len2 = ex * ex + ey * ey;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / len2));
  return Math.hypot(p[0] - (a[0] + t * ex), p[1] - (a[1] + t * ey));
}

function dedupe(points: Point2[]): Point2[] {
  return points.filter((p, i) => points.findIndex((q) => Math.abs(q[0] - p[0]) < 1e-9 && Math.abs(q[1] - p[1]) < 1e-9) === i);
}
