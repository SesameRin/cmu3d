// Shared helpers for the small campus icons (Fence, Walking to the Sky, Scotty, Gesling Stadium, Kraus Campo).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ------------------------------------------------------------------ geometry buckets
// Collect geometries per material and merge each bucket into one mesh (one draw call per material).
export class PartBucket {
  constructor() { this.map = new Map(); }
  // geo is consumed (transformed in place). matrix optional.
  add(material, geo, matrix = null) {
    if (matrix) geo.applyMatrix4(matrix);
    if (!this.map.has(material)) this.map.set(material, []);
    this.map.get(material).push(geo);
    return geo;
  }
  // Build a group with one merged mesh per material.
  build({ castShadow = true, receiveShadow = true, name = '' } = {}) {
    const group = new THREE.Group();
    for (const [mat, geos] of this.map) {
      const merged = mergeCompatible(geos);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = castShadow && !mat.transparent;
      mesh.receiveShadow = receiveShadow;
      mesh.name = `${name}:${mat.name || 'part'}`;
      group.add(mesh);
    }
    return group;
  }
}

// Merge geometries that may differ in attributes/indexing: normalise to the attribute set of the first geometry.
export function mergeCompatible(geos) {
  if (!geos.length) return null;
  const wantColor = geos.some((g) => g.attributes.color);
  const wantUv = geos.some((g) => g.attributes.uv);
  const list = geos.map((g0) => {
    let g = g0.index ? g0 : withIndex(g0);
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv' && name !== 'color') g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    if (wantUv && !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (!wantUv && g.attributes.uv) g.deleteAttribute('uv');
    if (wantColor && !g.attributes.color) {
      const c = new Float32Array(n * 3).fill(1);
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    if (g.attributes.color && g.attributes.color.itemSize === 4) {
      const src = g.attributes.color.array, c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { c[i * 3] = src[i * 4]; c[i * 3 + 1] = src[i * 4 + 1]; c[i * 3 + 2] = src[i * 4 + 2]; }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
    // mergeGeometries needs matching index array types -> promote to Uint32 when mixing
    g.morphAttributes = {};
    g.clearGroups();
    return g;
  });
  const total = list.reduce((s, g) => s + g.attributes.position.count, 0);
  if (total > 65535) for (const g of list) if (!(g.index.array instanceof Uint32Array)) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(g.index.array), 1));
  const merged = mergeGeometries(list, false);
  if (!merged) console.warn('[icons] mergeGeometries failed');
  merged?.computeBoundingSphere();
  return merged;
}

function withIndex(g) {
  const n = g.attributes.position.count;
  const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// Paint a constant vertex colour on a geometry (returns the geometry).
export function tint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

// ------------------------------------------------------------------ small geometry helpers
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3();

// Box centred at (x,y,z) with size (w,h,d), rotated rotY about Y.
export function boxAt(w, h, d, x, y, z, rotY = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rotY) g.rotateY(rotY);
  g.translate(x, y, z);
  return g;
}

// Cylinder between two points (a, b arrays or Vector3) with radii r0 (at a) and r1 (at b).
export function cylinderBetween(a, b, r0, r1 = r0, seg = 8, capped = true) {
  _a.set(...(Array.isArray(a) ? a : [a.x, a.y, a.z]));
  _b.set(...(Array.isArray(b) ? b : [b.x, b.y, b.z]));
  _d.subVectors(_b, _a);
  const len = _d.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, !capped);
  g.translate(0, len / 2, 0);
  _q.setFromUnitVectors(_up, _d.normalize());
  _m.compose(_a, _q, _s);
  g.applyMatrix4(_m);
  return g;
}

// ------------------------------------------------------------------ registration
// Pick entry + label + ctx.landmarks anchor for a landmark object.
// Names come from CAMPUS_INFO when it has an entry, so the label, the info panel and search always agree.
export function registerLandmark(ctx, def, object, { position, radius, labelY = 0, priority = 9, maxDistance, pickObject } = {}) {
  const inf = ctx.info?.landmarks?.[def.key];
  const nameZh = inf?.nameZh || def.nameZh, name = inf?.nameEn || def.name;
  const entry = {
    key: def.key, kind: 'landmark', name, nameZh, infoKey: def.key,
    osmId: def.osmIds?.[0], position: position.slice(), radius,
  };
  try { ctx.pick?.add(pickObject || object, entry); } catch (e) { console.warn('[icons] pick', e); }
  try {
    ctx.labels?.add({
      key: `landmark:${def.key}`, text: name, textZh: nameZh, kind: 'landmark', priority,
      position: { x: position[0], y: position[1] + labelY, z: position[2] }, ...(maxDistance ? { maxDistance } : {}),
    });
  } catch (e) { console.warn('[icons] label', e); }
  object.userData.landmarkKey = def.key;
  object.userData.anchor = [position[0], position[2]];
  return entry;
}

// ------------------------------------------------------------------ deferred refinement
// The sculpted details (SDF meshing of the Fence, the Walking-to-the-Sky figures, Scotty; the full Fence
// paint job) cost several hundred ms of CPU and are only visible up close, so they are kept out of the
// loading path: each landmark builds a cheap coarse version synchronously and queues the detailed one here.
// Jobs are step generators. They run in idle slices of a few ms after `app:ready` (nearest job first), and a
// job whose anchor the camera comes within `near` metres of is finished on the spot, before that frame renders.
//   deferRefine(ctx, { name, anchor:[x,y,z], near, steps: () => Iterator, apply(result) })
const queues = new WeakMap();
const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// Distance LOD that shows `coarse` at every distance until setFine(obj) is called (from a deferRefine apply),
// after which the detailed object is shown within `far` metres of the LOD's own origin.
export function makeLOD(coarse, far) {
  const lod = new THREE.LOD();
  lod.addLevel(coarse, 0, 0.1);
  lod.setFine = (fine) => {
    lod.levels[0].distance = far;
    lod.addLevel(fine, 0, 0.1);
  };
  return lod;
}

export function deferRefine(ctx, job) {
  const q = refineQueue(ctx);
  q.jobs.push({ ...job, it: null, cpu: 0, maxStep: 0, maxStepAt: 0, steps_: 0, slices: 0 });
  if (q.running) pumpSoon(ctx, q);
  return job;
}

function refineQueue(ctx) {
  let q = queues.get(ctx);
  if (q) return q;
  q = { jobs: [], running: false, scheduled: false, unsub: null, log: [] };
  queues.set(ctx, q);
  if (ctx.shotMode) window.__iconsRefine = q.log;
  const start = () => { if (q.running) return; q.running = true; pumpSoon(ctx, q); };
  // app:ready is emitted by main.js after the first frame is queued; the dev harness never emits it
  if (ctx.events?.on && !ctx.harness) ctx.events.on('app:ready', start);
  else setTimeout(start, 0);
  // proximity: finish a job immediately when the camera gets close to what it refines
  if (ctx.onUpdate) {
    q.unsub = ctx.onUpdate(() => {
      const cam = ctx.camera?.position;
      if (!cam || !q.jobs.length) return;
      for (let i = 0; i < q.jobs.length; i++) {
        const j = q.jobs[i];
        const dx = cam.x - j.anchor[0], dy = cam.y - j.anchor[1], dz = cam.z - j.anchor[2];
        if (dx * dx + dy * dy + dz * dz < j.near * j.near) { runJob(ctx, q, j, Infinity); i--; }
      }
    }, 5);
  }
  return q;
}

// Advance one job for up to `budget` ms; finishes and removes it when its generator completes.
function runJob(ctx, q, job, budget) {
  const t0 = nowMs();
  let done = false, value;
  try {
    if (!job.it) job.it = job.steps();
    let ts = t0;
    for (;;) {
      const r = job.it.next();
      const te = nowMs();
      if (te - ts > job.maxStep) { job.maxStep = te - ts; job.maxStepAt = job.steps_; }
      job.steps_++;
      ts = te;
      if (r.done) { done = true; value = r.value; break; }
      if (te - t0 >= budget) break;
    }
  } catch (e) {
    console.warn(`[icons] refine ${job.name} failed`, e);
    done = true; value = undefined; job.failed = true;
  }
  job.cpu += nowMs() - t0;
  job.slices++;
  if (!done) return false;
  q.jobs.splice(q.jobs.indexOf(job), 1);
  if (!job.failed) {
    try { job.apply(value); } catch (e) { console.warn(`[icons] refine ${job.name} apply failed`, e); }
  }
  q.log.push({ name: job.name, cpuMs: Math.round(job.cpu), maxStepMs: Math.round(job.maxStep), maxStepAt: job.maxStepAt, steps: job.steps_, slices: job.slices, at: Math.round(nowMs()), forced: budget === Infinity });
  if (!q.jobs.length && q.unsub) { q.unsub(); q.unsub = null; }
  return true;
}

function pumpSoon(ctx, q) {
  if (q.scheduled || !q.jobs.length) return;
  q.scheduled = true;
  const slice = (budget) => {
    q.scheduled = false;
    const cam = ctx.camera?.position;
    const t0 = nowMs();
    while (q.jobs.length && nowMs() - t0 < budget) {
      // nearest pending job first
      let best = q.jobs[0], bd = Infinity;
      if (cam) for (const j of q.jobs) { const d = (cam.x - j.anchor[0]) ** 2 + (cam.z - j.anchor[2]) ** 2; if (d < bd) { bd = d; best = j; } }
      runJob(ctx, q, best, budget - (nowMs() - t0));
    }
    pumpSoon(ctx, q);
  };
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback((dl) => slice(dl.didTimeout ? 6 : Math.max(3, Math.min(12, dl.timeRemaining() - 1))), { timeout: 120 });
  } else {
    setTimeout(() => slice(6), 20);
  }
}

// ------------------------------------------------------------------ canvas helpers
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function canvasTexture(canvas, { srgb = true, repeat = false, anisotropy = 8, renderer } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const max = renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;
  t.anisotropy = Math.min(anisotropy, max);
  t.needsUpdate = true;
  return t;
}

// Seeded PRNG (mulberry32)
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Font stacks that exist on most systems (no web font needed; CJK falls back to system fonts).
export const FONT_SANS = '"Arial Black", "Helvetica Neue", Arial, "Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif';
export const FONT_CJK = '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "SimHei", sans-serif';
export const FONT_SERIF = '"Source Serif 4", Georgia, "Times New Roman", serif';
