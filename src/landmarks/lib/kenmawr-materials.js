// Canvas-painted materials for the Shady Avenue landmarks (kenmawr.js): the Kenmawr's orange-red 1950s face brick
// (plain for the detailed model, and a painted facade with its window rhythm for the distant one), limestone trim,
// the flat roof, a small trim atlas (louvred AC sleeves, the canopy fascia, oak church doors), Calvary's pale
// limestone ashlar and dark slate, Sacred Heart's grey rock-faced ashlar, leaded stained glass and a pierced
// (quatrefoil) parapet. Everything is generated at runtime and cached per context; canvases are released after
// the upload (none of these textures is ever repainted). Relief normal maps are computed from analytic height
// fields (no canvas read-back).
//
// UV convention (ARCHITECTURE.md): metres; walls u = metres along the wall, v = metres above a reference level.
import * as THREE from 'three';
import { prng } from './north-kit.js';

const caches = new WeakMap();
function memo(ctx, key, make) {
  let c = caches.get(ctx);
  if (!c) { c = new Map(); caches.set(ctx, c); }
  if (!c.has(key)) c.set(key, make());
  return c.get(key);
}
const lowQ = (ctx) => ctx.quality?.level === 'low';
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function aniso(ctx) { return Math.min(8, ctx.renderer?.capabilities?.getMaxAnisotropy?.() ?? 4); }
// Canvas texture tiling tileW x tileH metres; the backing store is dropped once three has uploaded it.
function tex(ctx, cnv, { tileW = 1, tileH = 1, srgb = true, wrapS = THREE.RepeatWrapping, wrapT = THREE.RepeatWrapping } = {}) {
  const t = new THREE.CanvasTexture(cnv);
  t.wrapS = wrapS; t.wrapT = wrapT;
  t.repeat.set(1 / tileW, 1 / tileH);
  t.anisotropy = aniso(ctx);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.onUpdate = () => { t.onUpdate = null; cnv.width = cnv.height = 1; };
  t.needsUpdate = true;
  return t;
}
// Tangent-space normal map from a height field (metres) sampled W x H over tileW x tileH metres (wraps).
function normalTex(ctx, Hf, W, H, tileW, tileH, strength = 1, { wrapT = THREE.RepeatWrapping } = {}) {
  const data = new Uint8Array(W * H * 4);
  const sx = W / tileW, sy = H / tileH;      // px per metre
  for (let y = 0; y < H; y++) {
    const ym = (y - 1 + H) % H, yp = (y + 1) % H;
    for (let x = 0; x < W; x++) {
      const xm = (x - 1 + W) % W, xp = (x + 1) % W;
      const dx = (Hf[y * W + xp] - Hf[y * W + xm]) * sx * 0.5 * strength;
      const dy = (Hf[yp * W + x] - Hf[ym * W + x]) * sy * 0.5 * strength;
      // row 0 of the data texture is v = 0 (bottom): +y in the array is +v (up the wall)
      let nx = -dx, ny = -dy, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * W + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255; data[i + 1] = (ny * 0.5 + 0.5) * 255; data[i + 2] = (nz * 0.5 + 0.5) * 255; data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = wrapT;
  t.repeat.set(1 / tileW, 1 / tileH);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = aniso(ctx);
  t.needsUpdate = true;
  return t;
}
function hsl(hex, dl = 0, ds = 0, dh = 0) {
  const c = new THREE.Color(hex), o = {};
  c.getHSL(o);
  c.setHSL((o.h + dh + 1) % 1, Math.max(0, Math.min(1, o.s + ds)), Math.max(0, Math.min(1, o.l + dl)));
  return `#${c.getHexString()}`;
}
function std(name, params) {
  const m = new THREE.MeshStandardMaterial(params);
  m.name = `kenmawr-${name}`;
  return m;
}
// Fine light / dark speckle over a canvas region. One small random tile (built once from ImageData, no read-back)
// is laid over as a pattern: a single fillRect instead of tens of thousands of tiny ones.
let noiseTile = null;
function noiseCanvas() {
  if (noiseTile) return noiseTile;
  const S = 128, c = canvas(S, S), g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data, r = prng(99);
  for (let i = 0; i < S * S; i++) {
    const v = r() < 0.5 ? 255 : 0;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = r() < 0.45 ? (r() * 255) | 0 : 0;
  }
  g.putImageData(img, 0, 0);
  noiseTile = c;
  return c;
}
function speckle(g, W, H, r, n, alpha, size) {
  const pat = g.createPattern(noiseCanvas(), 'repeat');
  const ox = (r() * 128) | 0, oy = (r() * 128) | 0, k = (1 + size) / 2;
  g.save();
  g.globalAlpha = Math.min(1, alpha * Math.min(1.6, (n / (W * H)) * 6));
  g.scale(k, k); g.translate(-ox, -oy);
  g.fillStyle = pat; g.fillRect(ox, oy, W / k + 1, H / k + 1);
  g.restore();
}
function night(ctx, m, k) { ctx.materials?.registerNightMaterial?.(m, k); return m; }

// Relief normal maps are only worth their CPU time up close: the distant levels use the plain colour maps and the
// detailed levels add the relief (once per material) while they are built in idle time.
export function addRelief(...mats) {
  for (const m of mats) {
    const f = m?.userData?.relief;
    if (f) { m.userData.relief = null; f(); }
  }
}

// ============================================================================ Kenmawr brick
// Modular face brick (0.194 x 0.057 m, 10 mm joints) in the orange-red of the 1956 building, light grey mortar.
const BRICK = { bw: 0.194, bh: 0.057, j: 0.0095, cols: 20, rows: 28 };
const BRICK_COLORS = ['#ad563d', '#b8614a', '#a14e39', '#c06c50', '#a95a43', '#b35c42', '#9c4b37', '#b86a52'];
function paintBrick(g, W, H, ppm, r, { colors = BRICK_COLORS, mortar = '#c6bcae', x0 = 0, y0 = 0, detail = true } = {}) {
  const { bw, bh, j } = BRICK;
  g.fillStyle = mortar; g.fillRect(x0, y0, W, H);
  const BW = bw * ppm, BH = bh * ppm, J = j * ppm;
  const rows = Math.ceil(H / (BH + J));
  // a small precomputed palette of jittered brick colours (colour maths per brick is slow)
  const pal = [];
  for (let i = 0; i < 48; i++) pal.push(hsl(colors[i % colors.length], (r() - 0.5) * 0.06, (r() - 0.5) * 0.05));
  for (let row = 0; row < rows + 1; row++) {
    const off = row % 2 ? (BW + J) / 2 : 0, y = y0 + H - (row + 1) * (BH + J) + J / 2;
    for (let x = -off; x < W; x += BW + J) {
      g.fillStyle = pal[(r() * pal.length) | 0];
      g.fillRect(x0 + x, y, BW, BH);
      if (!detail) continue;
      if (r() < 0.3) { g.fillStyle = `rgba(40,15,5,${(0.05 + r() * 0.08).toFixed(3)})`; g.fillRect(x0 + x, y + BH * 0.55, BW, BH * 0.45); }
      if (r() < 0.12) { g.fillStyle = `rgba(255,220,190,${(0.05 + r() * 0.06).toFixed(3)})`; g.fillRect(x0 + x, y, BW, BH * 0.4); }
    }
  }
}
function brickHeights(W, H, ppm) {
  const { bw, bh, j } = BRICK, Hf = new Float32Array(W * H);
  const cw = bw + j, ch = bh + j;
  for (let y = 0; y < H; y++) {
    const vm = (y + 0.5) / ppm, row = Math.floor(vm / ch), fy = vm - row * ch;
    const off = row % 2 ? cw / 2 : 0;
    for (let x = 0; x < W; x++) {
      const um = (x + 0.5) / ppm + off, fx = um - Math.floor(um / cw) * cw;
      const inJ = fy < j * 0.5 || fy > ch - j * 0.5 || fx < j * 0.5 || fx > cw - j * 0.5;
      Hf[y * W + x] = inJ ? -0.006 : 0;
    }
  }
  return Hf;
}
export function kmBrick(ctx) {
  return memo(ctx, 'kmBrick', () => {
    const { bw, bh, j, cols, rows } = BRICK;
    const tileW = cols * (bw + j), tileH = rows * (bh + j), ppm = lowQ(ctx) ? 64 : 128;
    const W = Math.round(tileW * ppm), H = Math.round(tileH * ppm), r = prng(41);
    const c = canvas(W, H), g = c.getContext('2d');
    paintBrick(g, W, H, ppm, r);
    for (let i = 0; i < 26; i++) {       // soft blotches (firing variation, grime)
      g.fillStyle = `rgba(${r() > 0.5 ? '255,225,200' : '50,25,15'},${0.03 * r()})`;
      g.fillRect(r() * W, r() * H, 20 + r() * 90, 20 + r() * 60);
    }
    const m = std('brick', { map: tex(ctx, c, { tileW, tileH }), roughness: 0.9, metalness: 0 });
    if (!lowQ(ctx)) {
      m.userData.relief = () => {
        const nw = Math.round(tileW * 64), nh = Math.round(tileH * 64);
        m.normalMap = normalTex(ctx, brickHeights(nw, nh, 64), nw, nh, tileW, tileH, 1.4);
        m.needsUpdate = true;
      };
    }
    return m;
  });
}

// ============================================================================ Kenmawr painted facade (distant LOD)
// The wall of one arm face from the ground-floor level up to the parapet, 3 window modules wide, clamped in v
// (walls that reach below the ground floor show plain brick). The layout constants are shared with the detailed
// model so both levels line up.
export const KM = {
  GF: 3.5,          // ground-floor wall height up to the limestone band
  BAND: 0.35,       // limestone band
  FLOOR: 2.75,      // upper storeys
  N_UP: 7,          // storeys above the ground floor (8 in all)
  PARAPET: 0.95,
  MODULE: 7.2,      // window module along the walls
  // windows inside a module: [s0, s1, kind] (W = wide living-room window with an AC sleeve below, n = narrow)
  WIN: [[0.6, 2.35, 'W'], [3.3, 3.95, 'n'], [4.85, 6.6, 'W']],
  W_SILL: 0.78, W_H: 1.38, n_SILL: 1.0, n_H: 1.16,
  GRILLE_W: 0.86, GRILLE_H: 0.3, GRILLE_GAP: 0.14,
  GF_WIN: [[0.9, 3.2], [4.3, 6.6]], GF_SILL: 1.0, GF_H: 1.55,
};
KM.UP0 = KM.GF + KM.BAND;                               // floor level of storey 2 above the ground floor
KM.ROOF = KM.UP0 + KM.N_UP * KM.FLOOR;                  // roof slab (top of the walls)
KM.TOP = KM.ROOF + KM.PARAPET;                          // top of the parapet

export function kmFacade(ctx) {
  return memo(ctx, 'kmFacade', () => {
    const mods = 3, tileW = KM.MODULE * mods, tileH = KM.TOP, ppm = lowQ(ctx) ? 20 : 32;
    const W = Math.round(tileW * ppm), H = Math.round(tileH * ppm), r = prng(77);
    const c = canvas(W, H), g = c.getContext('2d');
    const ce = canvas(W >> 1, H >> 1), ge = ce.getContext('2d');
    ge.fillStyle = '#000'; ge.fillRect(0, 0, ce.width, ce.height);
    ge.scale(0.5, 0.5);
    // brick field: one small painted tile used as a pattern (courses still read at 32 px/m)
    const { bw, bh, j } = BRICK;
    const bt = canvas(Math.round(20 * (bw + j) * ppm), Math.round(28 * (bh + j) * ppm));
    paintBrick(bt.getContext('2d'), bt.width, bt.height, ppm, r, { mortar: '#b9ae9f', detail: false });
    g.fillStyle = g.createPattern(bt, 'repeat'); g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(120,60,40,0.18)'; g.fillRect(0, 0, W, H);   // mortar lines average out at a distance
    for (let i = 0; i < 40; i++) {                                   // large-scale tone variation
      g.fillStyle = `rgba(${r() > 0.5 ? '255,220,190' : '60,25,15'},${(0.03 * r()).toFixed(3)})`;
      g.fillRect(r() * W, r() * H, 40 + r() * 200, 30 + r() * 160);
    }
    const Y = (v) => H - v * ppm;                      // v (m above the ground floor) → canvas y
    const glass = (x, y, w, h, lit) => {
      const grd = g.createLinearGradient(x, y, x + w * 0.3, y + h);
      grd.addColorStop(0, '#9fb5c4'); grd.addColorStop(0.45, '#5d7282'); grd.addColorStop(1, '#3a4652');
      g.fillStyle = grd; g.fillRect(x, y, w, h);
      if (r() < 0.35) { g.fillStyle = 'rgba(232,226,210,0.55)'; g.fillRect(x, y, w, h * (0.15 + r() * 0.45)); }   // blinds
      if (lit) { ge.fillStyle = `rgba(255,${190 + (r() * 50) | 0},${120 + (r() * 50) | 0},${0.6 + r() * 0.4})`; ge.fillRect(x, y, w, h); }
    };
    const win = (s0, s1, sill, h, lit) => {
      const x = s0 * ppm, w = (s1 - s0) * ppm, y = Y(sill + h), hh = h * ppm, f = Math.max(1.5, 0.07 * ppm);
      g.fillStyle = 'rgba(30,15,10,0.45)'; g.fillRect(x - 1, y - 1, w + 2, hh + 2);          // reveal shadow
      g.fillStyle = '#5a3d34'; g.fillRect(x, y, w, hh);                                        // bronze frame
      glass(x + f, y + f, w - 2 * f, hh - 2 * f, lit);
      g.fillStyle = '#5a3d34';
      if (s1 - s0 > 1.2) g.fillRect(x + w / 2 - f / 2, y, f, hh);                           // meeting rail of the sliders
      g.fillStyle = '#d6cfbf'; g.fillRect(x - f, Y(sill), w + 2 * f, Math.max(2, 0.08 * ppm)); // stone sill
    };
    // ground floor
    for (let m = 0; m < mods; m++) for (const [s0, s1] of KM.GF_WIN) win(m * KM.MODULE + s0, m * KM.MODULE + s1, KM.GF_SILL, KM.GF_H, r() < 0.3);
    // limestone band
    g.fillStyle = '#d4cdbd'; g.fillRect(0, Y(KM.UP0), W, KM.BAND * ppm);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, Y(KM.GF) - 1, W, 2);
    // upper storeys
    for (let f = 0; f < KM.N_UP; f++) {
      const v0 = KM.UP0 + f * KM.FLOOR;
      for (let m = 0; m < mods; m++) for (const [s0, s1, kind] of KM.WIN) {
        const S0 = m * KM.MODULE + s0, S1 = m * KM.MODULE + s1;
        if (kind === 'W') {
          win(S0, S1, v0 + KM.W_SILL, KM.W_H, r() < 0.5);
          const gx = ((S0 + S1) / 2 - KM.GRILLE_W / 2) * ppm, gy = Y(v0 + KM.W_SILL - KM.GRILLE_GAP);
          g.fillStyle = '#4a3a33'; g.fillRect(gx, gy, KM.GRILLE_W * ppm, KM.GRILLE_H * ppm);
          g.fillStyle = 'rgba(0,0,0,0.35)';
          for (let k = 0; k < 4; k++) g.fillRect(gx, gy + (k + 0.5) * KM.GRILLE_H * ppm / 4, KM.GRILLE_W * ppm, 1);
        } else win(S0, S1, v0 + KM.n_SILL, KM.n_H, r() < 0.4);
      }
    }
    // parapet coping + a faint dark band of weathering below it
    g.fillStyle = '#c9c3b6'; g.fillRect(0, 0, W, Math.max(2, 0.12 * ppm));
    const grd = g.createLinearGradient(0, 0, 0, 1.6 * ppm);
    grd.addColorStop(0, 'rgba(40,25,20,0.25)'); grd.addColorStop(1, 'rgba(40,25,20,0)');
    g.fillStyle = grd; g.fillRect(0, 0, W, 1.6 * ppm);
    const m = std('facade', {
      map: tex(ctx, c, { tileW, tileH, wrapT: THREE.ClampToEdgeWrapping }),
      emissiveMap: tex(ctx, ce, { tileW, tileH, wrapT: THREE.ClampToEdgeWrapping }),
      emissive: new THREE.Color('#ffd9a8'), emissiveIntensity: 0, roughness: 0.82, metalness: 0.02,
    });
    return night(ctx, m, 1.3);
  });
}

// ============================================================================ trims
// Smooth limestone / cast stone for bands, sills and copings (fine speckle, faint joints every 1.5 m).
export function kmStone(ctx, color = '#d7d0c0') {
  return memo(ctx, `kmStone:${color}`, () => {
    const tile = 3, PX = lowQ(ctx) ? 96 : 192, r = prng(9);
    const c = canvas(PX, PX), g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, PX, PX);
    speckle(g, PX, PX, r, PX * PX / 5, 0.06, 1.3);
    for (let i = 0; i < 14; i++) {
      const x = r() * PX, grd = g.createLinearGradient(0, 0, 0, PX);
      grd.addColorStop(0, 'rgba(80,75,65,0.12)'); grd.addColorStop(1, 'rgba(80,75,65,0)');
      g.fillStyle = grd; g.fillRect(x, 0, 2 + r() * 8, PX * (0.2 + r() * 0.6));
    }
    g.fillStyle = 'rgba(70,65,55,0.35)'; g.fillRect(0, 0, 1, PX); g.fillRect(PX / 2, 0, 1, PX);
    return std(`stone-${color}`, { map: tex(ctx, c, { tileW: tile, tileH: tile }), roughness: 0.78, metalness: 0 });
  });
}

// Flat roof membrane (light grey granulated cap sheet, darker seams and patches).
export function kmRoof(ctx) {
  return memo(ctx, 'kmRoof', () => {
    const tile = 12, PX = lowQ(ctx) ? 128 : 256, r = prng(12);
    const c = canvas(PX, PX), g = c.getContext('2d');
    g.fillStyle = '#6e6c68'; g.fillRect(0, 0, PX, PX);
    speckle(g, PX, PX, r, PX * PX / 3, 0.08, 1.2);
    for (let i = 0; i < 18; i++) {
      g.fillStyle = `rgba(${r() > 0.5 ? '40,38,36' : '150,148,140'},${0.08 + r() * 0.12})`;
      g.beginPath(); g.ellipse(r() * PX, r() * PX, 5 + r() * 30, 4 + r() * 20, r() * 3, 0, 7); g.fill();
    }
    g.fillStyle = 'rgba(40,40,38,0.35)';
    for (let k = 0; k < 4; k++) g.fillRect(0, (k * PX) / 4, PX, 1);
    return std('roof', { map: tex(ctx, c, { tileW: tile, tileH: tile }), roughness: 0.95, metalness: 0 });
  });
}

// Small atlas of trim details. Regions (u0,v0,u1,v1 in texture space) are in ATLAS below.
export const ATLAS = {
  louvre: [0, 0.75, 0.25, 1],          // bronze AC sleeve louvre
  fascia: [0.25, 0.9375, 1, 1],       // maroon canopy fascia with a light reveal
  signKen: [0.25, 0.84375, 1, 0.9375], // Kenmawr monument sign
  signCal: [0.25, 0.75, 1, 0.84375],   // Calvary notice board
  huntName: [0.32, 0.625, 1, 0.6875],  // 'HUNT ARMORY' frieze inscription
  huntGuard: [0.32, 0.5625, 1, 0.625], // 'PENNSYLVANIA NATIONAL GUARD'
  soffit: [0, 0.5, 0.25, 0.75],        // canopy soffit with downlights
  door: [0.25, 0, 0.5, 0.5],           // oak church door (pointed top painted inside the rectangle)
  doorSq: [0.5, 0, 0.75, 0.5],         // square-headed oak door
  quatrefoil: [0.75, 0, 1, 0.25],      // carved stone roundel
  cross: [0.75, 0.25, 1, 0.5],         // gilded cross / sign plate
  dark: [0.26, 0.51, 0.3, 0.55],       // plain dark bronze
};
export function kmAtlas(ctx) {
  return memo(ctx, 'kmAtlas', () => {
    const S = lowQ(ctx) ? 256 : 512, r = prng(5);
    const c = canvas(S, S), g = c.getContext('2d');
    const ce = canvas(S >> 1, S >> 1), ge = ce.getContext('2d');
    ge.fillStyle = '#000'; ge.fillRect(0, 0, S, S); ge.scale(0.5, 0.5);
    const R = ([u0, v0, u1, v1]) => [u0 * S, (1 - v1) * S, (u1 - u0) * S, (v1 - v0) * S];
    g.fillStyle = '#4a3a33'; g.fillRect(0, 0, S, S);
    // louvre
    { const [x, y, w, h] = R(ATLAS.louvre); g.fillStyle = '#51413a'; g.fillRect(x, y, w, h);
      for (let k = 0; k < 8; k++) { g.fillStyle = '#6b5a50'; g.fillRect(x, y + (k * h) / 8, w, h / 16); g.fillStyle = '#231a16'; g.fillRect(x, y + (k * h) / 8 + h / 16, w, h / 16); } }
    // fascia: maroon with a thin light top edge
    { const [x, y, w, h] = R(ATLAS.fascia); const grd = g.createLinearGradient(0, y, 0, y + h);
      grd.addColorStop(0, '#8a2f35'); grd.addColorStop(0.5, '#772329'); grd.addColorStop(1, '#5f1b20');
      g.fillStyle = grd; g.fillRect(x, y, w, h); g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x, y, w, h * 0.06); }
    // soffit with downlights (emissive)
    { const [x, y, w, h] = R(ATLAS.soffit); g.fillStyle = '#d8d4cc'; g.fillRect(x, y, w, h);
      for (let i = 0; i < 2; i++) for (let k = 0; k < 2; k++) {
        const cx = x + w * (0.25 + 0.5 * i), cy = y + h * (0.25 + 0.5 * k);
        g.fillStyle = '#fff6e0'; g.beginPath(); g.arc(cx, cy, w * 0.06, 0, 7); g.fill();
        ge.fillStyle = '#fff'; ge.beginPath(); ge.arc(cx, cy, w * 0.09, 0, 7); ge.fill();
      } }
    // oak doors: vertical boards, iron straps, pointed (drawn) head for 'door'
    const oak = (reg, pointed) => {
      const [x, y, w, h] = R(reg);
      g.fillStyle = '#e8e2d6'; g.fillRect(x, y, w, h);
      g.save();
      g.beginPath();
      if (pointed) {
        const sp = y + h * 0.42, rr = w * 1.0;
        g.moveTo(x, y + h); g.lineTo(x, sp);
        g.arc(x + rr, sp, rr, Math.PI, Math.PI + Math.acos(0.5), false);
        g.arc(x + w - rr, sp, rr, -Math.acos(0.5), 0, false);
        g.lineTo(x + w, y + h); g.closePath();
      } else g.rect(x, y, w, h);
      g.clip();
      g.fillStyle = '#533521'; g.fillRect(x, y, w, h);
      for (let k = 0; k < 10; k++) { g.fillStyle = hsl('#533521', (r() - 0.5) * 0.08); g.fillRect(x + (k * w) / 10 + 1, y, w / 10 - 2, h); }
      g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(x + w / 2 - 1.5, y, 3, h);
      g.fillStyle = '#2a2420';
      for (const f of [0.55, 0.8]) g.fillRect(x, y + h * f, w, h * 0.025);
      for (let i = 0; i < 30; i++) { g.fillStyle = '#1d1815'; g.fillRect(x + r() * w, y + h * (0.55 + (r() < 0.5 ? 0 : 0.25)), 2, 2); }
      g.restore();
    };
    oak(ATLAS.door, true); oak(ATLAS.doorSq, false);
    // signs and inscriptions
    const text = (reg, bg, fg, lines, font) => {
      const [x, y, w, h] = R(reg);
      if (bg) { g.fillStyle = bg; g.fillRect(x, y, w, h); }
      g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
      lines.forEach(([t, size, dy]) => { g.font = `${font} ${Math.round(h * size)}px Georgia, 'Times New Roman', serif`; g.fillText(t, x + w / 2, y + h * dy, w * 0.94); });
    };
    text(ATLAS.signKen, '#3b2a24', '#efe6d2', [['THE KENMAWR', 0.46, 0.38], ['401 SHADY AVENUE', 0.22, 0.78]], 'bold');
    { const [x, y, w, h] = R(ATLAS.signKen); g.strokeStyle = '#b89a5c'; g.lineWidth = 2; g.strokeRect(x + 3, y + 3, w - 6, h - 6); }
    text(ATLAS.signCal, '#1f2f4f', '#f2eee4', [['CALVARY EPISCOPAL CHURCH', 0.34, 0.36], ['FOUNDED 1855 · ALL ARE WELCOME', 0.2, 0.76]], 'bold');
    { const [x, y, w, h] = R(ATLAS.signCal); g.strokeStyle = '#c9b27a'; g.lineWidth = 2; g.strokeRect(x + 3, y + 3, w - 6, h - 6); }
    text(ATLAS.huntName, '#d2cdc2', 'rgba(70,64,56,0.9)', [['HUNT · ARMORY', 0.62, 0.55]], '');
    text(ATLAS.huntGuard, '#d2cdc2', 'rgba(70,64,56,0.85)', [['PENNSYLVANIA · NATIONAL · GUARD', 0.5, 0.55]], '');
    // carved quatrefoil roundel (stone)
    { const [x, y, w, h] = R(ATLAS.quatrefoil); g.fillStyle = '#cfc7b8'; g.fillRect(x, y, w, h);
      const cx = x + w / 2, cy = y + h / 2, rr = w * 0.2;
      g.strokeStyle = 'rgba(60,55,48,0.7)'; g.lineWidth = w * 0.03;
      g.beginPath(); g.arc(cx, cy, w * 0.46, 0, 7); g.stroke();
      for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 2; g.beginPath(); g.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, rr, 0, 7); g.stroke(); } }
    // gilded cross on dark ground
    { const [x, y, w, h] = R(ATLAS.cross); g.fillStyle = '#2d2a27'; g.fillRect(x, y, w, h);
      g.fillStyle = '#c9a44a'; g.fillRect(x + w * 0.44, y + h * 0.12, w * 0.12, h * 0.76); g.fillRect(x + w * 0.24, y + h * 0.32, w * 0.52, h * 0.12); }
    const m = std('atlas', {
      map: tex(ctx, c, { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping }),
      emissiveMap: tex(ctx, ce, { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping }),
      emissive: new THREE.Color('#fff0d0'), emissiveIntensity: 0, roughness: 0.6, metalness: 0.1,
    });
    return night(ctx, m, 2.2);
  });
}
// UVs [u0,v0,u1,v1] of an atlas region, inset a little so mipmaps do not bleed.
export function atlasUV(name, inset = 0.004) {
  const [u0, v0, u1, v1] = ATLAS[name];
  return [u0 + inset, v0 + inset, u1 - inset, v1 - inset];
}

// ============================================================================ church stone
// Coursed limestone ashlar (Calvary: pale grey-buff Indiana-type stone, slightly irregular block lengths, grey
// rain streaks). Tile = 4 courses; block joints recessed in the normal map.
export function ashlar(ctx, { key = 'calvary', color = '#cbc3b3', courses = [0.42, 0.38, 0.45, 0.36], blockMin = 0.7, blockMax = 1.5, tileW = 6, seed = 17, streaks = 0.55, rock = 0, varL = 0.07, tints = null } = {}) {
  return memo(ctx, `ashlar:${key}`, () => {
    const tileH = courses.reduce((a, b) => a + b, 0), ppm = lowQ(ctx) ? 40 : 80;
    const W = Math.round(tileW * ppm), H = Math.round(tileH * ppm), r = prng(seed);
    const c = canvas(W, H), g = c.getContext('2d');
    const jn = 0.012;
    g.fillStyle = hsl(color, -0.16); g.fillRect(0, 0, W, H);
    // blocks per course (x ranges in metres), remembered for the height field
    const blocks = [];
    let v = 0;
    for (const ch of courses) {
      let u = -r() * blockMax;
      const row = [];
      while (u < tileW) {
        const bl = blockMin + r() * (blockMax - blockMin);
        row.push([u, u + bl]);
        u += bl;
      }
      blocks.push({ v0: v, v1: v + ch, row });
      v += ch;
    }
    for (const { v0, v1, row } of blocks) {
      for (const [u0, u1] of row) {
        const base = tints && r() < 0.35 ? tints[(r() * tints.length) | 0] : color;
        const col = hsl(base, (r() - 0.5) * varL, (r() - 0.5) * 0.05, (r() - 0.5) * 0.01);
        const x0 = u0 * ppm, x1 = u1 * ppm, y0 = H - v1 * ppm, y1 = H - v0 * ppm;
        const draw = (dx) => {
          g.fillStyle = col; g.fillRect(x0 + dx + jn * ppm, y0 + jn * ppm, x1 - x0 - 2 * jn * ppm, y1 - y0 - 2 * jn * ppm);
          if (rock) {   // rock-faced: lighter top edge, darker lower edge
            // rock-faced: a few irregular lighter / darker facets per block instead of banding
            for (let k = 0; k < 5; k++) {
              g.fillStyle = r() < 0.5 ? `rgba(255,250,240,${(0.05 * rock).toFixed(3)})` : `rgba(20,18,15,${(0.07 * rock).toFixed(3)})`;
              const fw = (x1 - x0) * (0.2 + r() * 0.5), fh = (y1 - y0) * (0.25 + r() * 0.5);
              g.fillRect(x0 + dx + r() * (x1 - x0 - fw), y0 + r() * (y1 - y0 - fh), fw, fh);
            }
          }
        };
        draw(0); if (x1 > W) draw(-W); if (x0 < 0) draw(W);
      }
    }
    speckle(g, W, H, r, (W * H) / 7, 0.07, 1.4);
    // grey weathering streaks from the joints
    for (let i = 0; i < (W / 5) * streaks; i++) {
      const x = r() * W, y0 = r() * H, len = (0.2 + r() * 1.2) * ppm;
      const grd = g.createLinearGradient(0, y0, 0, y0 + len);
      grd.addColorStop(0, `rgba(70,68,62,${0.08 + r() * 0.12})`); grd.addColorStop(1, 'rgba(70,68,62,0)');
      g.fillStyle = grd; g.fillRect(x, y0, 1 + r() * 4, len);
    }
    const m = std(`ashlar-${key}`, { map: tex(ctx, c, { tileW, tileH }), roughness: 0.86, metalness: 0 });
    if (!lowQ(ctx)) m.userData.relief = () => {
      const np = 48, nw = Math.round(tileW * np), nh = Math.round(tileH * np), Hf = new Float32Array(nw * nh);
      const rr = prng(seed + 1);
      for (const { v0, v1, row } of blocks) {
        for (let y = Math.floor(v0 * np); y < Math.min(nh, Math.ceil(v1 * np)); y++) {
          const vm = (y + 0.5) / np;
          for (const [u0, u1] of row) {
            for (let x = Math.floor(u0 * np); x < Math.ceil(u1 * np); x++) {
              const um = (x + 0.5) / np;
              const d = Math.min(um - u0, u1 - um, vm - v0, v1 - vm);
              let hgt = d < jn * 1.5 ? -0.01 : 0;
              if (rock && d >= jn * 1.5) hgt += Math.min(0.02, (d - jn) * 0.08) + (rr() - 0.5) * 0.004;
              Hf[y * nw + (((x % nw) + nw) % nw)] = hgt;
            }
          }
        }
      }
      m.normalMap = normalTex(ctx, Hf, nw, nh, tileW, tileH, 1.2);
      m.needsUpdate = true;
    };
    return m;
  });
}
export const calvaryStone = (ctx) => ashlar(ctx, { key: 'calvary', color: '#aea594', courses: [0.42, 0.38, 0.45, 0.36, 0.4, 0.44, 0.37, 0.41], tileW: 7.2, streaks: 0.9 });
export const sacredStone = (ctx) => ashlar(ctx, {
  key: 'sacred', color: '#a39c8f', courses: [0.32, 0.46, 0.28, 0.4, 0.36, 0.3, 0.44, 0.34], blockMin: 0.35, blockMax: 1.05, tileW: 5.4, seed: 29, streaks: 0.4, rock: 1, varL: 0.14, tints: ['#a89a84', '#9c9d98', '#b0a58f', '#8f8c86'],
});
export const trimStone = (ctx) => ashlar(ctx, { key: 'trim', color: '#c4bcac', courses: [0.6, 0.6], blockMin: 0.9, blockMax: 1.6, tileW: 4, seed: 31, streaks: 0.2 });

// ============================================================================ roofs
// Slate: small courses (0.24 m exposure) of staggered dark grey-blue slates; u along the eave, v up the slope.
export function slate(ctx, color = '#4d5157') {
  return memo(ctx, `slate:${color}`, () => {
    const tileW = 3, tileH = 2.88, ppm = lowQ(ctx) ? 48 : 96, course = 0.24, sw = 0.3;
    const W = Math.round(tileW * ppm), H = Math.round(tileH * ppm), r = prng(23);
    const c = canvas(W, H), g = c.getContext('2d');
    g.fillStyle = hsl(color, -0.1); g.fillRect(0, 0, W, H);
    const rows = Math.round(tileH / course);
    for (let k = 0; k < rows; k++) {
      const y1 = H - k * course * ppm, y0 = y1 - course * ppm, off = k % 2 ? sw / 2 : 0;
      for (let u = -off; u < tileW; u += sw) {
        g.fillStyle = hsl(color, (r() - 0.5) * 0.08, (r() - 0.5) * 0.05);
        g.fillRect(u * ppm + 1, y0 + 1, sw * ppm - 2, course * ppm - 1);
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(u * ppm, y1 - 2, sw * ppm, 2);   // butt shadow
      }
    }
    speckle(g, W, H, r, (W * H) / 10, 0.06, 1.2);
    for (let i = 0; i < 20; i++) {       // lichen / weathering patches
      g.fillStyle = `rgba(${r() > 0.6 ? '120,120,105' : '30,32,36'},${0.05 + r() * 0.08})`;
      g.fillRect(r() * W, r() * H, 10 + r() * 60, 6 + r() * 30);
    }
    return std(`slate-${color}`, { map: tex(ctx, c, { tileW, tileH }), roughness: 0.62, metalness: 0.05, envMapIntensity: 0.9 });
  });
}

// ============================================================================ glass
// Leaded stained glass seen from outside: small diamond quarries in dark, faintly coloured glass behind a clear
// protective sheet; at night the interior light shows the colours. Tiles 0.8 x 0.8 m (metre UVs).
export function stainedGlass(ctx) {
  return memo(ctx, 'stainedGlass', () => {
    const tile = 0.8, PX = lowQ(ctx) ? 64 : 128, r = prng(61);
    const c = canvas(PX, PX), g = c.getContext('2d');
    const ce = canvas(PX, PX), ge = ce.getContext('2d');
    const pal = ['#2e2224', '#1f2533', '#302a1e', '#1f2a24', '#27222f', '#2d2520', '#212a33'];
    const pale = ['#e0443c', '#3f6fd8', '#f0c040', '#3fa060', '#9a5ad0', '#f09040', '#5aa0e8'];
    const n = 4, s = PX / n;
    g.fillStyle = '#222'; g.fillRect(0, 0, PX, PX);
    ge.fillStyle = '#000'; ge.fillRect(0, 0, PX, PX);
    // colours per diamond from a table that wraps with the tile (so the texture repeats without seams)
    const table = Array.from({ length: n * 2 * n }, () => [(r() * pal.length) | 0, (r() - 0.5) * 0.06, (r() - 0.5) * 0.15]);
    for (let j = -2; j <= 2 * n + 1; j++) for (let i = -1; i <= n; i++) {
      const cx = (i + (Math.abs(j) % 2 ? 0.5 : 0)) * s, cy = (j * s) / 2;
      const [k, d0, d1] = table[(((i % n) + n) % n) * 2 * n + (((j % (2 * n)) + 2 * n) % (2 * n))];
      const dia = (gg, col) => { gg.fillStyle = col; gg.beginPath(); gg.moveTo(cx, cy - s * 0.5); gg.lineTo(cx + s * 0.5, cy); gg.lineTo(cx, cy + s * 0.5); gg.lineTo(cx - s * 0.5, cy); gg.closePath(); gg.fill(); };
      dia(g, hsl(pal[k], d0));
      dia(ge, hsl(pale[k], d1));
    }
    // leads
    g.strokeStyle = '#141414'; g.lineWidth = Math.max(1, PX / 96); ge.strokeStyle = '#000'; ge.lineWidth = Math.max(1.5, PX / 64);
    for (let k = -n; k <= 2 * n; k++) {
      for (const gg of [g, ge]) {
        gg.beginPath(); gg.moveTo(k * s - PX, -s / 2 + 0); gg.lineTo(k * s + PX, PX * 2 - s / 2); gg.stroke();
        gg.beginPath(); gg.moveTo(k * s + PX, -s / 2); gg.lineTo(k * s - PX, PX * 2 - s / 2); gg.stroke();
      }
    }
    // reflections of the outer protective glazing
    const grd = g.createLinearGradient(0, 0, PX, PX);
    grd.addColorStop(0, 'rgba(200,210,220,0.10)'); grd.addColorStop(0.5, 'rgba(200,210,220,0.02)'); grd.addColorStop(1, 'rgba(200,210,220,0.08)');
    g.fillStyle = grd; g.fillRect(0, 0, PX, PX);
    const m = std('stained', {
      map: tex(ctx, c, { tileW: tile, tileH: tile }), emissiveMap: tex(ctx, ce, { tileW: tile, tileH: tile }),
      emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0, roughness: 0.18, metalness: 0.35, envMapIntensity: 1.1,
    });
    return night(ctx, m, 0.9);
  });
}

// ============================================================================ pierced parapet
// Quatrefoil tracery band (stone), alpha tested. One tile = 1.2 m wide x 1.0 m high, v = 0 at the bottom.
export function piercedParapet(ctx, color = '#cdc5b5') {
  return memo(ctx, `pierced:${color}`, () => {
    const tileW = 1.2, tileH = 1.0, ppm = lowQ(ctx) ? 64 : 128;
    const W = Math.round(tileW * ppm), H = Math.round(tileH * ppm), r = prng(3);
    const c = canvas(W, H), g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, W, H);
    speckle(g, W, H, r, (W * H) / 6, 0.06, 1.2);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, H * 0.14, W, 2); g.fillRect(0, H * 0.84, W, 2);
    // holes: a quatrefoil in a circle, centred in the band
    g.globalCompositeOperation = 'destination-out';
    const cx = W / 2, cy = H / 2, rr = H * 0.14;
    for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 2 + Math.PI / 4; g.beginPath(); g.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, rr * 1.02, 0, 7); g.fill(); }
    g.beginPath(); g.arc(cx, cy, rr * 1.1, 0, 7); g.fill();
    g.globalCompositeOperation = 'source-over';
    // shading ring around the opening
    g.strokeStyle = 'rgba(40,36,30,0.45)'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, H * 0.32, 0, 7); g.stroke();
    const t = tex(ctx, c, { tileW, tileH });
    return std(`pierced-${color}`, { map: t, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
  });
}

// Plain cached colour material (bronze frames, lead flashings, gilded crosses ...)
export function plainMat(ctx, color, { roughness = 0.6, metalness = 0.2, side = THREE.FrontSide, emissive = null, nightK = 0 } = {}) {
  return memo(ctx, `plain:${color}:${roughness}:${metalness}:${side}:${emissive}:${nightK}`, () => {
    const m = std(`plain-${color}`, { color, roughness, metalness, side });
    if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = 0; night(ctx, m, nightK || 1); }
    return m;
  });
}
