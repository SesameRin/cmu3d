// Terrain height lookup decoded from CAMPUS_DATA.terrain. Pure JS, no THREE dependency.
// World axes: x = metres east, z = metres south, y = metres above data.terrain.baseElevation.

export function createHeightfield(terrain) {
  const { width: W, height: H, cellSize: C, minX, minZ } = terrain;
  const bin = atob(terrain.heights);
  const offset = terrain.heightOffset || 0; // stored values are shifted up so terrain below y = 0 fits in uint16
  const heights = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    heights[i] = (bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) / 100 - offset;
  }
  const maxX = minX + (W - 1) * C;
  const maxZ = minZ + (H - 1) * C;

  // Bilinear height at world (x, z); clamps to the data edge.
  function heightAt(x, z) {
    let fx = (x - minX) / C, fz = (z - minZ) / C;
    if (fx < 0) fx = 0; else if (fx > W - 1.0001) fx = W - 1.0001;
    if (fz < 0) fz = 0; else if (fz > H - 1.0001) fz = H - 1.0001;
    const i = fx | 0, j = fz | 0, dx = fx - i, dz = fz - j;
    const k = j * W + i;
    const a = heights[k], b = heights[k + 1], c = heights[k + W], d = heights[k + W + 1];
    return (a * (1 - dx) + b * dx) * (1 - dz) + (c * (1 - dx) + d * dx) * dz;
  }

  // Unit surface normal as [nx, ny, nz] (or written into `out` if it has x/y/z or is an array).
  function normalAt(x, z, out) {
    const e = C * 0.5;
    const hx = heightAt(x + e, z) - heightAt(x - e, z);
    const hz = heightAt(x, z + e) - heightAt(x, z - e);
    let nx = -hx, ny = 2 * e, nz = -hz;
    const l = Math.hypot(nx, ny, nz);
    nx /= l; ny /= l; nz /= l;
    if (out && 'x' in out) { out.x = nx; out.y = ny; out.z = nz; return out; }
    if (Array.isArray(out)) { out[0] = nx; out[1] = ny; out[2] = nz; return out; }
    return [nx, ny, nz];
  }

  // Slope in degrees at (x, z)
  function slopeAt(x, z) {
    const n = normalAt(x, z);
    return Math.acos(Math.min(1, n[1])) * 180 / Math.PI;
  }

  // Min / max / mean terrain height sampled over a polygon ring [[x,z],...] (vertices + interior grid)
  function statsOverRing(ring, step = 4) {
    let min = Infinity, max = -Infinity, sum = 0, n = 0;
    const add = (x, z) => { const h = heightAt(x, z); if (h < min) min = h; if (h > max) max = h; sum += h; n++; };
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of ring) { add(x, z); x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) {
      if (pointInRing(x, z, ring)) add(x, z);
    }
    return { min, max, mean: sum / n };
  }

  return { heights, width: W, height: H, cellSize: C, minX, minZ, maxX, maxZ, heightAt, normalAt, slopeAt, statsOverRing };
}

export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
