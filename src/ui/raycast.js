// First-hit raycasting over the ctx.pick objects, fast enough for hover picking at eye level.
//  1. Meshes are sorted by where the ray enters their world bounding sphere and tested nearest-first; the
//     search stops as soon as the best hit is nearer than the next sphere.
//  2. Big static meshes (merged building chunks, landmark parts) get a 2D triangle grid in their local XZ plane,
//     built in idle-time slices after start-up (nearest first); the ray walks the grid cells in order (DDA) and
//     only tests the triangles it passes over, stopping at the first cell that contains a hit. Until its grid
//     exists a mesh uses three's raycast (and jumps the build queue). Small / animated / instanced objects always do.
// Intersections look like three's ({ distance, point, object, face:{a,b,c,normal,materialIndex}, faceIndex }), so
// ctx.pick resolvers work unchanged. Semantics match raycaster.intersectObjects(ctx.pick.objects(), true)[0].
import * as THREE from 'three';

const caches = new WeakMap();
const grids = new WeakMap();            // geometry → triangle grid (or false: not suitable)
const GRID_MIN_TRIS = 2500;
const BIG_TRI_CELLS = 256;              // triangles spanning more cells than this go to an always-tested list

const sphere = new THREE.Sphere();
const oc = new THREE.Vector3();
const scratch = [];
const order = [];
const inv = new THREE.Matrix4();
const lray = new THREE.Ray();
const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
const hitL = new THREE.Vector3(), hitW = new THREE.Vector3();
const tri = new THREE.Triangle();
export const gridStats = { builds: 0, tris: 0, ms: 0, maxMs: 0 };
const stats = gridStats;

function flatten(ctx) {
  const pick = ctx.pick;
  let c = caches.get(pick);
  const size = pick.items?.size ?? -1;
  const now = performance.now();
  if (c && c.size === size && now - c.t < 3000) return c;
  const roots = [];
  for (const root of pick.items?.keys?.() || []) {
    const meshes = [];
    root.traverse?.((o) => { if (o.raycast !== THREE.Object3D.prototype.raycast) meshes.push(o); });
    roots.push({ root, meshes });
  }
  c = { size, t: now, roots };
  caches.set(pick, c);
  return c;
}

function entryDistance(ray, s) {
  oc.subVectors(s.center, ray.origin);
  const tca = oc.dot(ray.direction);
  const d2 = oc.lengthSq() - tca * tca;
  const r2 = s.radius * s.radius;
  if (d2 > r2) return Infinity;
  const thc = Math.sqrt(r2 - d2);
  if (tca + thc < 0) return Infinity;
  return Math.max(0, tca - thc);
}

// ---------------------------------------------------------------- triangle grid
function drawRangeOf(geom) {
  const n = geom.index ? geom.index.count : geom.attributes.position.count;
  const s = Math.max(0, geom.drawRange.start);
  const e = Math.min(n, geom.drawRange.start + geom.drawRange.count);
  return [s, e];
}
/**
 * The mesh's triangle grid if it is built and current, `false` if the mesh doesn't get one (small, instanced,
 * skinned, morphed), or `undefined` if one still has to be built.
 */
function gridState(mesh) {
  const geom = mesh.geometry;
  if (!geom) return false;
  const g = grids.get(geom);
  if (g === false) return false;
  // reuse unless the geometry was edited since (new / updated position or index buffers)
  if (g && g.pos === geom.attributes.position && g.ver === g.pos.version && g.idx === geom.index) return g;
  const pos = geom.attributes?.position;
  let ok = false;
  if (mesh.isMesh && !mesh.isInstancedMesh && !mesh.isSkinnedMesh && pos && !Object.keys(geom.morphAttributes || {}).length) {
    const [s, e] = drawRangeOf(geom);
    ok = Math.floor(e / 3) - Math.ceil(s / 3) >= GRID_MIN_TRIS;
  }
  if (!ok) { grids.set(geom, false); return false; }
  return undefined;
}
function gridFor(mesh) {
  const cur = gridState(mesh);
  if (cur !== undefined) return cur;
  const geom = mesh.geometry, pos = geom.attributes.position;
  const [s, e] = drawRangeOf(geom);
  const t0 = Math.ceil(s / 3), nT = Math.floor(e / 3) - t0;
  const t = performance.now();
  const g = buildGrid(geom, pos, t0, nT);
  stats.builds++; stats.tris += nT; const ms = performance.now() - t; stats.ms += ms; stats.maxMs = Math.max(stats.maxMs, ms);
  grids.set(geom, g);
  return g;
}
function buildGrid(geom, pos, t0, nT) {
  if (!geom.boundingBox) geom.computeBoundingBox();
  const bb = geom.boundingBox;
  const idx = geom.index;
  // read the typed arrays directly when the layout allows it (several times faster than getX / getZ)
  const P = !pos.isInterleavedBufferAttribute && !pos.normalized && pos.itemSize >= 3 ? pos.array : null;
  const S = pos.itemSize;
  const I = idx && !idx.isInterleavedBufferAttribute ? idx.array : null;
  const vi = (t, k) => (idx ? (I ? I[t * 3 + k] : idx.getX(t * 3 + k)) : t * 3 + k);
  const ext = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z, 1e-3);
  const cell = Math.max(1.5, ext / 96);
  const nx = Math.max(1, Math.floor((bb.max.x - bb.min.x) / cell) + 1);
  const nz = Math.max(1, Math.floor((bb.max.z - bb.min.z) / cell) + 1);
  const minX = bb.min.x, minZ = bb.min.z;
  const range = new Int32Array(nT * 4);
  const counts = new Uint32Array(nx * nz + 1);
  const big = [];
  for (let i = 0; i < nT; i++) {
    const t = t0 + i;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      const v = vi(t, k);
      const x = P ? P[v * S] : pos.getX(v), z = P ? P[v * S + 2] : pos.getZ(v);
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    const cx0 = Math.max(0, Math.min(nx - 1, Math.floor((x0 - minX) / cell))), cx1 = Math.max(0, Math.min(nx - 1, Math.floor((x1 - minX) / cell)));
    const cz0 = Math.max(0, Math.min(nz - 1, Math.floor((z0 - minZ) / cell))), cz1 = Math.max(0, Math.min(nz - 1, Math.floor((z1 - minZ) / cell)));
    if ((cx1 - cx0 + 1) * (cz1 - cz0 + 1) > BIG_TRI_CELLS || !Number.isFinite(x0 + z0 + x1 + z1)) { big.push(i); range[i * 4] = -1; continue; }
    range[i * 4] = cx0; range[i * 4 + 1] = cx1; range[i * 4 + 2] = cz0; range[i * 4 + 3] = cz1;
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) counts[cz * nx + cx + 1]++;
  }
  for (let c = 1; c < counts.length; c++) counts[c] += counts[c - 1];
  const items = new Uint32Array(counts[counts.length - 1]);
  const fill = counts.slice(0, nx * nz);
  for (let i = 0; i < nT; i++) {
    if (range[i * 4] < 0) continue;
    for (let cz = range[i * 4 + 2]; cz <= range[i * 4 + 3]; cz++) for (let cx = range[i * 4]; cx <= range[i * 4 + 1]; cx++) items[fill[cz * nx + cx]++] = i;
  }
  // per-triangle material index for multi-material meshes (groups); -1 = not drawn
  let matIdx = null;
  if (geom.groups?.length) {
    matIdx = new Int16Array(nT).fill(-1);
    for (const gr of geom.groups) {
      const a = Math.max(0, Math.ceil(gr.start / 3) - t0), b = Math.min(nT, Math.floor((gr.start + gr.count) / 3) - t0);
      for (let i = a; i < b; i++) matIdx[i] = gr.materialIndex ?? 0;
    }
  }
  return { cell, nx, nz, minX, minZ, off: counts, items, big: Uint32Array.from(big), t0, nT, stamp: new Uint32Array(nT), q: 0, matIdx, idx, pos, ver: pos.version, bb: bb.clone() };
}

/** Grid-accelerated raycast of one mesh; pushes at most its nearest hit into `out` (like mesh.raycast). */
function gridRaycast(mesh, g, raycaster, out) {
  const mat = mesh.material;
  if (!mat) return;
  inv.copy(mesh.matrixWorld).invert();
  lray.copy(raycaster.ray).applyMatrix4(inv);
  const o = lray.origin, d = lray.direction;
  // clip the local ray to the bounding box (slabs)
  const bb = g.bb;
  let tIn = 0, tOut = Infinity;
  for (const ax of ['x', 'y', 'z']) {
    const lo = bb.min[ax] - 0.01, hi = bb.max[ax] + 0.01;
    if (Math.abs(d[ax]) < 1e-12) { if (o[ax] < lo || o[ax] > hi) return; continue; }
    let a = (lo - o[ax]) / d[ax], b = (hi - o[ax]) / d[ax];
    if (a > b) { const t = a; a = b; b = t; }
    if (a > tIn) tIn = a;
    if (b < tOut) tOut = b;
    if (tIn > tOut) return;
  }
  if (++g.q >= 0xffffffff) { g.stamp.fill(0); g.q = 1; }
  const q = g.q;
  let bestT = Infinity, bestI = -1;
  const test = (i) => {
    if (g.stamp[i] === q) return;
    g.stamp[i] = q;
    let m = mat;
    if (Array.isArray(mat)) { const mi = g.matIdx ? g.matIdx[i] : 0; if (mi < 0) return; m = mat[mi]; if (!m) return; }
    const t = g.t0 + i;
    const a = g.idx ? g.idx.getX(t * 3) : t * 3, b = g.idx ? g.idx.getX(t * 3 + 1) : t * 3 + 1, c = g.idx ? g.idx.getX(t * 3 + 2) : t * 3 + 2;
    vA.fromBufferAttribute(g.pos, a); vB.fromBufferAttribute(g.pos, b); vC.fromBufferAttribute(g.pos, c);
    const side = m.side;
    const p = side === THREE.BackSide ? lray.intersectTriangle(vC, vB, vA, true, hitL) : lray.intersectTriangle(vA, vB, vC, side === THREE.FrontSide, hitL);
    if (!p) return;
    const lt = hitL.sub(o).dot(d);
    if (lt < bestT && lt >= 0) { bestT = lt; bestI = i; }
  };
  for (let k = 0; k < g.big.length; k++) test(g.big[k]);
  // 2D DDA over the XZ cells between tIn and tOut
  const cell = g.cell;
  let px = o.x + d.x * tIn - g.minX, pz = o.z + d.z * tIn - g.minZ;
  let cx = Math.max(0, Math.min(g.nx - 1, Math.floor(px / cell))), cz = Math.max(0, Math.min(g.nz - 1, Math.floor(pz / cell)));
  const stepX = d.x > 0 ? 1 : -1, stepZ = d.z > 0 ? 1 : -1;
  const invX = Math.abs(d.x) > 1e-12 ? 1 / d.x : Infinity, invZ = Math.abs(d.z) > 1e-12 ? 1 / d.z : Infinity;
  let tMaxX = Number.isFinite(invX) ? tIn + ((cx + (stepX > 0 ? 1 : 0)) * cell - px) * invX : Infinity;
  let tMaxZ = Number.isFinite(invZ) ? tIn + ((cz + (stepZ > 0 ? 1 : 0)) * cell - pz) * invZ : Infinity;
  const tDX = Number.isFinite(invX) ? cell * Math.abs(invX) : Infinity, tDZ = Number.isFinite(invZ) ? cell * Math.abs(invZ) : Infinity;
  for (let guard = 0; guard < 4096; guard++) {
    const c = cz * g.nx + cx;
    for (let k = g.off[c], e = g.off[c + 1]; k < e; k++) test(g.items[k]);
    const tNext = Math.min(tMaxX, tMaxZ);
    if (bestT <= tNext || tNext > tOut) break;          // nearest hit found / left the box
    if (tMaxX < tMaxZ) { cx += stepX; tMaxX += tDX; if (cx < 0 || cx >= g.nx) break; }
    else { cz += stepZ; tMaxZ += tDZ; if (cz < 0 || cz >= g.nz) break; }
  }
  if (bestI < 0) return;
  const t = g.t0 + bestI;
  const a = g.idx ? g.idx.getX(t * 3) : t * 3, b = g.idx ? g.idx.getX(t * 3 + 1) : t * 3 + 1, c = g.idx ? g.idx.getX(t * 3 + 2) : t * 3 + 2;
  lray.at(bestT, hitL);
  hitW.copy(hitL).applyMatrix4(mesh.matrixWorld);
  const distance = raycaster.ray.origin.distanceTo(hitW);
  if (distance < raycaster.near || distance > raycaster.far) return;
  vA.fromBufferAttribute(g.pos, a); vB.fromBufferAttribute(g.pos, b); vC.fromBufferAttribute(g.pos, c);
  const normal = new THREE.Vector3();
  tri.set(vA, vB, vC).getNormal(normal);
  out.push({
    distance, point: hitW.clone(), object: mesh, faceIndex: t,
    face: { a, b, c, normal, materialIndex: Array.isArray(mat) && g.matIdx ? Math.max(0, g.matIdx[bestI]) : 0 },
  });
}

/** Nearest intersection of raycaster.ray with the pickable scene, or null. */
export function firstPickHit(ctx, raycaster) {
  if (!ctx.pick?.items) return null;
  const { roots } = flatten(ctx);
  const ray = raycaster.ray;
  order.length = 0;
  for (const { root, meshes } of roots) {
    if (root.visible === false) continue;
    for (const m of meshes) {
      if (!m.layers.test(raycaster.layers)) continue;
      let t = 0;
      let bs = null;
      if (m.isInstancedMesh) { if (m.boundingSphere === null) m.computeBoundingSphere(); bs = m.boundingSphere; }
      else if (m.geometry) { if (m.geometry.boundingSphere === null) m.geometry.computeBoundingSphere(); bs = m.geometry.boundingSphere; }
      if (bs) {
        sphere.copy(bs).applyMatrix4(m.matrixWorld);
        t = entryDistance(ray, sphere);
        if (t === Infinity || t > raycaster.far) continue;
      }
      order.push({ t, m });
    }
  }
  order.sort((a, b) => a.t - b.t);
  let best = null;
  for (const { t, m } of order) {
    if (best && t > best.distance) break;
    scratch.length = 0;
    try {
      // A big mesh whose grid isn't built yet is tested with three's raycast this once (a few ms) and its grid
      // is queued for idle time — building it here would stall the pointer move that asked (tens of ms).
      let g = gridState(m);
      if (g === undefined) { queueGrid(m, true); g = false; }
      if (g) gridRaycast(m, g, raycaster, scratch);
      else m.raycast(raycaster, scratch);
    } catch { continue; }
    for (const h of scratch) if (h.distance >= raycaster.near && h.distance <= raycaster.far && (!best || h.distance < best.distance)) best = h;
  }
  scratch.length = 0;
  order.length = 0;
  return best;
}

// ---------------------------------------------------------------- idle-time grid building
// Every slice builds at least one grid (also when the main thread never has idle time: requestIdleCallback then
// fires through its timeout with timeRemaining() = 0), nearest meshes and meshes a ray just needed first.
const queue = [];
const queued = new WeakSet();
let scheduled = false;
const ric = (fn, opts) => (window.requestIdleCallback
  ? window.requestIdleCallback(fn, opts)
  : setTimeout(() => fn({ timeRemaining: () => 8, didTimeout: false }), 60));
function queueGrid(mesh, urgent = false) {
  if (queued.has(mesh)) {
    if (!urgent) return;
    const i = queue.indexOf(mesh);
    if (i > 0) { queue.splice(i, 1); queue.unshift(mesh); }
  } else {
    queued.add(mesh);
    if (urgent) queue.unshift(mesh); else queue.push(mesh);
  }
  scheduleGrids();
}
function scheduleGrids() {
  if (scheduled || !queue.length) return;
  scheduled = true;
  ric(buildSlice, { timeout: 300 });
}
function buildSlice(deadline) {
  scheduled = false;
  const t0 = performance.now();
  const budget = deadline?.didTimeout ? 4 : Math.max(2, (deadline?.timeRemaining?.() ?? 8) - 1);
  do {
    const m = queue.shift();
    if (!m) break;
    queued.delete(m);
    try { gridFor(m); } catch { /* ignore: that mesh keeps using three's raycast */ }
  } while (queue.length && performance.now() - t0 < budget);
  scheduleGrids();
}

/** Build the triangle grids in idle time after start-up (nearest to the camera first). */
export function warmPickGrids(ctx) {
  const cam = ctx.camera?.position;
  const list = [];
  for (const { meshes } of flatten(ctx).roots) {
    for (const m of meshes) {
      let st;
      try { st = gridState(m); } catch { st = false; }
      if (st !== undefined) continue;
      let d = 0;
      try {
        const g = m.geometry;
        if (!g.boundingSphere) g.computeBoundingSphere();
        sphere.copy(g.boundingSphere).applyMatrix4(m.matrixWorld);
        d = cam ? Math.max(0, sphere.center.distanceTo(cam) - sphere.radius) : 0;
      } catch { d = 1e9; }
      list.push({ m, d });
    }
  }
  list.sort((a, b) => a.d - b.d);
  for (const { m } of list) queueGrid(m, false);
}
export const pickGridQueue = () => queue.length;

/** Heightfield ray-march: distance along the ray to the terrain (Infinity if none before maxT). */
export function terrainHitDistance(ctx, ray, maxT) {
  const hAt = ctx.heightAt;
  if (!hAt) return Infinity;
  const o = ray.origin, d = ray.direction;
  let prevT = 0;
  let t = 0.5;
  while (t < maxT) {
    const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    if (y < hAt(x, z) - 0.5) {
      let a = prevT, b = t;
      for (let i = 0; i < 6; i++) {
        const m = (a + b) / 2;
        if (o.y + d.y * m < hAt(o.x + d.x * m, o.z + d.z * m) - 0.5) b = m; else a = m;
      }
      return b;
    }
    prevT = t;
    t += Math.max(1.5, t * 0.012);
  }
  return Infinity;
}
