// Canvas-painted materials for the east-Mall landmarks. Built lazily once per ctx.materials instance and shared
// by CFA, Margaret Morrison, Hunt Library and Posner Hall (so shared looks cost one texture each).
import * as THREE from 'three';
import { prng } from './mallEast-kit.js';

const CACHE = new WeakMap();

// Hornbostel palette (cream Kittanning brick, cream terracotta, pale grey-green metal roofs, green copper).
// Roofs: the Hornbostel buildings were originally roofed with green Ludowici tile; today CFA and Margaret Morrison
// show pale grey-green standing-seam hips with green-copper eaves (Commons photos 2023–24, Esri imagery), matching
// the green-grey roofs of Baker / Porter / Hamerschlag at the other end of the Mall.
export const HB = {
  roof: '#9aa89e',
  roofEave: '#5f8a76',
  brick: '#d4bd90',
  brickDark: '#b99e70',
  brickStripe: '#9c6b4a',
  terracotta: '#e3d6b8',
  terracottaShade: '#cdbd9b',
  limestone: '#d6cbb3',
  granite: '#8f8a84',
  frame: '#3e3d37',
  polyBlue: '#4d7390',
  polyGreen: '#5f8a6a',
  polyRed: '#a8553c',
  polyGold: '#c9a55a',
};

// CPU-backed 2D canvases: cheap for the many small fills / putImageData these painters issue, and never a
// synchronous GPU readback (the context is created here so later getContext('2d') calls reuse it).
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d', { willReadFrequently: true });
  return c;
}
function shade(hex, f) {
  const c = new THREE.Color(hex);
  const hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * f)));
  return `#${c.getHexString()}`;
}
function jitter(hex, r, a = 0.07) { return shade(hex, 1 + (r() - 0.5) * 2 * a); }
// Same as jitter() but picks from 16 pre-shaded variants (no THREE.Color / hex string per call — used per brick).
const PALETTES = new Map();
function jitterPick(hex, r, a = 0.07) {
  const key = `${hex}|${a}`;
  let p = PALETTES.get(key);
  if (!p) { p = []; for (let i = 0; i < 16; i++) p.push(shade(hex, 1 + ((i + 0.5) / 16 - 0.5) * 2 * a)); PALETTES.set(key, p); }
  return p[(r() * 16) | 0];
}

// Running-bond brick into a region (canvas y down). stripe: fn(courseIndex) → colour override or null.
function paintBrick(g, x0, y0, w, h, color, pxPerM, r, { stripe = null, courseH = 0.075, brickW = 0.225, mortar = null, yRef = null } = {}) {
  g.fillStyle = mortar || shade(color, 1.16);
  g.fillRect(x0, y0, w, h);
  const bh = courseH * pxPerM, bw = brickW * pxPerM, j = Math.max(1, 0.011 * pxPerM);
  // courses counted upward from the bottom of the region so stripes line up with v=0
  const bottom = yRef ?? (y0 + h);
  const nRows = Math.ceil(h / bh) + 2;
  for (let k = 0; k < nRows; k++) {
    const yb = bottom - k * bh;
    const yt = yb - bh + j;
    if (yb <= y0) break;
    if (yt >= y0 + h) continue;
    const col = (stripe && stripe(k)) || color;
    const off = (k % 2) * bw / 2;
    for (let x = x0 - off; x < x0 + w; x += bw) {
      g.fillStyle = jitterPick(col, r, 0.075);
      const xa = Math.max(x0, x), xb = Math.min(x0 + w, x + bw - j);
      const ya = Math.max(y0, yt), yb2 = Math.min(y0 + h, yb);
      if (xb > xa && yb2 > ya) g.fillRect(xa, ya, xb - xa, yb2 - ya);
    }
  }
}

// Speckle: random light/dark size×size blocks blended into the canvas. A small tile of translucent black/white
// specks is generated once per (alpha, size, cover) and laid down as a pattern with a random phase: the blend is
// the same as lerping each speck toward black/white by alpha·rand, but it costs one fillRect instead of a
// getImageData / per-pixel JS loop / putImageData round trip over the whole canvas (~450 ms of the Mall East
// build at 4× CPU throttling). n = number of specks (default: a third of the blocks).
const SPECKLES = new Map();
const SPECK_TILE = 128;
function speckleTile(alpha, size, cover) {
  const key = `${alpha}|${size}|${cover}`;
  let c = SPECKLES.get(key);
  if (c) return c;
  const S = SPECK_TILE;
  c = canvas(S, S);
  const g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
  const r = prng(4099 + Math.round(alpha * 1000) * 13 + size * 7 + Math.round(cover * 100));
  for (let by = 0; by < S; by += size) {
    for (let bx = 0; bx < S; bx += size) {
      if (r() > cover) continue;
      const v = r() > 0.5 ? 255 : 0, a = Math.round(255 * alpha * r());
      for (let y = by; y < Math.min(S, by + size); y++) {
        for (let x = bx; x < Math.min(S, bx + size); x++) { const k = (y * S + x) * 4; d[k] = d[k + 1] = d[k + 2] = v; d[k + 3] = a; }
      }
    }
  }
  g.putImageData(img, 0, 0);
  SPECKLES.set(key, c);
  return c;
}
function noise(g, w, h, r, alpha = 0.05, size = 2, n = null) {
  w = Math.round(w); h = Math.round(h);
  if (w <= 0 || h <= 0) return;
  const cover = n != null ? Math.min(1, (n * size * size) / (w * h)) : 1 / 3;
  const pat = g.createPattern(speckleTile(alpha, size, Math.round(cover * 100) / 100), 'repeat');
  pat.setTransform?.(new DOMMatrix().translateSelf(Math.floor(r() * SPECK_TILE / size) * size, Math.floor(r() * SPECK_TILE / size) * size));
  g.save();
  g.fillStyle = pat;
  g.fillRect(0, 0, w, h);
  g.restore();
}

// Linear mix of two hex colours (t = weight of b).
function mix(a, b, t) { return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`; }

// Seamless running-bond tile (24 bricks × 28 courses ≈ 5.4 × 2.1 m; the 7-course stripe period divides it) for
// the painted facades: painted once per (colour, stripes, px/m) and pattern-filled into every facade instead of
// one fillRect per brick per facade (~20 000 per CFA wall). Below ~2 px per course there is no room for a mortar
// joint, so the bricks are painted as a joint-less blend with the same average tone.
const BRICK_TILES = new Map();
const BRICK_NB = 24, BRICK_NC = 28, BRICK_W = 0.225, BRICK_H = 0.075;
const stripeOf = (kind) => (kind === 'stripes' ? (k) => ((k % 7) >= 5 ? HB.brickStripe : null) : null);
function brickTile(color, ppm, kind = 'plain') {
  const key = `${color}|${ppm}|${kind}`;
  let c = BRICK_TILES.get(key);
  if (c) return c;
  const W = Math.max(8, Math.round(BRICK_NB * BRICK_W * ppm)), H = Math.max(8, Math.round(BRICK_NC * BRICK_H * ppm));
  const bw = W / BRICK_NB, bh = H / BRICK_NC, j = Math.max(1, 0.011 * ppm);
  const blend = bh - j < 0.8;
  const mortar = shade(color, 1.16);
  // joint-less blend: roughly the brick/mortar area ratio seen at 26 px/m (≈ 45 % brick face)
  const tone = (col) => (blend ? mix(col, shade(col, 1.16), 0.55) : col);
  const stripe = stripeOf(kind);
  const r = prng(Math.round(ppm * 97) + (kind === 'stripes' ? 7 : 3));
  c = canvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = blend ? tone(color) : mortar;
  g.fillRect(0, 0, W, H);
  const jj = blend ? 0 : j;
  for (let k = 0; k < BRICK_NC; k++) {
    const yb = H - k * bh, yt = yb - bh + jj;   // courses counted up from the bottom (stripes line up with v = 0)
    const col = tone((stripe && stripe(k)) || color);
    const off = (k % 2) * bw / 2;
    for (let i = 0; i < BRICK_NB; i++) {
      const x = i * bw - off, w = bw - jj;
      g.fillStyle = jitterPick(col, r, blend ? 0.045 : 0.075);   // (the blend has no joints to break it up)
      g.fillRect(x, yt, w, yb - yt);
      if (x < 0) g.fillRect(x + W, yt, w, yb - yt);   // the half brick wraps to the right edge in the same colour
    }
  }
  BRICK_TILES.set(key, c);
  return c;
}
// Pattern-fill a brick field into (0, 0, w, h) with course 0 on the bottom edge; phase: random u offset.
function fillBrick(g, w, h, color, ppm, kind, r) {
  const tile = brickTile(color, ppm, kind);
  const pat = g.createPattern(tile, 'repeat');
  pat.setTransform?.(new DOMMatrix().translateSelf(Math.floor(r() * tile.width), ((h % tile.height) + tile.height) % tile.height));
  g.save();
  g.fillStyle = pat;
  g.fillRect(0, 0, w, h);
  g.restore();
}

// release (default): drop the canvas backing store once three has uploaded it — the GPU keeps its own copy and
// none of these textures is ever repainted after its first upload (after a WebGL context restore the page
// reloads, see main.js). Every texture here owns its canvas (textures reused as map + emissiveMap are the same
// Texture object, uploaded once).
function tex(c, { repeat = [1, 1], wrapT = true, color = true, aniso = 8, release = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = wrapT ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  if (release) {
    t.onUpdate = () => {
      t.onUpdate = null;
      const img = t.image;
      if (img && typeof img.getContext === 'function') { img.width = 1; img.height = 1; }
    };
  }
  t.needsUpdate = true;
  return t;
}

// Window pane path (canvas y down) for arched / rect / segmental heads.
function windowPath(g, x, yTop, w, h, shape) {
  g.beginPath();
  if (shape === 'arch') {
    const r = w / 2;
    g.moveTo(x, yTop + h); g.lineTo(x, yTop + r); g.arc(x + r, yTop + r, r, Math.PI, 0); g.lineTo(x + w, yTop + h);
  } else if (shape === 'seg') {
    const s = w * 0.16;
    g.moveTo(x, yTop + h); g.lineTo(x, yTop + s); g.quadraticCurveTo(x + w / 2, yTop - s, x + w, yTop + s); g.lineTo(x + w, yTop + h);
  } else {
    g.rect(x, yTop, w, h);
  }
  g.closePath();
}

// Glass pane with muntins painted into (x, yTop, w, h) of a map canvas; also paints emissive / rough canvases.
function paintWindow(gm, ge, gr, x, yTop, w, h, shape, { frame = HB.frame, glass = '#51697a', lit = false, r, px = 30, mullions = 2, transom = 0.62 } = {}) {
  const fr = Math.max(1.5, 0.07 * px);
  // reveal shadow
  gm.save();
  gm.fillStyle = 'rgba(40,30,20,0.55)';
  windowPath(gm, x - fr * 1.2, yTop - fr * 1.2, w + fr * 2.4, h + fr * 1.4, shape); gm.fill();
  windowPath(gm, x, yTop, w, h, shape); gm.clip();
  const grd = gm.createLinearGradient(x, yTop, x + w * 0.4, yTop + h);
  grd.addColorStop(0, shade(glass, 1.55)); grd.addColorStop(0.5, glass); grd.addColorStop(1, shade(glass, 0.55));
  gm.fillStyle = grd; gm.fillRect(x, yTop, w, h);
  // interior hint: blinds / curtains
  if (r() < 0.45) { gm.fillStyle = `rgba(232,224,204,${0.25 + r() * 0.3})`; gm.fillRect(x, yTop, w, h * (0.12 + r() * 0.35)); }
  // sashes
  gm.strokeStyle = frame; gm.lineWidth = fr;
  windowPath(gm, x + fr / 2, yTop + fr / 2, w - fr, h - fr, shape); gm.stroke();
  gm.fillStyle = frame;
  for (let i = 1; i < mullions; i++) gm.fillRect(x + (w * i) / mullions - fr / 3, yTop, fr * 0.7, h);
  gm.fillRect(x, yTop + h * (1 - transom), w, fr * 0.9);
  gm.fillRect(x, yTop + h * (1 - transom) + (h * transom) / 2, w, fr * 0.5);
  gm.restore();
  if (gr) { gr.fillStyle = '#2a2a2a'; windowPath(gr, x, yTop, w, h, shape); gr.fill(); }
  if (ge && lit) {
    const warm = 175 + ((r() * 60) | 0);
    ge.fillStyle = `rgba(255,${warm + 25},${warm - 45},${0.6 + r() * 0.4})`;
    windowPath(ge, x + fr, yTop + fr, w - 2 * fr, h - 2 * fr, shape); ge.fill();
  }
}

// The speckle / brick tiles are only needed while the landmarks paint (all before the first frame); drop them
// then (they are simply rebuilt if anything paints later).
function releaseTiles() {
  for (const m of [SPECKLES, BRICK_TILES]) { for (const c of m.values()) { c.width = 1; c.height = 1; } m.clear(); }
}

export function getKitMaterials(ctx) {
  const M = ctx.materials;
  if (CACHE.has(M)) return CACHE.get(M);
  if (ctx.onUpdate) { const off = ctx.onUpdate(() => { off(); releaseTiles(); }, 50); }
  const maxAniso = Math.min(8, ctx.renderer?.capabilities?.getMaxAnisotropy?.() ?? 4);
  const low = ctx.quality?.level === 'low';
  const cache = new Map();
  const once = (key, fn) => { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); };
  const std = (o, name) => { const m = new THREE.MeshStandardMaterial(o); m.name = name; return m; };
  // Materials the four buildings have in common: their triangles are merged across buildings (see
  // mallEast-kit settleMallEast / Bag.build({ share })).
  const shared = new Set();
  const sh = (m) => { shared.add(m); return m; };

  const K = {
    HB,
    shared,
    // ---------------------------------------------------------------- masonry & trim
    brick: () => once('brick', () => sh(std({ map: M.surfaceTexture('brick', HB.brick, 2.4, 11), roughness: 0.9 }, 'me-brick'))),
    terracotta: () => once('terracotta', () => sh(std({ map: M.surfaceTexture('stone', HB.terracotta, 3, 12), roughness: 0.62 }, 'me-terracotta'))),
    // smooth trim for mouldings / columns (subtle noise only)
    trim: () => once('trim', () => sh(std({ map: M.surfaceTexture('plain', HB.terracotta, 3, 13), roughness: 0.6 }, 'me-trim'))),
    limestone: () => once('limestone', () => sh(std({ map: M.surfaceTexture('stone', HB.limestone, 4, 14), roughness: 0.82 }, 'me-limestone'))),
    granite: () => once('granite', () => sh(std({ map: M.surfaceTexture('stone', HB.granite, 3, 15), roughness: 0.75 }, 'me-granite'))),
    // Hornbostel roofs: pale grey-green standing seam (seams every 0.5 m, u = along the eave) + green-copper eaves.
    roof: () => once('roof', () => sh(std({ map: M.surfaceTexture('seam', HB.roof, 2, 31), roughness: 0.6, metalness: 0.2, envMapIntensity: 0.9 }, 'me-roof'))),
    eave: () => once('eave', () => sh(std({ map: M.surfaceTexture('copper', HB.roofEave, 2, 32), roughness: 0.5, metalness: 0.35 }, 'me-eave-copper'))),
    copper: () => sh(M.get('copperRoof')),
    flatRoof: () => sh(M.get('flatRoof')),
    paver: () => sh(M.get('paver')),
    bronze: () => sh(M.get('bronze')),
    darkMetal: () => sh(M.get('darkMetal')),
    metalPaint: () => once('metalPaint', () => sh(std({ color: '#44504a', roughness: 0.5, metalness: 0.6 }, 'me-metal-paint'))),
    // glowing lamp globes (emissive only at night)
    lamp: () => once('lamp', () => {
      const m = std({ color: '#efe6d2', roughness: 0.3, emissive: new THREE.Color('#ffcf8a') }, 'me-lamp');
      M.registerNightMaterial(m, 2.2);
      return sh(m);
    }),
    walkHidden: () => once('walkHidden', () => new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })),

    // MMCH rooftop Intelligent Workplace: clear glazing between aluminium mullions every 1.5 m, transoms,
    // cool interior light at night. u = metres along the wall, v = metres above the penthouse floor (0..3.6).
    iwGlass: () => once('iwGlass', () => {
      const ppm = 40, TW = 1.5, TH = 3.6, W = Math.round(TW * ppm), H = Math.round(TH * ppm);
      const cm = canvas(W, H), gm = cm.getContext('2d'), ce = canvas(W, H), ge = ce.getContext('2d');
      const grd = gm.createLinearGradient(0, 0, W * 0.3, H);
      grd.addColorStop(0, '#b9cad3'); grd.addColorStop(0.45, '#6e8591'); grd.addColorStop(1, '#3c4a52');
      gm.fillStyle = grd; gm.fillRect(0, 0, W, H);
      gm.fillStyle = 'rgba(225,230,228,0.35)'; gm.fillRect(0, H - 0.9 * ppm, W, 0.9 * ppm); // blinds / desks line
      ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
      const g2 = ge.createLinearGradient(0, 0, 0, H);
      g2.addColorStop(0, 'rgba(235,245,255,1)'); g2.addColorStop(1, 'rgba(200,220,235,0.55)');
      ge.fillStyle = g2; ge.fillRect(0, 0, W, H);
      gm.fillStyle = '#c3c7c9'; ge.fillStyle = '#000';
      for (const [x, y, w, h] of [[0, 0, 4, H], [0, H - 3, W, 3], [0, H - 0.95 * ppm, W, 3], [0, H - 2.75 * ppm, W, 3], [0, 0, W, 4]]) { gm.fillRect(x, y, w, h); ge.fillRect(x, y, w, h); }
      const m = std({ map: tex(cm, { repeat: [1 / TW, 1 / TH], wrapT: false, aniso: maxAniso }), emissiveMap: tex(ce, { repeat: [1 / TW, 1 / TH], wrapT: false, aniso: maxAniso }),
        emissive: new THREE.Color('#e8f0ff'), roughness: 0.1, metalness: 0.4, envMapIntensity: 1.2 }, 'me-iw-glass');
      M.registerNightMaterial(m, 0.45);
      return m;
    }),

    // MMCH "stripey" brick: bands of cream and a warm brown course pattern (v in metres from the datum)
    stripes: () => once('stripes', () => {
      const px = 256, tile = 2.1, ppm = px / tile, r = prng(21);
      const c = canvas(px, px), g = c.getContext('2d');
      paintBrick(g, 0, 0, px, px, HB.brick, ppm, r, { stripe: (k) => ((k % 7) >= 5 ? HB.brickStripe : null) });
      noise(g, px, px, r, 0.04, 2);
      return std({ map: tex(c, { repeat: [1 / tile, 1 / tile], aniso: maxAniso }), roughness: 0.9 }, 'me-stripes');
    }),

    // ---------------------------------------------------------------- windows (unit UV per pane)
    // lit=true variant glows at night; both look identical by day.
    window: (lit = false) => once(`window:${lit}`, () => {
      const W = 128, H = 256, r = prng(lit ? 5 : 3);
      const cm = canvas(W, H), gm = cm.getContext('2d');
      const ce = canvas(W, H), ge = ce.getContext('2d');
      gm.fillStyle = HB.frame; gm.fillRect(0, 0, W, H);
      ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
      const fr = 6;
      const grd = gm.createLinearGradient(0, 0, W * 0.5, H);
      grd.addColorStop(0, '#9fb4c2'); grd.addColorStop(0.45, '#4f6676'); grd.addColorStop(1, '#27343d');
      gm.fillStyle = grd; gm.fillRect(fr, fr, W - 2 * fr, H - 2 * fr);
      gm.fillStyle = 'rgba(235,228,210,0.28)'; gm.fillRect(fr, fr, W - 2 * fr, H * 0.18);
      gm.fillStyle = HB.frame;
      gm.fillRect(W / 2 - 3, 0, 6, H);             // centre mullion
      gm.fillRect(0, H * 0.42, W, 7);               // meeting rail
      for (const y of [0.2, 0.66]) gm.fillRect(0, H * y, W, 3);
      for (const x of [0.25, 0.75]) gm.fillRect(W * x - 1.5, 0, 3, H);
      if (lit) {
        const g2 = ge.createLinearGradient(0, 0, 0, H);
        g2.addColorStop(0, 'rgba(255,214,150,1)'); g2.addColorStop(1, 'rgba(255,190,120,0.75)');
        ge.fillStyle = g2; ge.fillRect(fr, fr, W - 2 * fr, H - 2 * fr);
        ge.fillStyle = '#000';
        ge.fillRect(W / 2 - 3, 0, 6, H); ge.fillRect(0, H * 0.42, W, 7);
      }
      const m = std({ map: tex(cm, { aniso: maxAniso }), roughness: 0.12, metalness: 0.35, envMapIntensity: 1.2 }, lit ? 'me-window-lit' : 'me-window');
      if (lit) {
        m.emissive = new THREE.Color('#ffc987');
        m.emissiveMap = tex(ce, { aniso: maxAniso });
        M.registerNightMaterial(m, 1.5);
      }
      return sh(m);
    }),

    // ---------------------------------------------------------------- painted Hornbostel facade
    // spec: { key, bay, bays, height, wall:'brick'|'stripes', base:{h,color}, bands:[{y0,y1,color,poly}],
    //         rows:[{sill, w, h, shape, every, offset, lintel}], lit, seed }
    // v = metres above the facade datum (ClampToEdge vertically), u tiles every bays*bay metres.
    // Resolution: 26 px/m (a brick course ≈ 2 px); 13 px/m at quality 'low' — a quarter of the pixels to paint,
    // upload and keep on the GPU, and the windows still read at campus distances.
    facade: (spec) => once(`facade:${spec.key}`, () => {
      const ppm = spec.ppm || (low ? 13 : 26);
      const tileW = spec.bay * spec.bays, H = spec.height;
      const Wp = Math.round(tileW * ppm), Hp = Math.round(H * ppm);
      const r = prng(spec.seed || 7);
      const cm = canvas(Wp, Hp), gm = cm.getContext('2d');
      const ce = canvas(Wp, Hp), ge = ce.getContext('2d');
      const cr = canvas(Wp, Hp), gr = cr.getContext('2d');
      ge.fillStyle = '#000'; ge.fillRect(0, 0, Wp, Hp);
      gr.fillStyle = '#e0e0e0'; gr.fillRect(0, 0, Wp, Hp);
      const Y = (v) => Hp - v * ppm; // metres above datum → canvas y
      fillBrick(gm, Wp, Hp, spec.brick || HB.brick, ppm, spec.wall === 'stripes' ? 'stripes' : 'plain', r);
      noise(gm, Wp, Hp, r, 0.035, ppm >= 20 ? 2 : 1);   // specks ≈ 8 cm at either resolution
      for (const b of spec.bands || []) {
        const y0 = Y(b.y1), h = (b.y1 - b.y0) * ppm;
        gm.fillStyle = b.color; gm.fillRect(0, y0, Wp, h);
        gm.fillStyle = 'rgba(0,0,0,0.18)'; gm.fillRect(0, y0 + h - Math.max(1, 0.05 * ppm), Wp, Math.max(1, 0.05 * ppm));
        gm.fillStyle = 'rgba(255,255,255,0.18)'; gm.fillRect(0, y0, Wp, Math.max(1, 0.04 * ppm));
        if (b.poly) {
          // polychrome terracotta frieze: medallions and lozenges in blue/green/gold on cream
          const step = spec.bay / 2 * ppm;
          for (let x = step / 2; x < Wp; x += step) {
            const cy = y0 + h / 2, rr = Math.min(h * 0.32, step * 0.3);
            gm.fillStyle = HB.polyBlue; gm.beginPath(); gm.arc(x, cy, rr, 0, Math.PI * 2); gm.fill();
            gm.fillStyle = HB.polyGold; gm.beginPath(); gm.arc(x, cy, rr * 0.45, 0, Math.PI * 2); gm.fill();
            gm.fillStyle = HB.polyGreen;
            gm.beginPath(); gm.moveTo(x + step / 2, cy - rr); gm.lineTo(x + step / 2 + rr * 0.8, cy); gm.lineTo(x + step / 2, cy + rr); gm.lineTo(x + step / 2 - rr * 0.8, cy); gm.fill();
          }
          gm.fillStyle = HB.polyRed; gm.fillRect(0, y0 + 1, Wp, Math.max(1, 0.05 * ppm)); gm.fillRect(0, y0 + h - Math.max(2, 0.08 * ppm), Wp, Math.max(1, 0.05 * ppm));
        }
        if (b.rust) {
          gm.fillStyle = 'rgba(0,0,0,0.22)';
          for (let y = y0 + b.rust * ppm; y < y0 + h; y += b.rust * ppm) gm.fillRect(0, y, Wp, Math.max(1, 0.03 * ppm));
        }
      }
      for (const row of spec.rows || []) {
        for (let b = 0; b < spec.bays; b++) {
          if (row.every && ((b + (row.offset || 0)) % row.every) !== 0) continue;
          const cx = (b + 0.5) * spec.bay * ppm;
          const w = row.w * ppm, h = row.h * ppm;
          const x = cx - w / 2, yTop = Y(row.sill + row.h);
          if (row.shape === 'door') {
            gm.fillStyle = 'rgba(30,22,15,0.6)'; windowPath(gm, x - 3, yTop - 3, w + 6, h + 3, 'arch'); gm.fill();
            gm.fillStyle = '#4a3a2a'; windowPath(gm, x, yTop, w, h, 'arch'); gm.fill();
            gm.fillStyle = '#6a5438'; gm.fillRect(x + w * 0.08, yTop + w / 2 + h * 0.08, w * 0.38, h - w / 2 - h * 0.1); gm.fillRect(x + w * 0.54, yTop + w / 2 + h * 0.08, w * 0.38, h - w / 2 - h * 0.1);
            paintWindow(gm, null, null, x + w * 0.1, yTop + w * 0.08, w * 0.8, w * 0.42, 'seg', { r, px: ppm });
            continue;
          }
          if (row.surround) {
            gm.fillStyle = row.surround;
            windowPath(gm, x - 0.22 * ppm, yTop - 0.22 * ppm, w + 0.44 * ppm, h + 0.22 * ppm, row.shape); gm.fill();
          }
          const lit = r() < (spec.lit ?? 0.4);
          paintWindow(gm, ge, gr, x, yTop, w, h, row.shape, { r, px: ppm, lit, mullions: row.mullions || 2, transom: row.transom ?? 0.62 });
          if (row.panel) {
            // carved spandrel panel filling the bottom of the opening (CFA upper storey)
            const ph = row.panel * ppm, py = yTop + h - ph;
            gm.fillStyle = row.panelColor || HB.terracotta; gm.fillRect(x, py, w, ph);
            gm.fillStyle = 'rgba(0,0,0,0.2)'; gm.fillRect(x, py, w, Math.max(1, 0.05 * ppm));
            gm.strokeStyle = 'rgba(110,92,62,0.6)'; gm.lineWidth = Math.max(1, 0.04 * ppm);
            gm.strokeRect(x + 0.12 * ppm, py + 0.12 * ppm, w - 0.24 * ppm, ph - 0.24 * ppm);
            gm.beginPath(); gm.moveTo(x + w / 2, py + 0.2 * ppm); gm.lineTo(x + w - 0.3 * ppm, py + ph / 2);
            gm.lineTo(x + w / 2, py + ph - 0.2 * ppm); gm.lineTo(x + 0.3 * ppm, py + ph / 2); gm.closePath(); gm.stroke();
            ge.fillStyle = '#000'; ge.fillRect(x, py, w, ph);
            gr.fillStyle = '#e0e0e0'; gr.fillRect(x, py, w, ph);
          }
          // sill / keystone / lintel
          gm.fillStyle = row.sillColor || HB.terracotta;
          gm.fillRect(x - 0.12 * ppm, Y(row.sill) - 1, w + 0.24 * ppm, Math.max(2, 0.12 * ppm));
          if (row.shape === 'arch' && row.keystone !== false) {
            gm.fillStyle = HB.terracotta;
            gm.beginPath();
            gm.moveTo(cx - 0.16 * ppm, yTop - 0.3 * ppm); gm.lineTo(cx + 0.16 * ppm, yTop - 0.3 * ppm);
            gm.lineTo(cx + 0.11 * ppm, yTop + 0.06 * ppm); gm.lineTo(cx - 0.11 * ppm, yTop + 0.06 * ppm); gm.fill();
          }
          if (row.lintel) {
            gm.fillStyle = row.lintel;
            gm.fillRect(x - 0.18 * ppm, yTop - 0.3 * ppm, w + 0.36 * ppm, 0.3 * ppm);
          }
        }
      }
      const repeat = [1 / tileW, 1 / H];
      const m = std({
        map: tex(cm, { repeat, wrapT: false, aniso: maxAniso }),
        roughnessMap: tex(cr, { repeat, wrapT: false, color: false, aniso: maxAniso }),
        emissiveMap: tex(ce, { repeat, wrapT: false, aniso: maxAniso }),
        emissive: new THREE.Color('#ffc987'), roughness: 0.95, metalness: 0.05,
      }, `me-facade-${spec.key}`);
      M.registerNightMaterial(m, 1.35);
      return m;
    }),

    // ---------------------------------------------------------------- inscriptions / text strips
    // A carved-letter strip: text centred, canvas sized for the given metres; uv 0..1 across the strip.
    // (quality 'low': 0.6 × the resolution — the letters stay ≥ ~12 px tall)
    text: (key, { text, wM, hM, font = 'Georgia, "Times New Roman", serif', weight = '600', bg = HB.terracotta, ink = '#6e6250', ppm = 90, letterSpacing = 0.12, fill = 0.62, gilt = false, items = null, condense = 1 }) => once(`text:${key}`, () => {
      const W = Math.min(4096, Math.round(wM * ppm * (low ? 0.6 : 1))), H = Math.max(16, Math.round(hM * (W / wM)));
      const c = canvas(W, H), g = c.getContext('2d');
      const r = prng(key.length * 31);
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      noise(g, W, H, r, 0.05, 2, (W * H) / 40);
      const drawAt = (str, cx, size) => {
        g.font = `${weight} ${size}px ${font}`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        const spaced = str.split('').join(letterSpacing > 0 ? ' ' : '');
        // carved look: dark cut + light lower lip
        g.save(); g.translate(cx, 0); g.scale(condense, 1);
        g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillText(spaced, 1, H / 2 + 1.5);
        g.fillStyle = gilt ? '#b8923f' : ink; g.fillText(spaced, 0, H / 2);
        g.restore();
      };
      if (items) {
        for (const it of items) drawAt(it.text, it.u * W, H * (it.size || fill));
      } else {
        let size = H * fill;
        g.font = `${weight} ${size}px ${font}`;
        const tw = g.measureText(text.split('').join(' ')).width;
        if (tw * condense > W * 0.96) size *= (W * 0.96) / (tw * condense);
        drawAt(text, W / 2, size);
      }
      return std({ map: tex(c, { aniso: maxAniso }), roughness: 0.7 }, `me-text-${key}`);
    }),
  };
  CACHE.set(M, K);
  return K;
}

// Exposed painters for landmark-specific canvases
export const painters = { canvas, shade, jitter, paintBrick, noise, tex, windowPath, paintWindow };
