// Height of the terrain as it is RENDERED, everywhere the cameras can go.
//
// ctx.heightAt only knows the data grid and clamps to its edge values outside it. The terrain module continues
// the ground beyond the grid with a skirt of concentric rings blending into synthetic hills (up to ~45 m above
// the clamped edge value), so a camera using heightAt out there flies into the visible hills and ray picks go
// far behind the surface that was clicked. Outside the grid this looks the height up on the skirt mesh's own
// triangles (exact: the skirt is coarse, so terrain.extHeightAt alone is off by up to ~7 m between its
// vertices), falling back to terrain.extHeightAt, then to the clamped heightAt.
//
// The triangle index (~11k triangles, a few ms) is built in an idle moment after loading (warm()) or else on the
// first query outside the grid; a query is a bucket lookup plus a few barycentric tests. Inside the grid it is
// ctx.heightAt, unchanged.
import * as THREE from 'three';

const CELL = 96;   // m — bucket size of the skirt triangle index

export function createSurface(ctx, bounds) {
  const base = ctx.heightAt;
  const hf = ctx.heightfield;
  const gx0 = hf?.minX ?? bounds.minX, gz0 = hf?.minZ ?? bounds.minZ;
  const gx1 = hf?.maxX ?? bounds.maxX, gz1 = hf?.maxZ ?? bounds.maxZ;
  const inGrid = (x, z) => x >= gx0 && x <= gx1 && z >= gz0 && z <= gz1;

  let idx = null;   // { ok, pos (x,y,z per vertex), tri (vertex indices), start, list, minX, minZ, nx, nz }
  function build() {
    const mesh = ctx.terrain?.mesh?.getObjectByName?.('terrain-skirt');
    const g = mesh?.geometry;
    const P = g?.attributes?.position;
    // (no terrain yet: try again on a later query; a terrain without a skirt: give up for good)
    idx = ctx.terrain ? { ok: false } : null;
    if (!P || !P.count) return;
    try {
      mesh.updateWorldMatrix(true, false);
      const m = mesh.matrixWorld;
      const pos = new Float32Array(P.count * 3);
      const v = new THREE.Vector3();
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(m);
        pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
        if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
        if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
      }
      const tri = g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({ length: P.count }, (_, i) => i);
      const nT = Math.floor(tri.length / 3);
      const nx = Math.max(1, Math.ceil((maxX - minX) / CELL)), nz = Math.max(1, Math.ceil((maxZ - minZ) / CELL));
      const cellRange = (t, out) => {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let k = 0; k < 3; k++) {
          const a = tri[t * 3 + k] * 3;
          if (pos[a] < x0) x0 = pos[a]; if (pos[a] > x1) x1 = pos[a];
          if (pos[a + 2] < z0) z0 = pos[a + 2]; if (pos[a + 2] > z1) z1 = pos[a + 2];
        }
        out[0] = Math.max(0, Math.floor((x0 - minX) / CELL)); out[1] = Math.min(nx - 1, Math.floor((x1 - minX) / CELL));
        out[2] = Math.max(0, Math.floor((z0 - minZ) / CELL)); out[3] = Math.min(nz - 1, Math.floor((z1 - minZ) / CELL));
        return out;
      };
      // two passes (count, fill) into one flat list per cell
      const start = new Uint32Array(nx * nz + 1);
      const r = [0, 0, 0, 0];
      for (let t = 0; t < nT; t++) {
        cellRange(t, r);
        for (let j = r[2]; j <= r[3]; j++) for (let i = r[0]; i <= r[1]; i++) start[j * nx + i + 1]++;
      }
      for (let c = 0; c < nx * nz; c++) start[c + 1] += start[c];
      const fill = start.slice(0, nx * nz);
      const list = new Uint32Array(start[nx * nz]);
      for (let t = 0; t < nT; t++) {
        cellRange(t, r);
        for (let j = r[2]; j <= r[3]; j++) for (let i = r[0]; i <= r[1]; i++) list[fill[j * nx + i]++] = t;
      }
      idx = { ok: true, pos, tri, start, list, minX, minZ, nx, nz };
    } catch (err) {
      console.warn('[controls] skirt height index failed', err);
      idx = { ok: false };
    }
  }

  // Height of the skirt surface at (x, z), or null where the skirt doesn't cover.
  function skirtAt(x, z) {
    if (!idx) build();
    if (!idx?.ok) return null;
    const i = Math.floor((x - idx.minX) / CELL), j = Math.floor((z - idx.minZ) / CELL);
    if (i < 0 || j < 0 || i >= idx.nx || j >= idx.nz) return null;
    const { pos, tri, start, list } = idx;
    const c = j * idx.nx + i;
    for (let k = start[c]; k < start[c + 1]; k++) {
      const t = list[k] * 3;
      const a = tri[t] * 3, b = tri[t + 1] * 3, d = tri[t + 2] * 3;
      const ax = pos[a], az = pos[a + 2];
      const e1x = pos[b] - ax, e1z = pos[b + 2] - az, e2x = pos[d] - ax, e2z = pos[d + 2] - az;
      const det = e1x * e2z - e2x * e1z;
      if (Math.abs(det) < 1e-9) continue;
      const px = x - ax, pz = z - az;
      const u = (px * e2z - e2x * pz) / det, w = (e1x * pz - px * e1z) / det;
      if (u < -1e-6 || w < -1e-6 || u + w > 1 + 1e-6) continue;
      return pos[a + 1] + (pos[b + 1] - pos[a + 1]) * u + (pos[d + 1] - pos[a + 1]) * w;
    }
    return null;
  }

  function heightAt(x, z) {
    if (inGrid(x, z)) return base(x, z);
    const y = skirtAt(x, z);
    if (y !== null) return y;
    const ext = ctx.terrain?.extHeightAt;
    return ext ? ext(x, z) : base(x, z);
  }

  // Build the triangle index ahead of time (idle moment after loading) instead of on the first query out there.
  function warm() { if (!idx) build(); }

  return { heightAt, inGrid, warm };
}
