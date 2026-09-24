// HTML label renderer for ctx.labels: projects every label each frame, declutters them on a screen-space
// occupancy grid (priority first, then distance), fades by distance, hides labels behind the camera,
// and re-syncs when ctx.labels.version changes. Landmark labels are prominent (red pin) and clickable.
// Names come from the catalogue (CAMPUS_INFO first) so a label always matches its tooltip / info panel.
// At eye level (walk / fly) labels hidden behind buildings or hills are culled with a cheap 2.5D line-of-sight
// test against the collider footprints + heightfield (a few labels per frame, results cached).
import * as THREE from 'three';
import { h, clamp } from './dom.js';
import { icon } from './icons.js';
import { pointInRing } from '../core/heightfield.js';

const CELL = 12;                 // declutter grid cell (px)
const DEFAULT_MAX = { landmark: 4200, building: 650, buildingMajor: 1150, area: 1000, poi: 320, road: 500 };
const WALK_MAX = 260;            // non-landmark labels at eye level: only what is around you
const FLIP_MIN = 10, FLIP_MAX = 110;   // px: stem length range of a landmark label hung below its anchor
const OBSTACLE_TTL = 2.5;        // s: HUD rects are re-read by the UI (sampleObstacles, when panels change) — fallback poll
const OCC_TTL = 0.5;             // s a line-of-sight result stays valid
const OCC_PER_FRAME = 8;         // line-of-sight tests per frame
const OCC_GRID = 24;             // m, spatial grid for the occluder footprints
const GHOST_MAX = 4;             // hidden landmarks still hinted at 30 % opacity (nearest few only)…
const GHOST_MAX_D = 700;         // …and only within this distance (m)
const ROAD_SPLIT = 4.5;          // labels ranked above this are placed before the major road names (roadlabels.js)

const PREFIX = /^(landmark|lm|building|bld|b|poi|area|label|ui):/i;
// "彩绘围栏（The Fence）" shown above "The Fence" → "彩绘围栏"
const stripLatinParen = (zh) => zh.replace(/\s*[（(][^（）()]*[A-Za-z][^（）()]*[)）]\s*$/, '').trim() || zh;

// ---------------------------------------------------------------- label box sizes without layout
// Box sizes come from canvas text metrics plus the fixed paddings / icon sizes of css/styles.css (§labels), so
// labels never force a synchronous layout of the page. Keep these numbers in step with the CSS.
const SANS = "'Noto Sans SC', system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";
const SERIF = "'Source Serif 4', 'Source Serif Pro', Georgia, 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', serif";
let mctx = null, mfont = '';
function textW(font, s, spacing = 0) {
  if (!s) return 0;
  if (!mctx) mctx = document.createElement('canvas').getContext('2d');
  if (!mctx) return s.length * 12;
  if (font !== mfont) { mctx.font = font; mfont = font; }
  return mctx.measureText(s).width + spacing * s.length;
}
/** [width, height, cardHeight] of a label's .lbl-in box. */
function boxSize(kind, primary, secondary, major) {
  const small = secondary ? textW(`400 10px ${SANS}`, secondary, 0.2) : 0;
  if (kind === 'landmark') {
    // card: border 1 + padding 4/11/4/4, pin 24, gap 7; text: b 13.5px/1.2 (+ small 10px/1.2 + 1 margin); stem 16 + 2
    const card = 10 + Math.max(24, 16.2 + (secondary ? 13 : 0));
    return [Math.ceil(48 + Math.max(textW(`600 13.5px ${SANS}`, primary), small)), Math.ceil(card + 18), Math.ceil(card)];
  }
  if (kind === 'poi') return [Math.ceil(35 + textW(`500 11px ${SANS}`, primary)), 24, 24];
  if (kind === 'area') {
    const hh = Math.ceil(15.6 + (secondary ? 12 : 0));
    return [Math.ceil(Math.max(textW(`600 13px ${SERIF}`, primary, 0.52), small)), hh, hh];
  }
  if (kind === 'road') return [Math.ceil(textW(`600 10.5px ${SANS}`, String(primary).toUpperCase(), 1.26)), 13, 13];
  // building: padding 2/8/3 (major: left 9), b 12px (major 12.5px), dot 5 + 3
  const tw = Math.max(textW(major ? `600 12.5px ${SANS}` : `500 12px ${SANS}`, primary), small);
  const hh = Math.ceil((major ? 15 : 14.4) + (secondary ? 12 : 0) + 13);
  return [Math.ceil(tw + (major ? 17 : 16)), hh, hh];
}

export function createLabels(ctx, { root, catalog, onSelect, obstacles }) {
  const layer = h('div.lbl-layer', { 'aria-hidden': 'false' });
  root.appendChild(layer);

  const states = new Map();      // key → state
  let version = -1;
  let enabled = true;
  let minPriority = -Infinity;   // raised during the guided tour for a cleaner, cinematic frame
  const cands = [];
  let grid = new Uint8Array(1);  // 0 free · 1 taken by a label · 2 covered by a HUD panel / screen margin
  let gridW = 0, gridH = 0;
  let clock = 0;
  let roadHook = null;           // roadlabels.js layout(grid, phase), called during the declutter pass

  // Screen rectangles covered by HUD panels: labels are never placed underneath them. ui.js samples them at
  // the start of its frame (sampleObstacles), before any component writes to the DOM, so the reads don't force
  // a layout; update() only falls back to polling when nobody sampled for a while.
  let obstacleRects = [];
  let obstacleT = 1e9;
  let obstaclesMoved = true;     // the rects changed since the last declutter pass
  const sameRects = (a, b) => a.length === b.length && a.every((r, i) => r.left === b[i].left && r.top === b[i].top && r.right === b[i].right && r.bottom === b[i].bottom);
  function sampleObstacles() {
    obstacleT = 0;
    let next;
    try { next = (obstacles && obstacles()) || []; } catch { next = []; }
    if (!sameRects(next, obstacleRects)) obstaclesMoved = true;
    obstacleRects = next;
  }

  const view = new THREE.Matrix4();
  const proj = new THREE.Matrix4();
  const v = new THREE.Vector4();

  // ---------------------------------------------------------------- catalogue record behind a label
  function recFor(lb) {
    if (!catalog) return null;
    try {
      if (lb.recKey) return catalog.get(lb.recKey) || null;
      const kind = lb.kind || 'building';
      if (kind === 'road') return null;
      const k = typeof lb.key === 'string' ? lb.key.replace(PREFIX, '') : lb.key;
      let r = null;
      if (kind === 'landmark') {
        r = catalog.get(`lm:${k}`) || (lb.osmId && catalog.byOsm?.get(lb.osmId))
          || (lb.infoKey && (catalog.get(`lm:${lb.infoKey}`) || catalog.byOsm?.get(lb.infoKey))) || null;
      } else if (kind === 'building') r = catalog.byOsm?.get(lb.osmId || k) || null;
      else if (kind === 'area') r = catalog.get(`area:${lb.text}`);
      else if (kind === 'poi') r = catalog.get(`poi:${lb.text}`);
      return r || null;
    } catch { return null; }
  }

  function makeEl(lb, rec) {
    const kind = lb.kind || 'building';
    const en = rec?.nameEn || lb.text || '';
    let zh = rec?.nameZh || lb.textZh || '';
    if (zh === en) zh = '';
    const primaryRaw = zh || en;
    const showSecondary = !!zh && !!en && (kind === 'landmark' || kind === 'area' || (kind !== 'poi' && (lb.priority ?? 0) >= 5));
    const primary = showSecondary ? stripLatinParen(primaryRaw) : primaryRaw;
    const secondary = showSecondary ? en : '';
    let inner;
    if (kind === 'landmark') {
      inner = h('div.lbl-in', null, [
        h('div.lbl-card', null, [
          h('span.lbl-pin', { html: icon('pin') }),
          h('span.lbl-txt', null, [h('b', null, primary), secondary ? h('small', null, secondary) : null]),
        ]),
        h('i.lbl-stem'),
      ]);
    } else if (kind === 'poi') {
      inner = h('div.lbl-in', null, [
        h('span.lbl-poi-ico', { html: icon(lb.icon || rec?.cat?.icon || 'pin') }),
        h('span.lbl-txt', null, [h('b', null, primary)]),
      ]);
    } else if (kind === 'area') {
      inner = h('div.lbl-in', null, [h('span.lbl-txt', null, [h('b', null, primary), secondary ? h('small', null, secondary) : null])]);
    } else {
      inner = h('div.lbl-in', null, [
        h('span.lbl-txt', null, [h('b', null, primary), secondary ? h('small', null, secondary) : null]),
        h('i.lbl-dot'),
      ]);
    }
    const title = zh && en ? `${zh} · ${en}` : primaryRaw;
    const el = h(`div.lbl.lbl-${kind}`, { 'data-key': lb.key, title }, inner);
    const major = lb.priority >= 6 && kind === 'building';
    if (major) el.classList.add('lbl-major');
    // Labels are pointer-transparent so camera drags never get stuck on them; clicks are hit-tested
    // from the canvas handler via hitTest() (see picking.js).
    if (kind !== 'road') el.classList.add('lbl-click');
    return { el, primary, secondary, major };
  }

  function sync() {
    version = ctx.labels?.version ?? 0;
    const items = ctx.labels?.items;
    if (!items) return;
    for (const [key, st] of states) {
      if (!items.has(key) || items.get(key) !== st.label) { st.el.remove(); states.delete(key); }
    }
    const added = [];
    for (const [key, lb] of items) {
      if (states.has(key) || !lb || !lb.position) continue;
      const rec = recFor(lb);
      const { el, primary, secondary, major } = makeEl(lb, rec);
      el.style.display = 'none';
      layer.appendChild(el);
      const kind = lb.kind || 'building';
      const st = {
        key, label: lb, rec, el, kind, primary, secondary, major,
        pri: lb.priority ?? (kind === 'landmark' ? 9 : 3),
        maxD: lb.maxDistance || (kind === 'building' && (lb.priority ?? 0) >= 6 ? DEFAULT_MAX.buildingMajor : DEFAULT_MAX[kind] || 800),
        w: 0, h: 0, ch: 0, dirty: true, alpha: 0, shown: false, was: false, x: -1e4, y: -1e4, o: -1, sx: 0, sy: 0, dist: 0, fade: 0,
        occ: -1, occT: -1e9, ocx: NaN, ocy: NaN, ocz: NaN, own: null, flip: 0, flipShown: -1, by0: 0, by1: 0,
      };
      states.set(key, st);
      added.push(st);
    }
    if (added.length) idleMeasure();
  }

  // Box sizes from canvas text metrics (no DOM layout — see boxSize()). Shaping text the first time still costs
  // ~0.1–0.3 ms per label (CJK font fallback), so on screen labels are measured within a small per-frame budget
  // (most important first) and the rest in idle time.
  const mstats = { batches: 0, labels: 0, ms: 0, maxMs: 0 };
  function measure(list, budgetMs = Infinity) {
    if (!list.length) return 0;
    const t0 = performance.now();
    let n = 0;
    for (const st of list) {
      if (n && performance.now() - t0 > budgetMs) break;
      const [w, hh, ch] = boxSize(st.kind, st.primary, st.secondary, st.major);
      st.w = Math.max(8, w); st.h = Math.max(8, hh); st.ch = Math.max(8, ch);
      st.dirty = false;
      n++;
    }
    const ms = performance.now() - t0;
    mstats.batches++; mstats.labels += n; mstats.ms += ms; mstats.maxMs = Math.max(mstats.maxMs, ms);
    return n;
  }
  let idleQueued = false;
  const ric = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(() => fn(null), 200));
  function idleMeasure() {
    if (idleQueued) return;
    idleQueued = true;
    ric((deadline) => {
      idleQueued = false;
      const todo = [];
      for (const st of states.values()) if (st.dirty) todo.push(st);
      if (!todo.length) return;
      const budget = deadline && !deadline.didTimeout ? Math.max(2, deadline.timeRemaining() - 1) : 3;
      measure(todo, budget);
      if (todo.some((st) => st.dirty)) idleMeasure();
    });
  }
  const remeasureAll = () => { for (const st of states.values()) st.dirty = true; idleMeasure(); };
  // Web fonts change the text metrics: re-measure (lazily) whenever a font load finishes.
  document.fonts?.ready?.then(remeasureAll).catch(() => {});
  try { document.fonts?.addEventListener?.('loadingdone', remeasureAll); } catch { /* old browsers */ }
  const toMeasure = [];
  const MEASURE_MS = 3;          // per-frame budget for measuring labels that just came on screen

  // ---------------------------------------------------------------- eye-level line of sight
  let occCells = null, occCount = -1;
  function occluders() {
    const shapes = ctx.colliders?.shapes;
    if (!shapes) return null;
    if (occCells && occCount === shapes.length) return occCells;
    occCount = shapes.length;
    occCells = new Map();
    for (const s of shapes) {
      if (!s || !Number.isFinite(s.yMax)) continue;
      if (s.kind === 'circle' ? s.r < 1.2 : Math.hypot(s.x1 - s.x0, s.z1 - s.z0) < 3) continue;   // posts, trunks, benches
      const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
      const base = Number.isFinite(s.yMin) ? s.yMin : (ctx.heightAt?.(cx, cz) ?? s.yMax);
      if (s.yMax - Math.max(base, ctx.heightAt?.(cx, cz) ?? base) < 3) continue;                   // low walls, kerbs
      for (let i = Math.floor(s.x0 / OCC_GRID); i <= Math.floor(s.x1 / OCC_GRID); i++) {
        for (let j = Math.floor(s.z0 / OCC_GRID); j <= Math.floor(s.z1 / OCC_GRID); j++) {
          const k = `${i},${j}`;
          let a = occCells.get(k);
          if (!a) occCells.set(k, (a = []));
          a.push(s);
        }
      }
    }
    return occCells;
  }
  const inShape = (s, x, z) => x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1 &&
    (s.kind === 'circle' ? (x - s.x) ** 2 + (z - s.z) ** 2 <= s.r * s.r : pointInRing(x, z, s.ring));
  function shapesAt(cells, x, z) { return cells.get(`${Math.floor(x / OCC_GRID)},${Math.floor(z / OCC_GRID)}`); }
  /** Is the label anchor hidden from the camera by a building footprint or the terrain? */
  function occluded(st, cam) {
    const cells = occluders();
    const hAt = ctx.heightAt;
    const p = st.label.position;
    if (!st.own) {
      // the label's own building / monument (its footprint contains the anchor) never hides the label
      st.own = new Set();
      if (cells) for (const s of shapesAt(cells, p.x, p.z) || []) if (inShape(s, p.x, p.z)) st.own.add(s);
    }
    const o = cam.position;
    const dx = p.x - o.x, dy = p.y - o.y, dz = p.z - o.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 6) return false;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    for (let t = 3; t < len - 2; t += clamp(t * 0.02, 2, 8)) {
      const x = o.x + ux * t, y = o.y + uy * t, z = o.z + uz * t;
      if (hAt && y < hAt(x, z) - 0.6) return true;
      const list = cells && shapesAt(cells, x, z);
      if (!list) continue;
      for (const s of list) {
        if (y > s.yMax || (Number.isFinite(s.yMin) && y < s.yMin)) continue;
        if (st.own.has(s) || !inShape(s, x, z)) continue;
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- per frame
  // Idle frames: while the view, the viewport, the HUD panels and the label set are unchanged and no fade is running,
  // the projected layout is exactly the last one — the whole pass is skipped (a full pass still runs a few times a
  // second to catch anything else). roadlabels.js follows `idle` and skips its layout as well.
  const viewSig = new Float64Array(36).fill(NaN);
  let animating = true, lastMode = '', lastMinPri = NaN, idleN = 0, idle = false;
  function viewChanged(cam, W, H) {
    const a = cam.matrixWorld.elements, b = cam.projectionMatrix.elements, S = viewSig;
    let changed = S[32] !== W || S[33] !== H;
    for (let i = 0; i < 16 && !changed; i++) if (S[i] !== a[i] || S[16 + i] !== b[i]) changed = true;
    if (changed) { for (let i = 0; i < 16; i++) { S[i] = a[i]; S[16 + i] = b[i]; } S[32] = W; S[33] = H; }
    return changed;
  }
  function update(dt) {
    if ((ctx.labels?.version ?? 0) !== version) { sync(); animating = true; }
    const cam = ctx.camera;
    idle = false;
    if (!cam || !states.size) return;
    clock += dt || 0;
    const W = innerWidth, H = innerHeight;
    if (!enabled) {
      for (const st of states.values()) if (st.shown) { st.el.style.display = 'none'; st.shown = false; st.alpha = 0; }
      animating = true;
      return;
    }
    cam.updateMatrixWorld();
    const mode0 = ctx.nav?.mode || '';
    const moved = viewChanged(cam, W, H) || mode0 !== lastMode || minPriority !== lastMinPri;
    if (!moved && !animating && !obstaclesMoved && !toMeasure.length && ++idleN % 15 !== 0) {
      obstacleT += dt || 0;
      if (obstacles && obstacleT > OBSTACLE_TTL) sampleObstacles();
      idle = true;
      return;
    }
    idleN = 0;
    lastMode = mode0; lastMinPri = minPriority; obstaclesMoved = false;
    view.copy(cam.matrixWorldInverse);
    proj.copy(cam.projectionMatrix);
    const near = cam.near;
    const mode = ctx.nav?.mode;
    const walk = mode === 'walk';
    // line-of-sight culling whenever the camera is down among the buildings (walk, fly, or a low orbit view)
    const eye = walk || mode === 'fly' || cam.position.y - (ctx.heightAt?.(cam.position.x, cam.position.z) ?? -1e9) < 40;
    const narrow = W < 720;
    const limit = narrow ? 26 : 60;

    // --- project
    cands.length = 0;
    toMeasure.length = 0;
    const cpx = cam.matrixWorld.elements[12], cpy = cam.matrixWorld.elements[13], cpz = cam.matrixWorld.elements[14];
    for (const st of states.values()) {
      st.cand = false;
      if (st.pri < minPriority) continue;
      const p = st.label.position;
      // distance first (world space = view space distance): most labels are out of range, no transform for them
      const maxD = walk && st.kind !== 'landmark' ? Math.min(st.maxD, WALK_MAX) : st.maxD;
      const ddx = p.x - cpx, ddy = p.y - cpy, ddz = p.z - cpz;
      const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
      if (d2 > maxD * maxD) continue;
      v.set(p.x, p.y, p.z, 1).applyMatrix4(view);
      if (v.z > -near) continue;                                  // behind the camera
      const dist = Math.sqrt(d2);
      v.applyMatrix4(proj);
      if (v.w <= 0) continue;
      const sx = (v.x / v.w * 0.5 + 0.5) * W;
      const sy = (-v.y / v.w * 0.5 + 0.5) * H;
      if (sx < 0 || sx > W || sy < 0 || sy > H + 40) continue;
      if (st.dirty) {
        toMeasure.push(st);
        st.rank = st.pri - dist / 6000;
        if (!st.w) continue;                                      // never measured: placed once it is
      }
      // keep labels fully on screen (edge-clipped labels look broken). A landmark whose box would cross the top
      // edge may still hang below its anchor (see the declutter pass), as long as the anchor itself is on screen.
      if (sx - st.w / 2 < 4 || sx + st.w / 2 > W - 4) continue;
      if (st.kind === 'landmark' ? sy > H - 2 : (sy - st.h < 4 || sy > H - 2)) continue;
      // distance fade (far) and near fade (walking right under a label)
      let fade = 1 - clamp((dist - maxD * 0.72) / (maxD * 0.28), 0, 1);
      if (walk && st.kind !== 'landmark') fade *= clamp((dist - 6) / 10, 0, 1);
      if (fade <= 0.02) continue;
      st.sx = sx; st.sy = sy; st.dist = dist; st.fade = fade; st.cand = true;
      // hysteresis: labels already visible win ties, so the layout doesn't flicker
      st.rank = st.pri + (st.was ? 0.6 : 0) - dist / 6000;
      cands.push(st);
    }
    if (toMeasure.length) {
      toMeasure.sort((a, b) => b.rank - a.rank);
      measure(toMeasure, MEASURE_MS);
    }
    cands.sort((a, b) => b.rank - a.rank);

    // --- eye level: line of sight (budgeted, cached). Hidden landmarks rank below everything visible so their
    // faint hints never take the place of a label you can actually see; far hidden ones are dropped.
    let ghosts = 0;
    if (eye) {
      let budget = OCC_PER_FRAME;
      const cp = cam.position;
      for (const st of cands) {
        if (budget <= 0) break;
        // (a result stays valid while the camera has not moved: the world is static)
        if (clock - st.occT < OCC_TTL || Math.abs(cp.x - st.ocx) + Math.abs(cp.y - st.ocy) + Math.abs(cp.z - st.ocz) <= 0.3) continue;
        st.occ = occluded(st, cam) ? 1 : 0;
        st.occT = clock;
        st.ocx = cp.x; st.ocy = cp.y; st.ocz = cp.z;
        budget--;
      }
      for (const st of cands) if (st.occ === 1) st.rank -= 20;
      cands.sort((a, b) => b.rank - a.rank);
    }

    // --- declutter on an occupancy grid
    const gw = Math.ceil(W / CELL) + 1, gh = Math.ceil(H / CELL) + 1;
    if (gw !== gridW || gh !== gridH) { gridW = gw; gridH = gh; grid = new Uint8Array(gw * gh); } else grid.fill(0);
    obstacleT += dt || 0;
    if (obstacles && obstacleT > OBSTACLE_TTL) sampleObstacles();
    const block = (l, t, r, b) => {
      const gx0 = Math.max(0, Math.floor(l / CELL)), gx1 = Math.min(gw - 1, Math.floor(r / CELL));
      const gy0 = Math.max(0, Math.floor(t / CELL)), gy1 = Math.min(gh - 1, Math.floor(b / CELL));
      for (let gy = gy0; gy <= gy1; gy++) grid.fill(2, gy * gw + gx0, gy * gw + gx1 + 1);
    };
    for (const r of obstacleRects) block(r.left, r.top, r.right, r.bottom);
    // 0 = free, else the highest blocker in the box (1 label, 2 panel / margin)
    const test = (x0, x1, y0, y1) => {
      let worst = 0;
      if (y0 < 0) worst = 2;
      for (let gy = Math.max(0, y0); gy <= Math.min(gh - 1, y1); gy++) {
        const row = gy * gw;
        for (let gx = Math.max(0, x0); gx <= Math.min(gw - 1, x1); gx++) {
          const c = grid[row + gx];
          if (c > worst) { worst = c; if (c === 2) return 2; }
        }
      }
      return worst;
    };
    let accepted = 0;
    // road names (roadlabels.js) are laid out part-way through: after the important labels, before the minor ones
    const G = roadHook ? { grid, w: gw, h: gh, cell: CELL } : null;
    let roadsDone = false;
    for (const st of cands) {
      if (G && !roadsDone && st.rank < ROAD_SPLIT) { roadsDone = true; roadHook(G, 'mid'); }
      st.accept = false;
      if (accepted >= limit) continue;
      if (eye) {
        // hidden behind a building / hill: other labels disappear, landmarks stay as a faint hint
        if (st.kind !== 'landmark' && st.occ !== 0) continue;
        if (st.kind === 'landmark' && st.occ === 1) {
          if (st.dist > GHOST_MAX_D || ghosts >= GHOST_MAX) continue;
          ghosts++;
          st.fade *= 0.3;
        }
      }
      const pad = st.kind === 'landmark' ? 4 : 2;
      const x0 = Math.floor((st.sx - st.w / 2 - pad) / CELL), x1 = Math.floor((st.sx + st.w / 2 + pad) / CELL);
      let by0 = st.sy - st.h, by1 = st.sy, flip = 0;
      let res = st.sy - st.h < 4 ? 2 : test(x0, x1, Math.floor((by0 - pad) / CELL), Math.floor((by1 + pad) / CELL));
      if (res === 2 && st.kind === 'landmark') {
        // The box would run into the top edge or a HUD panel (tall skyline landmarks project there): hang it
        // below the anchor instead, on a stem long enough to clear the panel.
        for (let off = FLIP_MIN; off <= FLIP_MAX; off += CELL / 2) {
          const t = st.sy + off;
          if (t + st.ch > H - 2) break;
          if (test(x0, x1, Math.floor((t - pad) / CELL), Math.floor((t + st.ch + pad) / CELL)) === 0) {
            flip = off; by0 = t; by1 = t + st.ch; res = 0;
            break;
          }
        }
      }
      if (res !== 0) continue;
      const y0 = Math.floor((by0 - pad) / CELL), y1 = Math.floor((by1 + pad) / CELL);
      for (let gy = Math.max(0, y0); gy <= Math.min(gh - 1, y1); gy++) {
        const row = gy * gw;
        for (let gx = Math.max(0, x0); gx <= Math.min(gw - 1, x1); gx++) grid[row + gx] = 1;
      }
      st.flip = flip; st.by0 = by0; st.by1 = by1;
      st.accept = true;
      accepted++;
    }
    if (G) {
      if (!roadsDone) roadHook(G, 'mid');
      roadHook(G, 'end');
    }

    // --- apply with smooth fades
    const k = 1 - Math.exp(-(dt || 0.016) * 10);
    animating = false;
    for (const st of states.values()) {
      const target = st.cand && st.accept ? st.fade : 0;
      st.alpha += (target - st.alpha) * k;
      if (target === 0 && st.alpha < 0.03) st.alpha = 0;
      if (Math.abs(target - st.alpha) > 0.01) animating = true;
      st.was = target > 0;
      if (st.alpha <= 0) {
        if (st.shown) { st.el.style.display = 'none'; st.shown = false; }
        continue;
      }
      if (!st.shown) { st.el.style.display = 'block'; st.shown = true; st.o = -1; st.x = -1e4; }
      if (st.cand && st.accept && st.flip !== st.flipShown) {
        st.flipShown = st.flip;
        st.el.classList.toggle('flip', st.flip > 0);
        if (st.flip > 0) st.el.style.setProperty('--stem', `${st.flip}px`);
      }
      if (st.cand) {
        const x = Math.round(st.sx * 2) / 2, y = Math.round(st.sy * 2) / 2;
        if (x !== st.x || y !== st.y) {
          st.el.style.transform = `translate3d(${x}px,${y}px,0)`;
          st.x = x; st.y = y;
        }
      }
      const o = Math.round(st.alpha * 50) / 50;
      if (o !== st.o) {
        st.el.style.opacity = o;
        st.o = o;
      }
    }
  }

  let hovered = null;
  /** Top-most visible, clickable label under a client point (or null). */
  function hitTest(x, y) {
    if (!enabled) return null;
    let best = null;
    for (const st of states.values()) {
      if (!st.shown || !st.accept || st.alpha < 0.45 || st.kind === 'road') continue;
      const pad = 3;
      if (x < st.sx - st.w / 2 - pad || x > st.sx + st.w / 2 + pad || y < st.by0 - pad || y > st.by1 + pad) continue;
      if (!best || st.rank > best.rank) best = st;
    }
    return best;
  }
  function setHover(st) {
    if (st === hovered) return;
    hovered?.el.classList.remove('hover');
    hovered = st || null;
    hovered?.el.classList.add('hover');
  }

  const api = {
    layer,
    update,
    hitTest,
    setHover,
    select: (st) => st && onSelect?.(st.label, st.rec),
    get enabled() { return enabled; },
    setEnabled(on) { enabled = !!on; layer.classList.toggle('off', !enabled); animating = true; },
    setMinPriority(p) { minPriority = Number.isFinite(p) ? p : -Infinity; animating = true; },
    sampleObstacles,
    /** true when this frame's pass was skipped (nothing changed): the previous layout still stands */
    get idle() { return idle; },
    /** Loading time: create every label element, measure every box and build the line-of-sight grid now. */
    prepare() {
      if ((ctx.labels?.version ?? 0) !== version) sync();
      const todo = [];
      for (const st of states.values()) if (st.dirty) todo.push(st);
      measure(todo);
      occluders();
      animating = true;
    },
    // road names share this renderer's declutter grid: fn(grid, 'mid' | 'end') is called during every declutter pass
    setRoadHook(fn) { roadHook = typeof fn === 'function' ? fn : null; },
    count: () => states.size,
    stats: () => { let shown = 0, measured = 0, occ = 0; for (const st of states.values()) { if (st.shown) shown++; if (st.w) measured++; if (st.occ === 1) occ++; } return { total: states.size, candidates: cands.length, shown, measured, occluded: occ, enabled }; },
    remeasure: remeasureAll,
    boxes: () => [...states.values()].map((st) => ({ key: st.key, kind: st.kind, w: st.w, h: st.h, ch: st.ch, shown: st.shown, flip: st.flip, el: st.el })),
    measureStats: mstats,
  };
  return api;
}

/**
 * Adds UI-owned labels for named campus areas (lawns, plazas…) and notable POIs (art, cafés) that no 3D module
 * labels. Skips anything already labelled (same name or a landmark label within 35 m).
 */
export function addAuxLabels(ctx, catalog) {
  const L = ctx.labels;
  if (!L?.add) return 0;
  const existing = [];
  for (const lb of L.items.values()) existing.push(lb);
  const nm = (s) => String(s || '').toLowerCase().trim();
  const taken = new Set(existing.map((l) => nm(l.text)));
  const near = (x, z, r) => existing.some((l) => l.kind === 'landmark' && l.position && Math.hypot(l.position.x - x, l.position.z - z) < r);
  let n = 0;
  for (const rec of catalog.records) {
    if (!rec.position || rec.kind === 'building' || rec.kind === 'landmark') continue;
    if (taken.has(nm(rec.nameEn)) || (rec.osmName && taken.has(nm(rec.osmName)))) continue;
    const [x, y, z] = rec.position;
    if (rec.kind === 'area') {
      const t = rec.type;
      if (!['grass', 'park', 'garden', 'stadium', 'pitch', 'plaza', 'water', 'wood', 'golf', 'bridgeArea', 'playground'].includes(t)) continue;
      if (!rec.campus && !['park', 'golf', 'garden', 'water'].includes(t)) continue;
      if (near(x, z, 35)) continue;
      const big = (rec.areaM2 || 0) > 40000;
      L.add({ key: `ui:${rec.key}`, recKey: rec.key, text: rec.nameEn, textZh: rec.nameZh || '', kind: 'area', priority: big ? 5 : 4, position: { x, y: y + 2, z }, maxDistance: big ? 2200 : 900 });
      n++;
    } else if (rec.kind === 'poi') {
      const t = rec.type;
      const art = t === 'artwork' || t === 'memorial' || t === 'museum' || t === 'fountain';
      const food = t === 'cafe' || t === 'restaurant' || t === 'fast_food' || t === 'library';
      if (!art && !food) continue;
      if (!rec.campus && !art) continue;
      if (near(x, z, 30)) continue;
      L.add({ key: `ui:${rec.key}`, recKey: rec.key, text: rec.nameEn, textZh: rec.nameZh || '', kind: 'poi', priority: art ? 2 : 1, position: { x, y: y + 3, z }, maxDistance: art ? 420 : 240 });
      n++;
    }
  }
  return n;
}
