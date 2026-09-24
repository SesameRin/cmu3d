// Minimap: a pre-rendered north-up canvas of the whole data extent (footprints, roads, paths, greens, water,
// campus boundary) that is blitted around the camera focus every time the view changes, plus a camera marker
// and view cone. Click → fly there (orbit) or walk there (walk mode). Zoom buttons, wheel zoom, collapse, enlarge.
import { h, clamp, isNarrow, storage } from './dom.js';
import { icon } from './icons.js';
import { viewState, cameraHeading, navMode } from './navutil.js';
import { drawMinimapRoadNames } from './roadlabels.js';

const LEVELS = [0.6, 1.2, 2.2, 3.4, 5.5, 8.5];   // metres per CSS pixel

const COLORS = {
  bg: '#1a1d21',
  grass: '#2c4430', park: '#2a422e', garden: '#2f4a33', wood: '#253b28', scrub: '#2e4230', golf: '#30492f',
  pitch: '#35583a', stadium: '#35583a', track: '#6b3b33', playground: '#34503a', flowerbed: '#3d5238',
  water: '#27495e', parking: '#24272c', plaza: '#34373c', pavement: '#34373c', construction: '#3a3528', bridgeArea: '#3b3e44',
  road: '#4d5158', roadMajor: '#6a6e75', path: '#3f444a', rail: '#5b5048',
  bld: '#565a61', bldEdge: '#6c7077', cmu: '#a3303c', cmuEdge: '#e0707b',
  boundary: 'rgba(214,60,80,0.75)', campusTint: 'rgba(196,18,48,0.06)',
};

export function createMinimap(ctx, { root, catalog, getSelected, toast }) {
  const data = ctx.data;
  const b = data?.meta?.bounds || { minX: -800, maxX: 900, minZ: -830, maxZ: 610 };
  const S = ctx.quality?.level === 'low' || isNarrow() ? 0.9 : 1.25;   // offscreen px per metre
  const off = document.createElement('canvas');
  off.width = Math.ceil((b.maxX - b.minX) * S);
  off.height = Math.ceil((b.maxZ - b.minZ) * S);
  prerender(off, data, b, S);

  const canvas = h('canvas.mm-canvas', { 'aria-label': '小地图：点击前往该位置', role: 'img' });
  const zin = h('button.icon-btn.sm', { type: 'button', 'aria-label': '放大地图', title: '放大', html: icon('plus') });
  const zout = h('button.icon-btn.sm', { type: 'button', 'aria-label': '缩小地图', title: '缩小', html: icon('minus') });
  const big = h('button.icon-btn.sm', { type: 'button', 'aria-label': '大地图', title: '大 / 小地图', html: icon('expand') });
  const collapse = h('button.icon-btn.sm', { type: 'button', 'aria-label': '收起地图 (M)', title: '收起 (M)', html: icon('chevD') });
  const fab = h('button.mm-fab.glass', { type: 'button', 'aria-label': '打开地图 (M)', title: '地图 (M)', html: icon('map') });
  const scaleEl = h('span.mm-scale');
  const el = h('section.minimap.glass.hud-hideable', { 'aria-label': '小地图' }, [
    h('header.mm-head', null, [h('span.mm-title', { html: `${icon('map')}<span>校园地图</span>` }), h('span.mm-tools', null, [zout, zin, big, collapse])]),
    h('div.mm-view', null, [canvas, h('span.mm-n', null, 'N'), scaleEl]),
  ]);
  root.appendChild(el);
  root.appendChild(fab);
  fab.classList.add('hud-hideable');

  let level = 3;
  let collapsed = storage.get('cmu3d.minimap') === 'off' || (storage.get('cmu3d.minimap') === null && isNarrow());
  let large = false;
  let roadNamesFailed = false;
  let cw = 0, ch = 0, dpr = 1;
  const view = { cx: 0, cz: 0, mpp: LEVELS[level] };
  // Redrawing the minimap every frame (scaling the whole-map image, laying out and stroking the road names glyph by
  // glyph) cost ~1 ms of main thread per frame and a lot of raster work in the GPU process, which also draws the 3D
  // view. Now:
  //  · the map itself (footprints / roads / greens) is pre-rendered at the zoom level's scale — for the overview
  //    levels the WHOLE map in one modest image (built at load time for the default level, on first use for the
  //    others), for the close-up levels a buffer larger than the view that is re-rendered when the view leaves it —
  //    and a frame only blits the view's window of it 1:1;
  //  · the road names are laid out for the view exactly as before, into an overlay that slides with the map and is
  //    laid out again at most ~6 times a second while the view moves and as soon as it stops;
  //  · a frame is drawn only when something changed, at most ~30 times a second.
  const WHOLE_MAX = 2600;          // device px: largest side of a whole-map level image
  const levelImgs = new Map();     // level → { c, x0, z0, mpp, dpr, w, h } covering the whole map
  const buf = { c: document.createElement('canvas'), x0: 0, z0: 0, mpp: 0, dpr: 0, w: 0, h: 0, valid: false };
  const names = { c: document.createElement('canvas'), cx: NaN, cz: NaN, mpp: 0, cw: 0, ch: 0, dpr: 0, t: -1e9 };
  let lmRecs = null, lmN = -1;     // the catalogue's landmark records (dots)
  let prevFx = NaN, prevFz = NaN;
  const lastSig = new Float64Array(10).fill(NaN);
  let lastDraw = -1e9;
  // redraw interval per CPU degrade level (engine 'perf:degrade'): ~30 → 20 → 12 → 8 Hz; road names likewise
  const DRAW_MS_L = [32, 50, 83, 125], NAMES_MS_L = [160, 250, 400, 600];
  let DRAW_MS = DRAW_MS_L[0], NAMES_MS = NAMES_MS_L[0];
  ctx.events?.on?.('perf:degrade', (e) => {
    const l = Math.max(0, Math.min(DRAW_MS_L.length - 1, Math.round(Number(e?.cpu) || 0)));
    DRAW_MS = DRAW_MS_L[l]; NAMES_MS = NAMES_MS_L[l];
  });
  let dirty = true;

  function applyState() {
    el.classList.toggle('collapsed', collapsed);
    fab.classList.toggle('show', collapsed);
    el.classList.toggle('large', large);
    el.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
    root.classList.toggle('mm-open', !collapsed);
    dirty = true;
  }
  applyState();

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(devicePixelRatio || 1, 2);
    cw = Math.max(1, Math.round(r.width));
    ch = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    buf.valid = false;
    dirty = true;
  }

  function setLevel(i) {
    level = clamp(i, 0, LEVELS.length - 1);
    zin.disabled = level === 0;
    zout.disabled = level === LEVELS.length - 1;
    dirty = true;
  }
  setLevel(level);

  zin.addEventListener('click', () => setLevel(level - 1));
  zout.addEventListener('click', () => setLevel(level + 1));
  big.addEventListener('click', () => { large = !large; big.innerHTML = icon(large ? 'shrink' : 'expand'); applyState(); requestAnimationFrame(resize); setTimeout(resize, 320); });
  collapse.addEventListener('click', () => toggle(false));
  fab.addEventListener('click', () => toggle(true));
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); setLevel(level + (e.deltaY > 0 ? 1 : -1)); }, { passive: false });

  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = view.cx + (e.clientX - r.left - r.width / 2) * view.mpp;
    const z = view.cz + (e.clientY - r.top - r.height / 2) * view.mpp;
    goTo(x, z);
  });

  function goTo(x, z) {
    const nav = ctx.nav;
    if (!nav) return;
    const mode = navMode(ctx);
    const y = ctx.heightAt ? ctx.heightAt(x, z) : 45;
    try {
      if (mode === 'walk' && nav.walkTo) {
        nav.walkTo(x, z, ctx.camera ? cameraHeading(ctx.camera) : 0);
      } else if (nav.flyTo) {
        const st = viewState(ctx);
        const d = clamp(Math.hypot(st.position[0] - st.target[0], st.position[1] - st.target[1], st.position[2] - st.target[2]), 120, 700);
        if (mode === 'fly') {
          const dx = st.target[0] - st.position[0], dz = st.target[2] - st.position[2];
          const l = Math.hypot(dx, dz) || 1;
          nav.flyTo({ target: [x, y, z], position: [x - (dx / l) * 140, y + 90, z - (dz / l) * 140], mode: 'fly' });
        } else nav.flyTo({ target: [x, y + 5, z], distance: d });
      } else nav.setView?.([x + 150, y + 180, z + 200], [x, y, z]);
    } catch (err) { console.warn('[ui] minimap goTo failed', err); }
  }

  function toggle(force) {
    collapsed = force === undefined ? !collapsed : !force;
    storage.set('cmu3d.minimap', collapsed ? 'off' : 'on');
    applyState();
    if (!collapsed) requestAnimationFrame(resize);
  }

  function scaleLabel() {
    const m = 60 * view.mpp;
    const steps = [25, 50, 100, 200, 250, 500, 1000];
    let best = steps[0];
    for (const s of steps) if (s <= m) best = s;
    scaleEl.style.setProperty('--w', `${best / view.mpp}px`);
    scaleEl.textContent = best >= 1000 ? `${best / 1000} km` : `${best} m`;
  }

  function update() {
    if (collapsed || !ctx.camera) return;
    if (!cw) resize();
    const cam = ctx.camera.position;
    let fx = cam.x, fz = cam.z;
    const ot = ctx.nav && 'orbitTarget' in ctx.nav ? ctx.nav.orbitTarget : null;
    if (ot) { fx = ot.x; fz = ot.z; } else if (navMode(ctx) === 'orbit') { const st = viewState(ctx); fx = st.target[0]; fz = st.target[2]; }
    if (!Number.isFinite(fx + fz + cam.x + cam.z)) return;       // broken camera: skip this frame
    const mpp = LEVELS[level];
    // keep the window inside the data (with some slack)
    const hw = (cw * mpp) / 2, hh = (ch * mpp) / 2;
    fx = clamp(fx, b.minX + Math.min(hw, (b.maxX - b.minX) / 2) - 60, b.maxX - Math.min(hw, (b.maxX - b.minX) / 2) + 60);
    fz = clamp(fz, b.minZ + Math.min(hh, (b.maxZ - b.minZ) / 2) - 60, b.maxZ - Math.min(hh, (b.maxZ - b.minZ) / 2) + 60);
    const heading = cameraHeading(ctx.camera);
    if (!Number.isFinite(heading)) return;
    const sel = getSelected?.();
    const now = performance.now();
    const pulse = sel ? Math.floor(now / 50) : 0;
    // redraw only when something visible changed (0.1 m of the view / camera, 0.001 rad of heading), <= ~30 Hz
    const L = lastSig;
    const changed = dirty || names.cx !== view.cx || names.cz !== view.cz || Math.abs(fx - L[0]) > 0.1 || Math.abs(fz - L[1]) > 0.1 || Math.abs(cam.x - L[2]) > 0.1 ||
      Math.abs(cam.z - L[3]) > 0.1 || Math.abs(heading - L[4]) > 0.001 || mpp !== L[5] || cw !== L[6] || ch !== L[7] ||
      pulse !== L[8] || (sel ? 1 : 0) !== L[9];
    if (!changed || now - lastDraw < DRAW_MS) return;
    lastDraw = now; dirty = false;
    L[0] = fx; L[1] = fz; L[2] = cam.x; L[3] = cam.z; L[4] = heading; L[5] = mpp; L[6] = cw; L[7] = ch; L[8] = pulse; L[9] = sel ? 1 : 0;
    draw(cam, heading, sel, fx, fz, mpp);
  }

  // Paint the map (scaled whole-map image, road names, landmark dots) into image `img` whose top-left corner is at
  // world (x0, z0), w × h CSS px at metres-per-px mpp and device ratio d.
  function paintMap(img, x0, z0, w, h, mpp, d) {
    const W = Math.round(w * d), H = Math.round(h * d);
    const c = img.c;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = COLORS.bg;
    g.fillRect(0, 0, W, H);
    const sw = w * mpp * S, sh = h * mpp * S;
    const sx = (x0 - b.minX) * S, sy = (z0 - b.minZ) * S;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    // clip the source rect to the image to avoid browser differences
    const cx0 = Math.max(0, sx), cy0 = Math.max(0, sy), cx1 = Math.min(off.width, sx + sw), cy1 = Math.min(off.height, sy + sh);
    if (cx1 > cx0 && cy1 > cy0) {
      const kx = W / sw, ky = H / sh;
      g.drawImage(off, cx0, cy0, cx1 - cx0, cy1 - cy0, (cx0 - sx) * kx, (cy0 - sy) * ky, (cx1 - cx0) * kx, (cy1 - cy0) * ky);
    }
    Object.assign(img, { x0, z0, mpp, dpr: d, w, h });
  }
  // Road names for the view centred on (cx, cz) (same layout as ever: fitted to this view), into the overlay.
  function layoutNames(cx, cz, mpp) {
    const W = canvas.width, H = canvas.height;
    const c = names.c;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    try { drawMinimapRoadNames(g, data, { cx, cz, mpp, cw, ch, dpr }); } catch (err) { if (!roadNamesFailed) { roadNamesFailed = true; console.warn('[ui] minimap road names failed', err); } }
    Object.assign(names, { cx, cz, mpp, cw, ch, dpr, t: performance.now() });
  }
  const PAD = 80;                  // m of dark margin around the data in a whole-map image
  const wholeFits = (lv) => Math.max(b.maxX - b.minX, b.maxZ - b.minZ) + 2 * PAD <= (WHOLE_MAX / Math.max(1, dpr)) * LEVELS[lv];
  // The whole-map image of a level (built once per level and device ratio), or null for the close-up levels.
  function wholeImage(lv) {
    if (!wholeFits(lv)) return null;
    let img = levelImgs.get(lv);
    if (img && img.dpr === dpr) return img;
    const mpp = LEVELS[lv];
    img = img || { c: document.createElement('canvas') };
    paintMap(img, b.minX - PAD, b.minZ - PAD, Math.ceil((b.maxX - b.minX + 2 * PAD) / mpp), Math.ceil((b.maxZ - b.minZ + 2 * PAD) / mpp), mpp, dpr);
    levelImgs.set(lv, img);
    return img;
  }
  // The close-up buffer: (re-)centred on (fx, fz) when the view gets near its edge.
  function bufferImage(fx, fz, mpp) {
    const B = buf;
    const m = Math.round(Math.max(cw, ch) * 0.5);            // margin (CSS px) on every side of the view
    const w = cw + 2 * m, h = ch + 2 * m;
    const inside = B.valid && B.mpp === mpp && B.dpr === dpr && B.w === w && B.h === h &&
      Math.abs(fx - (B.x0 + (w / 2) * mpp)) / mpp < m * 0.8 && Math.abs(fz - (B.z0 + (h / 2) * mpp)) / mpp < m * 0.8;
    if (!inside) { paintMap(B, fx - (w / 2) * mpp, fz - (h / 2) * mpp, w, h, mpp, dpr); B.valid = true; }
    return B;
  }

  function draw(cam, heading, sel, fx, fz, mpp) {
    const img = wholeImage(level) || bufferImage(fx, fz, mpp);
    const settled = fx === prevFx && fz === prevFz;
    prevFx = fx; prevFz = fz;
    // blit the view's window of the image at a whole device pixel (crisp, no resampling); the view centre follows
    // that snap. Beyond the image (a view larger than the map) the background shows.
    const ox = Math.round(((fx - img.x0) / mpp - cw / 2) * dpr), oy = Math.round(((fz - img.z0) / mpp - ch / 2) * dpr);
    const cx = img.x0 + (ox / dpr + cw / 2) * mpp, cz = img.z0 + (oy / dpr + ch / 2) * mpp;
    view.cx = cx; view.cz = cz; view.mpp = mpp;
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    const W = canvas.width, H = canvas.height;
    const sx0 = Math.max(0, ox), sy0 = Math.max(0, oy), sx1 = Math.min(img.c.width, ox + W), sy1 = Math.min(img.c.height, oy + H);
    if (sx0 > ox || sy0 > oy || sx1 < ox + W || sy1 < oy + H) { g.fillStyle = COLORS.bg; g.fillRect(0, 0, W, H); }
    if (sx1 > sx0 && sy1 > sy0) {
      g.imageSmoothingEnabled = false;
      g.drawImage(img.c, sx0, sy0, sx1 - sx0, sy1 - sy0, sx0 - ox, sy0 - oy, sx1 - sx0, sy1 - sy0);
      g.imageSmoothingEnabled = true;
    }
    // road names: laid out again for this view when it settled / after NAMES_MS, else slid along with the map
    const N = names;
    if (N.mpp !== mpp || N.cw !== cw || N.ch !== ch || N.dpr !== dpr ||
        ((N.cx !== cx || N.cz !== cz) && (settled || performance.now() - N.t >= NAMES_MS))) layoutNames(cx, cz, mpp);
    const nx = Math.round(((N.cx - cx) / mpp) * dpr), nz = Math.round(((N.cz - cz) / mpp) * dpr);
    if (Math.abs(nx) < W && Math.abs(nz) < H) {
      g.imageSmoothingEnabled = false;
      g.drawImage(N.c, nx, nz);
      g.imageSmoothingEnabled = true;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const X = (x) => cw / 2 + (x - cx) / mpp;
    const Z = (z) => ch / 2 + (z - cz) / mpp;

    // landmarks
    if (catalog) {
      if (!lmRecs || lmN !== catalog.records.length) { lmN = catalog.records.length; lmRecs = catalog.records.filter((r) => r.kind === 'landmark' && r.position); }
      for (const r of lmRecs) {
        const x = X(r.position[0]), y = Z(r.position[2]);
        if (x < -5 || y < -5 || x > cw + 5 || y > ch + 5) continue;
        g.beginPath(); g.arc(x, y, 3.2, 0, Math.PI * 2);
        g.fillStyle = '#ffffff'; g.fill();
        g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2);
        g.fillStyle = '#c41230'; g.fill();
      }
    }

    // selection pulse
    if (sel?.position) {
      const x = X(sel.position[0]), y = Z(sel.position[2]);
      const t = (performance.now() % 1400) / 1400;
      g.beginPath(); g.arc(x, y, 5 + t * 12, 0, Math.PI * 2);
      g.strokeStyle = `rgba(255,120,130,${1 - t})`; g.lineWidth = 2; g.stroke();
      g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fillStyle = '#ff5a6a'; g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke();
    }

    // camera marker + view cone
    const px = clamp(X(cam.x), 6, cw - 6), py = clamp(Z(cam.z), 6, ch - 6);
    const cone = ctx.camera.isPerspectiveCamera
      ? 2 * Math.atan(Math.tan((ctx.camera.fov * Math.PI) / 360) * (ctx.camera.aspect || 1)) : 1;
    const R = Math.min(70, Math.max(38, cw * 0.28));
    const a0 = heading - cone / 2 - Math.PI / 2, a1 = heading + cone / 2 - Math.PI / 2;
    const grad = g.createRadialGradient(px, py, 2, px, py, R);
    grad.addColorStop(0, 'rgba(255,236,200,0.55)');
    grad.addColorStop(1, 'rgba(255,236,200,0)');
    g.beginPath(); g.moveTo(px, py); g.arc(px, py, R, a0, a1); g.closePath();
    g.fillStyle = grad; g.fill();
    g.save();
    g.translate(px, py); g.rotate(heading);
    g.beginPath(); g.moveTo(0, -8); g.lineTo(5.5, 5.5); g.lineTo(0, 2.8); g.lineTo(-5.5, 5.5); g.closePath();
    g.fillStyle = '#ffffff'; g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 4; g.fill();
    g.shadowBlur = 0; g.strokeStyle = '#c41230'; g.lineWidth = 1.4; g.stroke();
    g.restore();
    if (mpp !== scaleMpp) { scaleMpp = mpp; scaleLabel(); }
  }
  let scaleMpp = 0;

  addEventListener('resize', () => requestAnimationFrame(resize));

  return {
    el, update, toggle,
    /** Loading time: the whole-map images of the overview zoom levels, not on the first draw / zoom click. */
    prepare() { if (!cw) resize(); for (let lv = 0; lv < LEVELS.length; lv++) wholeImage(lv); },
    get collapsed() { return collapsed; },
    goTo,
  };
}

// ---------------------------------------------------------------- one-time map rendering
function prerender(canvas, data, b, S) {
  const g = canvas.getContext('2d');
  g.fillStyle = COLORS.bg;
  g.fillRect(0, 0, canvas.width, canvas.height);
  if (!data) return;
  const X = (x) => (x - b.minX) * S;
  const Z = (z) => (z - b.minZ) * S;
  const ringPath = (ring) => {
    if (!ring || ring.length < 2) return;
    g.moveTo(X(ring[0][0]), Z(ring[0][1]));
    for (let i = 1; i < ring.length; i++) g.lineTo(X(ring[i][0]), Z(ring[i][1]));
    g.closePath();
  };
  const linePath = (pts) => {
    g.moveTo(X(pts[0][0]), Z(pts[0][1]));
    for (let i = 1; i < pts.length; i++) g.lineTo(X(pts[i][0]), Z(pts[i][1]));
  };

  // campus tint
  g.beginPath();
  for (const ring of data.meta?.campusBoundary || []) ringPath(ring);
  g.fillStyle = COLORS.campusTint; g.fill();

  // areas (sorted large → small already)
  for (const a of data.areas || []) {
    const c = COLORS[a.type];
    if (!c || !a.polygon) continue;
    g.beginPath();
    ringPath(a.polygon);
    for (const hole of a.holes || []) ringPath(hole);
    g.fillStyle = c;
    g.fill('evenodd');
  }

  // roads
  g.lineCap = 'round'; g.lineJoin = 'round';
  const major = new Set(['primary', 'secondary', 'trunk', 'tertiary', 'primary_link']);
  for (const pass of [0, 1]) {
    for (const r of data.roads || []) {
      if (r.tunnel || !r.points?.length) continue;
      const isMajor = major.has(r.type);
      if ((pass === 1) !== isMajor) continue;
      g.beginPath(); linePath(r.points);
      g.strokeStyle = isMajor ? COLORS.roadMajor : COLORS.road;
      g.lineWidth = Math.max(1.2, (r.width || 6) * S * (isMajor ? 1 : 0.9));
      g.stroke();
    }
  }
  // paths
  g.strokeStyle = COLORS.path;
  g.lineWidth = Math.max(0.8, 1.6 * S);
  g.beginPath();
  for (const p of data.paths || []) if (!p.indoor && !p.tunnel && p.points?.length) linePath(p.points);
  g.stroke();
  // rail
  g.setLineDash([3 * S, 3 * S]);
  g.strokeStyle = COLORS.rail; g.lineWidth = 1.6 * S;
  g.beginPath();
  for (const r of data.railways || []) if (!r.tunnel && r.points?.length) linePath(r.points);
  g.stroke();
  g.setLineDash([]);

  // buildings
  g.lineWidth = Math.max(0.6, 0.6 * S);
  for (const campus of [false, true]) {
    g.beginPath();
    for (const bd of data.buildings || []) {
      if (!!bd.campus !== campus || !bd.footprint) continue;
      ringPath(bd.footprint);
      for (const hole of bd.holes || []) ringPath(hole);
    }
    g.fillStyle = campus ? COLORS.cmu : COLORS.bld;
    g.fill('evenodd');
    g.strokeStyle = campus ? COLORS.cmuEdge : COLORS.bldEdge;
    g.stroke();
  }

  // campus boundary
  g.setLineDash([5 * S, 4 * S]);
  g.strokeStyle = COLORS.boundary; g.lineWidth = 1.8 * S;
  g.beginPath();
  for (const ring of data.meta?.campusBoundary || []) ringPath(ring);
  g.stroke();
  g.setLineDash([]);
}
