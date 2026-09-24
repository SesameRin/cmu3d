// Shared context object passed to every module. See ARCHITECTURE.md for the contract.
import * as THREE from 'three';
import { createHeightfield, pointInRing } from './heightfield.js';

export function createEmitter() {
  const map = new Map();
  return {
    on(name, fn) {
      if (!map.has(name)) map.set(name, new Set());
      map.get(name).add(fn);
      return () => map.get(name)?.delete(fn);
    },
    off(name, fn) { map.get(name)?.delete(fn); },
    emit(name, payload) {
      const set = map.get(name);
      if (set) for (const fn of [...set]) { try { fn(payload); } catch (e) { console.error(`[events:${name}]`, e); } }
    },
  };
}

function detectQuality() {
  const params = new URLSearchParams(location.search);
  // Touch-first devices only: a coarse pointer with no fine pointer (headless Chrome reports touch points but a fine pointer).
  const coarseOnly = !!(window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia?.('(any-pointer: fine)').matches);
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || coarseOnly;
  mobileHint = isMobile;
  let level = params.get('q') || (isMobile ? 'low' : deviceTier());
  try { level = params.get('q') || localStorage.getItem('cmu3d.quality') || level; } catch { /* storage blocked */ }
  if (!['low', 'medium', 'high'].includes(level)) level = 'medium';
  return { isMobile, quality: qualityPreset(level) };
}

// Default quality for desktops from CPU threads, memory and the GPU name (a user choice in localStorage wins).
function deviceTier() {
  const cores = navigator.hardwareConcurrency || 8;
  const mem = navigator.deviceMemory || 8;
  let gpu = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* no WebGL info */ }
  if (/SwiftShader|llvmpipe|Software|Mali|Adreno|PowerVR|Intel.*\b(HD|UHD)\b/i.test(gpu) || cores <= 4 || mem <= 4) return 'low';
  if (/Intel|Radeon\(TM\) Graphics|Vega \d|Apple M1\b/i.test(gpu) || cores <= 8) return 'medium';
  return 'high';
}
let mobileHint = false;

export function qualityPreset(level) {
  const presets = {
    // phones render low at up to 1.5× DPR: they are CPU-bound (draw calls), so the extra pixels are almost free
    low: { level: 'low', shadows: false, shadowMapSize: 1024, pixelRatio: mobileHint ? Math.min(devicePixelRatio, 1.5) : 1, treeDensity: 0.45, npcCount: 40, groundTextureSize: 2048, antialias: false, post: false, drawDistance: 1600 },
    medium: { level: 'medium', shadows: true, shadowMapSize: 2048, pixelRatio: Math.min(devicePixelRatio, 1.5), treeDensity: 0.75, npcCount: 120, groundTextureSize: 4096, antialias: true, post: false, drawDistance: 2400 },
    high: { level: 'high', shadows: true, shadowMapSize: 4096, pixelRatio: Math.min(devicePixelRatio, 2), treeDensity: 1, npcCount: 220, groundTextureSize: 4096, antialias: true, post: true, drawDistance: 3200 },
  };
  return { ...presets[level] };
}

// Uniform-grid 2D collision world. Shapes are extruded vertically between yMin and yMax.
export function createColliders(cell = 16) {
  const grid = new Map();
  const shapes = [];
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  function insert(shape, x0, z0, x1, z1) {
    shapes.push(shape);
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) {
      for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) {
        const k = key(i, j);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(shape);
      }
    }
    return shape;
  }
  function addPolygon(ring, yMin = -Infinity, yMax = Infinity, tag = null) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    return insert({ kind: 'poly', ring, yMin, yMax, tag, x0, x1, z0, z1, q: 0 }, x0, z0, x1, z1);
  }
  function addCircle(x, z, r, yMin = -Infinity, yMax = Infinity, tag = null) {
    return insert({ kind: 'circle', x, z, r, yMin, yMax, tag, x0: x - r, x1: x + r, z0: z - r, z1: z + r, q: 0 }, x - r, z - r, x + r, z + r);
  }
  // Oriented box: centre, half-extents along its local axes, rotation (radians about +Y)
  function addBox(cx, cz, hw, hd, rotY = 0, yMin = -Infinity, yMax = Infinity, tag = null) {
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const pts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([a, b]) => [cx + a * c + b * s, cz - a * s + b * c]);
    return addPolygon(pts, yMin, yMax, tag);
  }
  // Shapes overlapping the square (x ± r, z ± r), each once (de-duplicated with a per-query stamp), appended to out.
  let stamp = 0;
  function collect(x, z, r, out) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(r)) return out;
    if (++stamp > 1e15) stamp = 1;
    for (let i = Math.floor((x - r) / cell); i <= Math.floor((x + r) / cell); i++) {
      for (let j = Math.floor((z - r) / cell); j <= Math.floor((z + r) / cell); j++) {
        const list = grid.get(key(i, j));
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const s = list[k];
          if (s.q === stamp || x + r < s.x0 || x - r > s.x1 || z + r < s.z0 || z - r > s.z1) continue;
          s.q = stamp;
          out.push(s);
        }
      }
    }
    return out;
  }
  function query(x, z, r) { return collect(x, z, r, []); }
  // Push a vertical capsule (pos = feet, radius, height) out of every overlapping shape. Mutates pos. Returns true if hit.
  // (called several times per frame while walking / flying: works on a reused list, no allocation)
  const near = [];
  function resolve(pos, radius = 0.35, height = 1.7) {
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return false;
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      near.length = 0;
      collect(pos.x, pos.z, radius, near);
      for (let n = 0; n < near.length; n++) {
        const s = near[n];
        if (pos.y + height < s.yMin || pos.y > s.yMax) continue;
        if (s.kind === 'circle') {
          const dx = pos.x - s.x, dz = pos.z - s.z, d = Math.hypot(dx, dz), min = s.r + radius;
          if (d < min) {
            const nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
            pos.x = s.x + nx * min; pos.z = s.z + nz * min; hit = moved = true;
          }
          continue;
        }
        // polygon: closest point on boundary
        const ring = s.ring;
        let best = Infinity, bx = 0, bz = 0;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const ax = ring[j][0], az = ring[j][1], ex = ring[i][0] - ax, ez = ring[i][1] - az;
          const l2 = ex * ex + ez * ez || 1e-9;
          let t = ((pos.x - ax) * ex + (pos.z - az) * ez) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = ax + ex * t, pz = az + ez * t, d = (pos.x - px) ** 2 + (pos.z - pz) ** 2;
          if (d < best) { best = d; bx = px; bz = pz; }
        }
        const d = Math.sqrt(best);
        const inside = pointInRing(pos.x, pos.z, ring);
        if (inside || d < radius) {
          let nx = pos.x - bx, nz = pos.z - bz;
          const l = Math.hypot(nx, nz) || 1;
          nx /= l; nz /= l;
          if (inside) { nx = -nx; nz = -nz; }
          pos.x = bx + nx * radius; pos.z = bz + nz * radius; hit = moved = true;
        }
      }
      if (!moved) break;
    }
    return hit;
  }
  // queryInto(x, z, r, out): like query() but appends to a caller-owned array (per-frame callers reuse one)
  return { shapes, addPolygon, addCircle, addBox, query, queryInto: collect, resolve };
}

export function createContext({ data, info }) {
  const { isMobile, quality } = detectQuality();
  const heightfield = createHeightfield(data.terrain);
  const updates = [];
  let runList = null;
  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const tmp = new THREE.Vector3();
  const hits = [];
  let lastYield = 0, yieldEvery = 40, yieldCost = 8;

  const ctx = {
    THREE,
    data,
    info: info || { buildings: {}, landmarks: {}, tour: [] },
    isMobile,
    quality,
    events: createEmitter(),
    heightfield,
    heightAt: heightfield.heightAt,
    normalAt: heightfield.normalAt,
    // filled in by modules:
    renderer: null, scene: null, camera: null, engine: null, env: null, terrain: null,
    materials: null, nav: null, ui: null,
    landmarks: [],                  // [{ key, name, nameZh, osmIds, object, anchor:[x,z] }]
    skipBuildingIds: new Set(),     // OSM ids that landmark modules replace; buildings.js must not render them
    loading: { step() {}, detail() {} }, // replaced by the UI loading screen
    // Work a module would otherwise do lazily after start-up (idle-time detail builds, caches): register it here while
    // building and main.js runs it behind the loading screen, after every build step and before the shader compile /
    // warm-up frames. fn may be async (yield with ctx.yield()). Tasks added after loading run right away.
    loadTasks: [],
    addLoadTask(label, fn) {
      if (typeof fn !== 'function') return;
      if (ctx.engine?.running) { Promise.resolve().then(fn).catch((e) => console.warn(`[load task] ${label} failed`, e)); return; }
      ctx.loadTasks.push([String(label || '准备'), fn]);
    },

    // ---- per-frame updates. fn(dt, elapsed). Lower order runs first. Returns unsubscribe.
    onUpdate(fn, order = 0) {
      const entry = { fn, order };
      updates.push(entry);
      updates.sort((a, b) => a.order - b.order);
      runList = null;
      return () => { const i = updates.indexOf(entry); if (i >= 0) { updates.splice(i, 1); runList = null; } };
    },
    // (iterates a snapshot — callbacks may subscribe / unsubscribe while running — that is only re-made when the
    // list changed, so a frame allocates nothing here)
    tick(dt, elapsed) {
      if (!runList) runList = updates.slice();
      const list = runList;
      for (let i = 0; i < list.length; i++) { try { list[i].fn(dt, elapsed); } catch (e) { console.error('[update]', e); } }
    },

    // ---- picking registry (raycast targets for hover/click)
    // entry: { key, kind:'building'|'landmark'|'poi'|'area', name, nameZh, osmId, position:[x,y,z], radius }
    // or a resolver function (hit) => entry | null for merged meshes.
    pick: {
      items: new Map(),
      add(object, entryOrResolver) { this.items.set(object, entryOrResolver); },
      remove(object) { this.items.delete(object); },
      objects() { return [...this.items.keys()].filter((o) => o.visible !== false); },
      resolve(hit) {
        let o = hit.object;
        while (o) {
          const e = this.items.get(o);
          if (e) return typeof e === 'function' ? e(hit) : e;
          o = o.parent;
        }
        return null;
      },
    },

    // ---- floating label registry. The UI renders these.
    // label: { key, text, textZh, kind:'landmark'|'building'|'poi'|'road'|'area', priority 0..10, position:{x,y,z}, maxDistance }
    labels: {
      items: new Map(),
      version: 0,
      add(label) { this.items.set(label.key, label); this.version++; return label; },
      remove(key) { this.items.delete(key); this.version++; },
    },

    // ---- collision world for walk mode
    colliders: createColliders(),

    // ---- walkable meshes above terrain (bridges, stairs, plazas, terraces). Walk mode stands on max(terrain, these).
    walkables: {
      meshes: [],
      add(mesh) { this.meshes.push(mesh); },
    },
    surfaceHeightAt(x, z, fromY = Infinity) {
      let y = heightfield.heightAt(x, z);
      if (ctx.walkables.meshes.length) {
        const top = Number.isFinite(fromY) ? fromY + 1.2 : y + 200;
        raycaster.set(tmp.set(x, top, z), down);
        raycaster.far = top - y + 0.5;
        hits.length = 0;
        raycaster.intersectObjects(ctx.walkables.meshes, false, hits);
        if (hits.length) y = Math.max(y, hits[0].point.y);
        hits.length = 0;
      }
      return y;
    },

    // Yield to the browser so the loading screen can repaint between heavy steps.
    // Cheap when called often: only really yields once ~40 ms of work have passed. Uses a frame (so the loading
    // screen repaints) when visible, and a plain timeout when the tab is hidden (rAF doesn't run in background tabs).
    yield() {
      const now = performance.now();
      if (now - lastYield < yieldEvery) return Promise.resolve();
      const t0 = now;
      return new Promise((r) => {
        let done = false;
        const go = () => {
          if (done) return;
          done = true; lastYield = performance.now();
          yieldCost += ((lastYield - t0) - yieldCost) * 0.3;          // EMA of what a yield really costs
          yieldEvery = Math.min(200, Math.max(40, 6 * yieldCost));   // keep yields ≲ 15 % of the loading time
          r();
        };
        if (document.hidden) setTimeout(go, 0);
        else { requestAnimationFrame(() => setTimeout(go, 0)); setTimeout(go, 120); }
      });
    },
  };
  return ctx;
}
