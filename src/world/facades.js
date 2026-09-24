// Facade, roof and trim textures for the generic OSM buildings, packed into texture arrays sampled by ONE material.
//
// Why texture arrays: ~10 000 buildings use ~80 different wall / roof looks. With one material per look, every
// 250 m chunk would need ~20 draw calls. Instead every look is a LAYER of a sampler2DArray, selected per vertex
// (bidLayer.y; bit 15 picks the surface arrays), so each chunk renders with one draw call per level of detail.
//
//  * FACADE arrays (walls): window-grid facades, houses, shopfronts, parking decks. UVs are normalised per layer
//    tile (u / tileW, v / tileH), metres converted in the Emitter.
//  * SURFACE arrays: plain brick / stone / concrete / plaster, clay tile / asphalt shingle / slate / standing-seam
//    roofing, flat roof membrane and gravel ballast, rooftop units + fan tops, skylights, painted trim, copper, doors.
//
// Painting: every layer is rasterised STRAIGHT AT ITS TEXTURE-ARRAY RESOLUTION on CPU-backed canvases
// (getContext('2d', { willReadFrequently: true })) through a transform from the painter's own units, so the
// pixels are read back without GPU round trips or resampling, and grain is added on the pixel arrays instead of
// thousands of fillRect calls. The painting canvases are pooled and released after build().
//
// Colour: every texture is painted in NEUTRAL grey and coloured per building by a per-vertex tint (linear space).
// The tint is masked by the red channel of the "rough" layer (wall = 1, glass/frames/signs = 0) so windows and
// white frames stay untinted. rough layer: R = tint mask, G = roughness, B = metalness, A = 0 inside recessed
// window openings (facade arrays only; drives a one-step parallax that fakes the window reveals).
// Per facade layer the shader also gets its room grid (bay x storey, room depth, window sill / head) for the
// interior mapping behind the glass, the reveal depth and a wall-relief code (analytic brick / ashlar / clapboard /
// panel-joint normals). tint.w = ground height under the vertex (dirt / occlusion band at the foot of the walls).
// Night: glass shows its interior-mapped room lit or dark per (room, building) hash; other emissive texels (signs,
// shop transoms, parking lights) come from the emissive layers. emissiveIntensity follows ctx.env.state.nightFactor
// via ctx.materials.registerNightMaterial. Highlight: vertex attribute bidLayer.x vs uniforms uHover / uSelect.
import * as THREE from 'three';
import { TINT_RANGE, GROUND_BIAS } from './building-geometry.js';

export const NEUTRAL = '#c0c0c0';
const NEUTRAL_LIN = new THREE.Color(NEUTRAL); // THREE.Color stores linear components

// Linear-space multiplier that turns the neutral texture colour into `hex` (times brightness f).
export function tintFor(hex, f = 1) {
  const c = new THREE.Color(hex);
  return [(c.r / NEUTRAL_LIN.r) * f, (c.g / NEUTRAL_LIN.g) * f, (c.b / NEUTRAL_LIN.b) * f];
}
export const NO_TINT = [1, 1, 1];

// ---------------------------------------------------------------- facade archetypes
// wallColor is always NEUTRAL (colour comes from the vertex tint); lit = fraction of windows lit at night.
export const FACADES = {
  collegiate: { wall: 'brick', style: 'punched', bay: 3.6, floor: 3.9, winW: 1.5, winH: 2.25, sill: 0.95, frame: '#e9e3d3', glass: '#475e6b', lit: 0.45 },
  beaux: { wall: 'brick', style: 'arched', bay: 4.4, floor: 4.6, winW: 2.0, winH: 3.0, sill: 0.9, frame: '#ece5d2', glass: '#4a5d69', trim: '#d4d4d4', lit: 0.45 },
  residential: { wall: 'brick', style: 'punched', bay: 3.2, floor: 3.05, winW: 1.15, winH: 1.65, sill: 0.85, frame: '#ece8df', glass: '#3c4952', lit: 0.4 },
  residentialTrim: { wall: 'brick', style: 'punched', bay: 3.0, floor: 3.1, winW: 1.2, winH: 1.7, sill: 0.85, frame: '#e2ddd2', glass: '#3a454d', trim: '#dadada', lit: 0.4 },
  modernBrick: { wall: 'brick', style: 'ribbon', bay: 3.6, floor: 4.0, winW: 1.6, winH: 1.9, sill: 1.0, frame: '#4b5156', glass: '#56707f', lit: 0.5 },
  tower: { wall: 'brick', style: 'punched', bay: 2.8, floor: 2.95, winW: 1.6, winH: 1.5, sill: 0.9, frame: '#8c9094', glass: '#3d4d58', lit: 0.4 },
  brutalist: { wall: 'concrete', style: 'punched', bay: 1.9, floor: 3.9, winW: 0.75, winH: 2.5, sill: 0.8, frame: '#3a3c3e', glass: '#3f4f59', lit: 0.45 },
  limestone: { wall: 'stone', style: 'punched', bay: 3.8, floor: 4.4, winW: 1.6, winH: 2.6, sill: 1.0, frame: '#ddd6c6', glass: '#46555f', trim: '#d0d0d0', lit: 0.4 },
  gothic: { wall: 'stone', style: 'arched', bay: 4.2, floor: 5.4, winW: 1.3, winH: 3.6, sill: 1.2, frame: '#5b4d3c', glass: '#4b5563', lit: 0.3 },
  office: { wall: 'panel', style: 'ribbon', bay: 3.6, floor: 3.9, winW: 1.6, winH: 2.0, sill: 0.9, frame: '#5a6066', glass: '#4f6879', lit: 0.5 },
  industrial: { wall: 'panel', style: 'punched', bay: 6.0, floor: 4.5, winW: 3.2, winH: 1.3, sill: 2.4, frame: '#55595d', glass: '#4a5a63', lit: 0.25 },
  terracotta: { wall: 'panel', style: 'ribbon', bay: 3.6, floor: 4.0, winW: 1.6, winH: 2.1, sill: 0.95, frame: '#3e4347', glass: '#526b7a', lit: 0.5 },
  curtainBlue: { style: 'curtain', bay: 3.2, floor: 4.0, frame: '#9aa3aa', glass: '#5a7d93', lit: 0.5 },
  curtainDark: { style: 'curtain', bay: 3.0, floor: 4.0, frame: '#34393d', glass: '#34495a', lit: 0.5 },
  curtainGreen: { style: 'curtain', bay: 3.2, floor: 4.0, frame: '#c9cdd0', glass: '#5d8581', lit: 0.45 },
  glasshouse: { style: 'curtain', bay: 2.0, floor: 2.6, frame: '#eef0ee', glass: '#a9c7c2', lit: 0.15 },
  // Oakland / Shadyside street typologies
  // Victorian / Italianate brick rowhouse: tall 2-over-2 sashes under dressed stone lintels (or segmental brick arches)
  victorian: { wall: 'brick', style: 'punched', bay: 2.3, floor: 3.45, winW: 0.95, winH: 2.05, sill: 0.8, frame: '#ece8df', glass: '#3c4952', sash: true, lintel: 'stone', recess: 0.22, lit: 0.4 },
  victorianArch: { wall: 'brick', style: 'punched', bay: 2.4, floor: 3.45, winW: 0.95, winH: 2.0, sill: 0.8, frame: '#3b2f2a', glass: '#3a464e', sash: true, lintel: 'arch', recess: 0.22, lit: 0.4 },
  // commercial "main street" block upper floors: wider sashes, keystoned lintels
  mixedUse: { wall: 'brick', style: 'punched', bay: 2.9, floor: 3.5, winW: 1.15, winH: 2.0, sill: 0.85, frame: '#e6e1d6', glass: '#3d4a53', sash: true, lintel: 'stone', keystone: true, recess: 0.22, lit: 0.42 },
  // 1920s apartment block: paired sashes, stone belt courses at sill height, stone lintels
  apartment20s: { wall: 'brick', style: 'punched', bay: 3.4, floor: 3.1, winW: 0.9, winH: 1.7, sill: 0.85, frame: '#e9e4d8', glass: '#3b474f', sash: true, pair: true, pairGap: 0.34, band: true, lintel: 'stone', recess: 0.2, lit: 0.42 },
  // modern infill: fibre-cement / metal panels with wide windows, or smooth stucco
  infillPanel: { wall: 'panel', style: 'punched', bay: 3.2, floor: 3.2, winW: 2.3, winH: 1.85, sill: 0.8, frame: '#34383b', glass: '#4f6677', lit: 0.5 },
  infillStucco: { wall: 'plain', style: 'punched', bay: 3.0, floor: 3.15, winW: 1.8, winH: 1.7, sill: 0.85, frame: '#2e3235', glass: '#4b6072', lit: 0.45 },
};

// Wall relief code per wall pattern (drives the analytic joint / clapboard normals in the facade shader; the
// pattern geometry there must match the painters below: brickPixels, paintWallPattern).
const RELIEF = { brick: 1, stone: 2, siding: 3, shingle: 4, panel: 5, concrete: 6 };

// Depth (m) of the window reveal behind the wall face, by facade style / wall kind.
function recessFor(o) {
  if (o.style === 'none') return 0;
  if (o.recess != null) return o.recess;
  if (o.style === 'curtain') return o.floor < 3.2 ? 0.04 : 0.07;
  if (o.style === 'ribbon') return 0.1;
  return o.wall === 'concrete' ? 0.26 : o.wall === 'stone' ? 0.22 : o.wall === 'panel' ? 0.12 : 0.17;
}

// ---------------------------------------------------------------- small canvas helpers
const rgb = (r, g, b) => `rgb(${r | 0},${g | 0},${b | 0})`;
const NRGB = [192, 192, 192];
function hexRgb(hex) {
  const c = new THREE.Color(hex);
  const m = c.getStyle(THREE.SRGBColorSpace).match(/(\d+),(\d+),(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : [128, 128, 128];
}
function shadeRgb([r, g, b], f) { return rgb(Math.min(255, r * f), Math.min(255, g * f), Math.min(255, b * f)); }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// Many same-coloured rects in one path fill (bucketed colour jitter instead of one fillStyle per brick).
function fillBuckets(g, buckets, colors) {
  for (let k = 0; k < buckets.length; k++) {
    const a = buckets[k];
    if (!a.length) continue;
    g.fillStyle = colors[k];
    g.beginPath();
    for (let i = 0; i < a.length; i += 4) g.rect(a[i], a[i + 1], a[i + 2], a[i + 3]);
    g.fill();
  }
}

// Pixel-level grain over the whole canvas (device pixels), one pass: every pixel is scaled by 1 ± amp and every
// block2×block2 cell additionally by 1 ± amp2. grey = the canvas is still neutral grey (walls / roofs are painted
// in grey and tinted per building), so one channel is read and the pixel written as a single 32-bit word.
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
function speckle(g, amp, seed, amp2 = 0, block2 = 4, grey = true) {
  const S = g.canvas.width, T = g.canvas.height;
  const img = g.getImageData(0, 0, S, T), d = img.data;
  let st = (seed | 0) || 0x9e3779b9;
  const a = amp * 2 / 4294967296, a0 = 1 - amp;
  const bw = Math.ceil(S / block2), bv = new Float32Array(bw * Math.ceil(T / block2)), bx = new Int32Array(S);
  for (let k = 0; k < bv.length; k++) { st ^= st << 13; st ^= st >>> 17; st ^= st << 5; bv[k] = ((st >>> 0) / 4294967296 - 0.5) * amp2 * 2; }
  for (let x = 0; x < S; x++) bx[x] = (x / block2) | 0;
  const u32 = grey && LITTLE_ENDIAN ? new Uint32Array(d.buffer, d.byteOffset, S * T) : null;
  for (let y = 0, i = 0; y < T; y++) {
    const row = ((y / block2) | 0) * bw;
    for (let x = 0; x < S; x++, i++) {
      st ^= st << 13; st ^= st >>> 17; st ^= st << 5;
      const f = a0 + (st >>> 0) * a + bv[row + bx[x]];
      if (u32) {
        let v = d[i * 4] * f; v = v > 255 ? 255 : v | 0;
        u32[i] = 0xff000000 | (v << 16) | (v << 8) | v;
      } else { const k = i * 4; d[k] *= f; d[k + 1] *= f; d[k + 2] *= f; }
    }
  }
  g.putImageData(img, 0, 0);
}

// Fraction of [a, b) covered by the joint part [solid, pitch) of a periodic pattern (box-filtered joints).
function jointCover(a, b, pitch, solid) {
  const J = pitch - solid;
  const F = (x) => { const k = Math.floor(x / pitch), r = x - k * pitch; return k * J + (r > solid ? r - solid : 0); };
  return (F(b) - F(a)) / (b - a);
}

// Running-bond brick written straight into the canvas pixels (whole canvas): box-filtered mortar joints,
// per-brick shade jitter (a few dark clinkers) and grain. mW / mH = metres per device pixel.
function brickPixels(g, mW, mH, seed) {
  const S = g.canvas.width, T = g.canvas.height;
  const img = g.createImageData(S, T), d = img.data;
  const bw = 0.215, bh = 0.0675;
  const PW = bw + Math.max(0.85 * mW, 0.01), CH = bh + Math.max(0.85 * mH, 0.01);
  const N = NRGB[0], mortar = N * 1.15;
  // per-column head-joint cover and brick index, for the two course offsets of the running bond
  const cx = [new Float32Array(S), new Float32Array(S)], ci = [new Int32Array(S), new Int32Array(S)];
  for (let o = 0; o < 2; o++) {
    const off = o * PW / 2;
    for (let x = 0; x < S; x++) {
      const a = x * mW + off, b = a + mW;
      cx[o][x] = jointCover(a, b, PW, bw); ci[o][x] = Math.imul(Math.floor((a + b) / 2 / PW), 19349663);
    }
  }
  const shades = new Float32Array(1024);
  let st = (seed | 0) || 0x9e3779b9;
  for (let k = 0; k < 1024; k++) {
    st ^= st << 13; st ^= st >>> 17; st ^= st << 5; const u = (st >>> 0) / 4294967296;
    shades[k] = N * (u < 0.035 ? 0.8 : 0.9 + ((u * 7919) % 1) * 0.16); // a few dark clinkers
  }
  const gA = 0.07 / 4294967296, g0 = 1 - 0.035;
  const u32 = LITTLE_ENDIAN ? new Uint32Array(d.buffer, d.byteOffset, S * T) : null;
  for (let y = 0, i = 0; y < T; y++) {
    const a = y * mH, b = a + mH;
    const cy = jointCover(a, b, CH, bh), row = Math.floor((a + b) / 2 / CH), o = row & 1;
    const cxo = cx[o], cio = ci[o], rh = Math.imul(row, 73856093);
    for (let x = 0; x < S; x++, i++) {
      const c = cxo[x] + cy - cxo[x] * cy;
      const br = shades[(cio[x] ^ rh) >>> 22];
      st ^= st << 13; st ^= st >>> 17; st ^= st << 5;
      let v = (br + (mortar - br) * c) * (g0 + (st >>> 0) * gA);
      v = v > 255 ? 255 : v | 0;
      if (u32) u32[i] = 0xff000000 | (v << 16) | (v << 8) | v;
      else { const k = i * 4; d[k] = d[k + 1] = d[k + 2] = v; d[k + 3] = 255; }
    }
  }
  g.putImageData(img, 0, 0);
}

// Wall pattern painters (neutral grey), in painter units: pxm = units per metre, ux / uy = units per device pixel.
function paintWallPattern(g, x0, y0, w, h, kind, pxm, ux, uy, r, seed = 1) {
  const N = NRGB;
  if (kind === 'siding') {
    // horizontal clapboards 0.18 m, each with a shadow line under its lower edge
    const bh = 0.18 * pxm, sh = Math.max(uy, bh * 0.16), hi = Math.max(uy * 0.8, bh * 0.12);
    const B = [[], [], [], []];
    for (let y = y0; y < y0 + h; y += bh) B[(r() * 4) | 0].push(x0, y, w, bh);
    fillBuckets(g, B, [0.97, 0.99, 1.01, 1.03].map((f) => shadeRgb(N, f)));
    const S = [], L = [];
    for (let y = y0; y < y0 + h; y += bh) { S.push(x0, y + bh - sh, w, sh); L.push(x0, y, w, hi); }
    fillBuckets(g, [S, L], [shadeRgb(N, 0.76), shadeRgb(N, 1.07)]);
    speckle(g, 0.035, seed);
  } else if (kind === 'shingle') {
    const rowH = 0.2 * pxm;
    const B = [[], [], [], [], []], D = [];
    for (let y = y0; y < y0 + h; y += rowH) {
      let x = x0 - r() * 0.2 * pxm;
      while (x < x0 + w) {
        const sw = (0.12 + r() * 0.2) * pxm;
        B[(r() * 5) | 0].push(x, y, sw - ux, rowH);
        x += sw;
      }
      D.push(x0, y + rowH - 2 * uy, w, 2 * uy);
    }
    fillBuckets(g, B, [0.9, 0.95, 1.0, 1.04, 1.08].map((f) => shadeRgb(N, f)));
    fillBuckets(g, [D], [shadeRgb(N, 0.7)]);
    speckle(g, 0.04, seed);
  } else if (kind === 'brick') {
    brickPixels(g, ux / pxm, uy / pxm, seed); // (always covers the whole tile)
  } else if (kind === 'stone') {
    // ashlar: 0.6 m courses of 1.2 m blocks with fine joints
    g.fillStyle = shadeRgb(N, 1); g.fillRect(x0, y0, w, h);
    const ch = 0.6 * pxm, bw = 1.2 * pxm;
    const B = [[], [], [], [], []], J = [];
    for (let y = y0, row = 0; y < y0 + h; y += ch, row++) {
      for (let x = x0 - (row % 2) * bw / 2; x < x0 + w; x += bw) {
        B[(r() * 5) | 0].push(x + ux, y + uy, bw - ux, ch - uy);
        J.push(x, y, ux, ch);
      }
      J.push(x0, y, w, uy);
    }
    fillBuckets(g, B, [0.95, 0.975, 1.0, 1.025, 1.05].map((f) => shadeRgb(N, f)));
    fillBuckets(g, [J], [shadeRgb(N, 0.84)]);
    speckle(g, 0.04, seed);
  } else if (kind === 'concrete' || kind === 'panel') {
    g.fillStyle = shadeRgb(N, 1); g.fillRect(x0, y0, w, h);
    // soft form-work tonal variation, then panel joints
    const p = (kind === 'panel' ? 1.5 : 3) * pxm;
    const B = [[], [], []];
    for (let x = x0; x < x0 + w; x += p) B[(r() * 3) | 0].push(x, y0, p, h);
    g.globalAlpha = 0.5; fillBuckets(g, B, [0.97, 1.0, 1.03].map((f) => shadeRgb(N, f))); g.globalAlpha = 1;
    const J = [];
    for (let x = x0; x < x0 + w; x += p) J.push(x, y0, Math.max(ux, 0.015 * pxm), h);
    fillBuckets(g, [J], [shadeRgb(N, 0.84)]);
    speckle(g, 0.05, seed, 0.025, 4);
  } else { // stucco / plain
    g.fillStyle = shadeRgb(N, 1); g.fillRect(x0, y0, w, h);
    speckle(g, 0.045, seed, 0.03, 5);
  }
}

// Glass pane with a diagonal sky-reflection gradient (+ occasional blinds).
function paintGlass(g, x, y, w, h, base, r, blinds = true) {
  const c = hexRgb(base);
  const grd = g.createLinearGradient(x, y, x + w * 0.4, y + h);
  grd.addColorStop(0, shadeRgb(c, 1.5)); grd.addColorStop(0.5, shadeRgb(c, 1)); grd.addColorStop(1, shadeRgb(c, 0.7));
  g.fillStyle = grd; g.fillRect(x, y, w, h);
  const k = r(), f = r(); // (always drawn, so the random stream doesn't depend on the flag)
  if (blinds && k < 0.4) { g.fillStyle = 'rgba(232,226,210,0.35)'; g.fillRect(x, y, w, h * (0.15 + f * 0.35)); }
}

// Ambient-occlusion-like shading inside a window opening: head shadow, one jamb shadow, faint sill line.
function revealShade(g, x, y, w, h, head, side) {
  let grd = g.createLinearGradient(0, y, 0, y + head);
  grd.addColorStop(0, 'rgba(0,0,0,0.42)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(x, y, w, head);
  grd = g.createLinearGradient(x, 0, x + side, 0);
  grd.addColorStop(0, 'rgba(0,0,0,0.26)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(x, y, side, h);
  grd = g.createLinearGradient(x + w, 0, x + w - side * 0.6, 0);
  grd.addColorStop(0, 'rgba(0,0,0,0.12)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(x + w - side * 0.6, y, side * 0.6, h);
  g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(x, y + h - side * 0.25, w, side * 0.25);
}

// ---------------------------------------------------------------- material factory
export function createBuildingMaterials(ctx) {
  const M = ctx.materials;
  const cache = new Map();
  const layers = { facade: [], surface: [] };
  const low = ctx.quality?.level === 'low';
  const SZ = {
    facade: { albedo: low ? 256 : 512, emissive: low ? 64 : 128, rough: low ? 128 : 256 },
    surface: { albedo: 256, emissive: 64, rough: 64 },
  };
  const uniforms = {
    uHover: { value: -1 },
    uSelect: { value: -1 },
    uHiColor: { value: new THREE.Color('#ffc861') },
  };

  // ---- pooled CPU canvases (one per channel and size)
  const pool = new Map();
  function canvas2d(tag, S) {
    const k = tag + S;
    let e = pool.get(k);
    if (!e) {
      const c = M.makeCanvas(S, S);
      e = { c, g: c.getContext('2d', { willReadFrequently: true }) };
      pool.set(k, e);
    }
    const g = e.g;
    if (g.reset) g.reset();
    else { g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, S, S); }
    return g;
  }

  // Paint one layer. W × H = the painter's coordinate space for the whole tile (canvas-like: y = 0 at the TOP of
  // the tile). Every channel is rasterised at its array size, flipped so that row 0 = v 0 (DataArrayTexture).
  // fn(gm, ge, gr, gd, ux, uy): albedo, emissive, rough (R mask, G roughness, B metal), depth (white = flush,
  // black = recessed opening); ux / uy = painter units per albedo pixel. Defaults: emissive black, rough = def.
  let paintMs = 0;
  function paintLayer(array, W, H, fn, def = {}, emit = 1) {
    const t0 = performance.now();
    const sz = SZ[array];
    const gm = canvas2d('a', sz.albedo), ge = canvas2d('e', sz.emissive), gr = canvas2d('r', sz.rough), gd = canvas2d('d', sz.rough);
    for (const [g, S] of [[gm, sz.albedo], [ge, sz.emissive], [gr, sz.rough], [gd, sz.rough]]) g.setTransform(S / W, 0, 0, -S / H, 0, S);
    ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
    gr.fillStyle = rgb((def.mask ?? 1) * 255, (def.rough ?? 0.9) * 255, (def.metal ?? 0) * 255); gr.fillRect(0, 0, W, H);
    gd.fillStyle = '#fff'; gd.fillRect(0, 0, W, H);
    fn(gm, ge, gr, gd, W / sz.albedo, H / sz.albedo);
    const albedo = gm.getImageData(0, 0, sz.albedo, sz.albedo).data;
    const emissive = ge.getImageData(0, 0, sz.emissive, sz.emissive).data;
    if (emit !== 1) for (let k = 0; k < emissive.length; k += 4) { emissive[k] *= emit; emissive[k + 1] *= emit; emissive[k + 2] *= emit; }
    const rough = gr.getImageData(0, 0, sz.rough, sz.rough).data;
    const depth = gd.getImageData(0, 0, sz.rough, sz.rough).data;
    for (let k = 3; k < rough.length; k += 4) rough[k] = depth[k - 3];
    paintMs += performance.now() - t0;
    return { albedo, emissive, rough };
  }

  // src = { albedo, emissive, rough (Uint8ClampedArray at the array sizes), tileW, tileH, recess (m) }
  function addLayer(array, key, src, meta = {}) {
    if (built) {
      // the texture arrays are already on the GPU: every slot must be requested before build() (buildings.js
      // warms up the detail-pass slots); fall back to painted trim instead of sampling a missing layer
      console.warn('[buildings] texture layer requested after build:', key);
      return cache.get('trim') || { key, array, layer: 0, tileW: 1, tileH: 1 };
    }
    const layer = layers[array].length;
    // code = the layer index the vertices carry: bit 15 selects the surface arrays (one material samples both)
    const slot = { key, array, layer, code: array === 'surface' ? 0x8000 | layer : layer, tileW: src.tileW, tileH: src.tileH, ...meta };
    layers[array].push(src);
    cache.set(key, slot);
    return slot;
  }

  // ------------------------------------------------ facade layers
  // Window-grid facade (opts may come from curated b.facade): wall pattern + punched / arched / ribbon / curtain
  // windows with baked reveal shading, sills and lintels. Tile = 4 bays x 3 storeys.
  const byOpts = new WeakMap(); // FACADES entries are reused objects: skip the JSON key for them
  function facadeSlot(opts) {
    const hit = byOpts.get(opts);
    if (hit) return hit;
    const o = {
      wall: 'brick', style: 'punched', bay: 3.6, floor: 3.8, winW: 1.6, winH: 2.1, sill: 0.9, frame: '#e8e2d4',
      glass: '#4f6d80', trim: null, lit: 0.4, ...opts, wallColor: NEUTRAL, seed: opts.seed ?? 3,
    };
    const key = `facade:${JSON.stringify(o)}`;
    if (cache.has(key)) { const s = cache.get(key); byOpts.set(opts, s); return s; }
    const slot = facadeSlotPaint(o, key);
    byOpts.set(opts, slot);
    return slot;
  }
  function facadeSlotPaint(o, key) {
    const BAYS = 4, FLOORS = 3;
    const tileW = o.bay * BAYS, tileH = o.floor * FLOORS;
    const curtain = o.style === 'curtain';
    const metal = curtain ? 90 : 10;
    const seed = hashStr(key);
    const r = M.rand((seed % 100000) + 17);
    const frameRgb = hexRgb(o.frame);
    const src = paintLayer('facade', tileW, tileH, (gm, ge, gr, gd, ux, uy) => {
      if (curtain) {
        // full-height glazing: per-panel reflection variation, spandrel bands at the slabs, mullions
        const cols = BAYS * 2, pw = tileW / cols, ph = o.floor;
        const spandrel = o.floor >= 3.2 ? 0.85 : 0;
        const mw = Math.max(1.4 * ux, 0.08);
        for (let f = 0; f < FLOORS; f++) {
          const top = tileH - (f + 1) * ph;
          for (let b = 0; b < cols; b++) {
            const kf = 0.9 + r() * 0.2, c = hexRgb(o.glass).map((v) => v * kf);
            const x = b * pw, grd = gm.createLinearGradient(x, top, x + pw * 0.3, top + ph);
            grd.addColorStop(0, shadeRgb(c, 1.42)); grd.addColorStop(0.45, shadeRgb(c, 1)); grd.addColorStop(1, shadeRgb(c, 0.72));
            gm.fillStyle = grd; gm.fillRect(x, top, pw, ph - spandrel);
            if (r() < 0.3 && low) { gm.fillStyle = 'rgba(235,228,210,0.3)'; gm.fillRect(x, top, pw, (ph - spandrel) * (0.15 + r() * 0.4)); }
            if (r() < o.lit) { ge.fillStyle = `rgba(255,${200 + (r() * 40) | 0},${130 + (r() * 60) | 0},${0.6 + r() * 0.4})`; ge.fillRect(x + mw, top + mw, pw - mw * 2, ph - spandrel - mw * 2); }
          }
          if (spandrel) {
            gm.fillStyle = shadeRgb(hexRgb(o.glass), 0.55); gm.fillRect(0, top + ph - spandrel, tileW, spandrel);
            gm.fillStyle = 'rgba(255,255,255,0.08)'; gm.fillRect(0, top + ph - spandrel, tileW, spandrel * 0.3);
          }
          // head shadow of the transom at the top of each vision panel
          const grd = gm.createLinearGradient(0, top, 0, top + 0.25);
          grd.addColorStop(0, 'rgba(0,0,0,0.3)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
          gm.fillStyle = grd; gm.fillRect(0, top, tileW, 0.25);
        }
        gr.fillStyle = rgb(0, 26, metal); gr.fillRect(0, 0, tileW, tileH);
        gd.fillStyle = '#000'; gd.fillRect(0, 0, tileW, tileH);
        // mullions + transoms (flush, slightly rough)
        const M1 = [], M2 = [];
        for (let b = 0; b <= cols; b++) M1.push(b * pw - mw / 2, 0, mw, tileH);
        for (let f = 0; f <= FLOORS; f++) M1.push(0, f * ph - mw, tileW, mw * 2);
        for (let b = 0; b <= cols; b++) M2.push(b * pw - mw / 2 + mw * 0.6, 0, mw * 0.4, tileH); // shaded side
        fillBuckets(gm, [M1, M2], [o.frame, shadeRgb(frameRgb, 0.72)]);
        fillBuckets(gr, [M1], [rgb(0, 90, metal)]);
        fillBuckets(gd, [M1], ['#fff']);
        return;
      }
      paintWallPattern(gm, 0, 0, tileW, tileH, o.wall, 1, ux, uy, r, seed);
      for (let f = 0; f < FLOORS; f++) {
        const floorTop = tileH - (f + 1) * o.floor; // top edge of this storey (canvas y down)
        if (o.trim) {
          gm.fillStyle = o.trim; gm.fillRect(0, floorTop + o.floor - 0.25, tileW, 0.25);
          gm.fillStyle = 'rgba(0,0,0,0.22)'; gm.fillRect(0, floorTop + o.floor, tileW, Math.max(uy, 0.03));
          gm.fillStyle = 'rgba(255,255,255,0.18)'; gm.fillRect(0, floorTop + o.floor - 0.25, tileW, Math.max(uy, 0.025));
        }
        if (o.style === 'none') continue;
        if (o.style === 'ribbon') {
          const y = floorTop + (o.floor - o.sill - o.winH), wh = o.winH;
          paintGlass(gm, 0, y, tileW, wh, o.glass, r, low);
          const n = BAYS * 3, pw = tileW / n, mw = Math.max(1.4 * ux, 0.06);
          const Mu = [], Ms = [];
          for (let b = 0; b <= n; b++) { Mu.push(b * pw - mw / 2, y, mw, wh); Ms.push(b * pw + mw * 0.1, y, mw * 0.4, wh); }
          Mu.push(0, y + wh - mw, tileW, mw);
          fillBuckets(gm, [Mu, Ms], [o.frame, shadeRgb(frameRgb, 0.7)]);
          revealShade(gm, 0, y, tileW, wh, 0.22, 0);
          // metal sill flashing + drip shadow under it
          gm.fillStyle = shadeRgb(frameRgb, 1.15); gm.fillRect(0, y + wh, tileW, 0.05);
          const grd = gm.createLinearGradient(0, y + wh + 0.05, 0, y + wh + 0.16);
          grd.addColorStop(0, 'rgba(0,0,0,0.26)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
          gm.fillStyle = grd; gm.fillRect(0, y + wh + 0.05, tileW, 0.11);
          gr.fillStyle = rgb(0, 38, metal); gr.fillRect(0, y, tileW, wh);
          gr.fillStyle = rgb(0, 110, metal); gr.fillRect(0, y + wh, tileW, 0.05);
          gd.fillStyle = '#000'; gd.fillRect(0, y, tileW, wh);
          for (let b = 0; b < n; b++) if (r() < o.lit) { ge.fillStyle = `rgba(255,${205 + (r() * 40) | 0},140,${0.55 + r() * 0.45})`; ge.fillRect(b * pw + mw, y + mw, pw - mw * 2, wh - mw * 2); }
          continue;
        }
        const arched = o.style === 'arched';
        if (o.band) {
          // stone belt course at sill height (1920s apartment blocks): untinted, light top edge, drip shadow below
          const by = floorTop + o.floor - o.sill, bh = 0.2;
          gm.fillStyle = '#d3ccbb'; gm.fillRect(0, by - 0.02, tileW, bh);
          gm.fillStyle = 'rgba(255,255,255,0.4)'; gm.fillRect(0, by - 0.02, tileW, Math.max(uy, 0.025));
          const grd = gm.createLinearGradient(0, by + bh - 0.02, 0, by + bh + 0.14);
          grd.addColorStop(0, 'rgba(0,0,0,0.28)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
          gm.fillStyle = grd; gm.fillRect(0, by + bh - 0.02, tileW, 0.16);
          gr.fillStyle = rgb(0, 205, 0); gr.fillRect(0, by - 0.02, tileW, bh);
        }
        const centres = [];
        for (let b = 0; b < BAYS; b++) {
          const c0 = (b + 0.5) * o.bay;
          if (o.pair) { const off = o.winW / 2 + (o.pairGap ?? 0.3) / 2; centres.push(c0 - off, c0 + off); } else centres.push(c0);
        }
        for (const cx of centres) {
          const ww = o.winW, wh = o.winH;
          const x = cx - ww / 2, y = floorTop + (o.floor - o.sill - o.winH);
          const fr = Math.max(1.6 * ux, 0.07);
          const opening = (g, grow = 0) => {
            g.beginPath();
            if (arched) {
              g.moveTo(x - grow, y + wh + grow); g.lineTo(x - grow, y + ww / 2);
              g.arc(cx, y + ww / 2, ww / 2 + grow, Math.PI, 0);
              g.lineTo(x + ww + grow, y + wh + grow); g.closePath();
            } else g.rect(x - grow, y - grow, ww + grow * 2, wh + grow * 2);
          };
          // lintel / voussoirs above the opening (tinted wall material, lighter or darker)
          if (o.lintel === 'stone') {
            // dressed stone lintel (untinted), optionally with a keystone
            const lx = x - 0.13, lw = ww + 0.26, ly = y - 0.34, lh = 0.3;
            gm.fillStyle = '#d8d1c0'; gm.fillRect(lx, ly, lw, lh);
            gm.fillStyle = 'rgba(255,255,255,0.35)'; gm.fillRect(lx, ly, lw, Math.max(uy, 0.03));
            gm.fillStyle = 'rgba(0,0,0,0.22)'; gm.fillRect(lx, ly + lh - Math.max(uy, 0.03), lw, Math.max(uy, 0.03));
            if (o.keystone) { gm.fillStyle = '#e2dccd'; gm.fillRect(cx - 0.11, ly - 0.05, 0.22, lh + 0.05); gm.fillStyle = 'rgba(0,0,0,0.18)'; gm.fillRect(cx + 0.11, ly - 0.05, Math.max(ux, 0.02), lh + 0.05); }
            gr.fillStyle = rgb(0, 200, 0); gr.fillRect(lx, ly - 0.05, lw, lh + 0.05);
          } else if (o.lintel === 'arch') {
            // segmental rowlock arch (header bricks on end), tinted with the wall
            gm.save();
            const rise = 0.2, span = ww + 0.2, R = (span * span / 4 + rise * rise) / (2 * rise), acx = cx, acy = y - 0.04 + R - rise;
            const a0 = Math.PI * 1.5 - Math.asin(span / 2 / R), a1 = Math.PI * 1.5 + Math.asin(span / 2 / R);
            gm.lineWidth = 0.22; gm.strokeStyle = 'rgba(0,0,0,0.12)';
            gm.beginPath(); gm.arc(acx, acy, R + 0.11, a0, a1); gm.stroke();
            gm.lineWidth = Math.max(ux, 0.012); gm.strokeStyle = 'rgba(255,255,255,0.3)';
            const n = Math.max(6, Math.round(span / 0.075));
            gm.beginPath();
            for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * (k / n), c = Math.cos(a), s = Math.sin(a); gm.moveTo(acx + c * R, acy + s * R); gm.lineTo(acx + c * (R + 0.22), acy + s * (R + 0.22)); }
            gm.stroke();
            gm.restore();
          } else if (arched) {
            gm.save();
            gm.lineWidth = 0.2; gm.strokeStyle = o.wall === 'brick' ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.1)';
            gm.beginPath(); gm.arc(cx, y + ww / 2, ww / 2 + 0.1, Math.PI, 0); gm.stroke();
            gm.fillStyle = 'rgba(255,255,255,0.22)'; gm.fillRect(cx - 0.12, y - 0.22, 0.24, 0.26); // keystone
            gm.restore();
          } else if (o.wall === 'brick') {
            gm.fillStyle = 'rgba(0,0,0,0.07)'; gm.fillRect(x - 0.1, y - 0.24, ww + 0.2, 0.22); // soldier course
            const J = [];
            for (let xx = x - 0.1; xx < x + ww + 0.1; xx += 0.075) J.push(xx, y - 0.24, Math.max(ux * 0.8, 0.01), 0.22);
            fillBuckets(gm, [J], ['rgba(255,255,255,0.28)']);
          } else if (o.wall === 'stone') {
            gm.fillStyle = 'rgba(255,255,255,0.1)'; gm.fillRect(x - 0.15, y - 0.3, ww + 0.3, 0.28);
            gm.fillStyle = 'rgba(0,0,0,0.12)'; gm.fillRect(x - 0.15, y - 0.3, ww + 0.3, Math.max(uy, 0.02));
          }
          // crisp edge where the wall face turns into the reveal
          gm.fillStyle = 'rgba(0,0,0,0.3)'; opening(gm, 0.04); gm.fill();
          gm.save(); opening(gm); gm.clip();
          gm.fillStyle = shadeRgb(frameRgb, 0.92); gm.fillRect(x, y, ww, wh);
          paintGlass(gm, x + fr, y + fr, ww - fr * 2, wh - fr * 2, o.glass, r, low);
          gm.fillStyle = o.frame;
          if (o.sash) {
            // double-hung sash: meeting rail at mid height, thin muntin in each sash (2-over-2)
            gm.fillRect(x, y + wh * 0.5 - fr * 0.6, ww, fr * 1.2);
            gm.fillRect(cx - fr * 0.3, y, fr * 0.6, wh);
            gm.fillStyle = 'rgba(0,0,0,0.25)';
            gm.fillRect(x, y + wh * 0.5 + fr * 0.6, ww, Math.max(uy, fr * 0.3));
          } else {
            gm.fillRect(cx - fr / 2, y, fr, wh);           // mullion
            gm.fillRect(x, y + wh * 0.3, ww, fr);          // transom
            gm.fillStyle = 'rgba(0,0,0,0.25)';
            gm.fillRect(cx + fr / 2, y, Math.max(ux, fr * 0.25), wh);
            gm.fillRect(x, y + wh * 0.3 + fr, ww, Math.max(uy, fr * 0.25));
          }
          revealShade(gm, x, y, ww, wh, 0.22, 0.16);
          gm.restore();
          // stone sill: light top, drip shadow on the wall below it
          const sx = x - 0.09, sw = ww + 0.18, sy = y + wh, sh = 0.08;
          gm.fillStyle = '#d6d0c2'; gm.fillRect(sx, sy, sw, sh);
          gm.fillStyle = 'rgba(255,255,255,0.45)'; gm.fillRect(sx, sy, sw, Math.max(uy, 0.02));
          const grd = gm.createLinearGradient(0, sy + sh, 0, sy + sh + 0.14);
          grd.addColorStop(0, 'rgba(0,0,0,0.3)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
          gm.fillStyle = grd; gm.fillRect(sx, sy + sh, sw, 0.14);
          // rough / depth / emissive
          gr.fillStyle = rgb(0, 110, metal); opening(gr); gr.fill();
          gr.fillStyle = rgb(0, 38, metal); gr.fillRect(x + fr, y + fr, ww - fr * 2, wh - fr * 2);
          gr.fillStyle = rgb(0, 200, 0); gr.fillRect(sx, sy, sw, sh);
          gd.fillStyle = '#000'; opening(gd); gd.fill();
          if (r() < o.lit) {
            const warm = 180 + ((r() * 60) | 0);
            ge.save(); opening(ge); ge.clip();
            ge.fillStyle = `rgba(255,${warm + 20},${warm - 40},${0.55 + r() * 0.45})`;
            ge.fillRect(x + fr, y + fr, ww - fr * 2, wh - fr * 2);
            ge.restore();
          }
        }
      }
    }, { mask: 1, rough: 0.9, metal: metal / 255 });
    const f = { bay: o.bay, floor: o.floor, winW: o.winW ?? 1.6, sill: o.sill ?? 0.9 };
    // interior-mapped rooms: one bay x one storey each (curtain walls: glass from the spandrel up to the slab)
    const room = o.style === 'none' || o.lit < 0.2 ? null : curtain
      ? { w: o.bay, h: o.floor, depth: 5.5, bottom: o.floor >= 3.2 ? 0.85 : 0, top: o.floor }
      : { w: o.bay, h: o.floor, depth: o.style === 'ribbon' ? 5 : 4.2, bottom: o.sill, top: o.sill + o.winH };
    return addLayer('facade', key, { ...src, tileW, tileH, recess: recessFor(o), room, relief: curtain ? 0 : RELIEF[o.wall] || 0 }, { bay: f.bay, floor: f.floor, winW: f.winW, sill: f.sill, curtain });
  }

  // Houses: clapboard / brick / stucco / shingle with double-hung windows (+ optional shutters).
  // Tile = 4 bays x 3 storeys; bay 3.0 m, storey 3.1 m (the third storey is an attic row with smaller windows).
  function houseSlot(wallKind, variant = 0, windows = true) {
    const key = `house:${wallKind}:${variant}:${windows ? 1 : 0}`;
    if (cache.has(key)) return cache.get(key);
    const bay = 3.0, floor = 3.1, BAYS = 4, FLOORS = 3, pxm = 48;
    const tileW = bay * BAYS, tileH = floor * FLOORS;
    const W = Math.round(tileW * pxm), H = Math.round(tileH * pxm);
    const r = M.rand(1000 + variant * 31 + wallKind.length * 7);
    const shutterColors = ['#2d3b31', '#222324', '#4b2a2a', '#2c3a4c'];
    const shutter = variant % 2 === 1 ? shutterColors[(variant >> 1) % shutterColors.length] : null;
    const trimCol = variant % 3 === 2 ? '#e8dcc0' : '#f1eee6';
    const src = paintLayer('facade', W, H, (gm, ge, gr, gd, ux, uy) => {
      paintWallPattern(gm, 0, 0, W, H, wallKind, pxm, ux, uy, r, hashStr(key));
      if (!windows) return;
      for (let f = 0; f < FLOORS; f++) {
        const floorTop = H - (f + 1) * floor * pxm;
        for (let b = 0; b < BAYS; b++) {
          if (r() > (f === 2 ? 0.7 : 0.9)) continue;
          const tall = f === 0 && r() < 0.4;
          const ww = (tall ? 1.0 : 0.92) * pxm, wh = (f === 2 ? 1.25 : tall ? 1.95 : 1.6) * pxm;
          const cx = (b + 0.5) * bay * pxm + (r() - 0.5) * 0.3 * pxm;
          const x = cx - ww / 2, y = floorTop + (floor - 0.85) * pxm - wh;
          const fr = 0.09 * pxm;
          if (shutter) {
            const sw = 0.4 * pxm, xl = x - fr - sw - 0.02 * pxm, xr = x + ww + fr + 0.02 * pxm;
            gm.fillStyle = shutter; gm.fillRect(xl, y, sw, wh); gm.fillRect(xr, y, sw, wh);
            const L = [];
            for (let yy = y + 3; yy < y + wh; yy += 4) L.push(xl, yy, sw, 1, xr, yy, sw, 1);
            fillBuckets(gm, [L], ['rgba(0,0,0,0.25)']);
            gr.fillStyle = rgb(0, 150, 0); gr.fillRect(xl, y, sw, wh); gr.fillRect(xr, y, sw, wh);
          }
          // shadow cast by the casing on the siding, casing + lintel + sill
          gm.fillStyle = 'rgba(0,0,0,0.18)'; gm.fillRect(x - fr + 2, y - fr * 1.8 + 3, ww + fr * 2, wh + fr * 2.8);
          gm.fillStyle = trimCol;
          gm.fillRect(x - fr, y - fr * 1.8, ww + fr * 2, wh + fr * 2.8);
          gm.fillStyle = 'rgba(0,0,0,0.25)'; gm.fillRect(x - fr, y + wh + fr, ww + fr * 2, 2);
          // two sashes, set back from the casing
          const gx = x + fr * 0.5, gy = y + fr * 0.3, gw = ww - fr, gh = wh - fr;
          paintGlass(gm, gx, gy, gw, wh / 2 - fr * 0.5, '#46545e', r, low);
          paintGlass(gm, gx, y + wh / 2 + fr * 0.2, gw, wh / 2 - fr * 0.7, '#46545e', r, low);
          gm.fillStyle = trimCol; gm.fillRect(x, y + wh / 2 - fr * 0.3, ww, fr * 0.6);
          if (r() < 0.5) gm.fillRect(cx - 1, y, 2, wh);
          revealShade(gm, gx, gy, gw, gh, 0.12 * pxm, 0.08 * pxm);
          gr.fillStyle = rgb(0, 110, 0); gr.fillRect(x - fr, y - fr * 1.8, ww + fr * 2, wh + fr * 2.8);
          gr.fillStyle = rgb(0, 30, 0); gr.fillRect(gx, gy, gw, gh);
          gd.fillStyle = '#000'; gd.fillRect(gx, gy, gw, gh);
          if (r() < 0.32) {
            const warm = 170 + ((r() * 60) | 0);
            ge.fillStyle = `rgba(255,${warm + 25},${warm - 50},${0.6 + r() * 0.4})`;
            ge.fillRect(gx, gy, gw, gh);
          }
        }
      }
    }, { mask: 1, rough: 225 / 255, metal: 0 }, 0.95);
    return addLayer('facade', key, { ...src, tileW, tileH, recess: windows ? 0.07 : 0, relief: RELIEF[wallKind] || 0, room: windows ? { w: bay, h: floor, depth: 4, bottom: 0.6, top: floor - 0.85 } : null },
      { bay, floor, winW: windows ? 0.95 : 0, sill: 0.85 });
  }

  // Street-level storefront (only on street-facing walls; 3D sign boards, awnings and ledges are added as geometry).
  // Tile = 2 shop units of 6 m x one 4.5 m storey, painted in metres (y = 0 at the top of the storey).
  // Brick pilasters and the sign frieze are wall (tinted to the building); frames, stall risers and glass are not.
  // Variants: frame / stall-riser finishes (black steel + granite, painted wood + panelled riser, anodised aluminium
  // + stone, dark bronze + tile).
  const SF_VARIANTS = [
    { frame: '#1c1e20', riser: '#2a2a2b', riserKind: 'granite', glass: '#3b4f5a' },
    { frame: '#243a2d', riser: '#243a2d', riserKind: 'panel', glass: '#40535c' },
    { frame: '#a3a8ab', riser: '#b7b0a2', riserKind: 'stone', glass: '#4a6070' },
    { frame: '#4a3a2b', riser: '#6d2f27', riserKind: 'tile', glass: '#3d4c55' },
    { frame: '#5b1d22', riser: '#5b1d22', riserKind: 'panel', glass: '#3e4d57' },
    { frame: '#26303d', riser: '#3a3b3c', riserKind: 'granite', glass: '#42586a' },
  ];
  function storefrontSlot(variant = 0) {
    const V = SF_VARIANTS[variant % SF_VARIANTS.length];
    const key = `storefront:${variant % SF_VARIANTS.length}`;
    if (cache.has(key)) return cache.get(key);
    const unit = 6, UNITS = 2, hM = 4.5, tileW = unit * UNITS;
    const r = M.rand(771 + variant * 37);
    const seed = hashStr(key);
    const fRgb = hexRgb(V.frame);
    const src = paintLayer('facade', tileW, hM, (gm, ge, gr, gd, ux, uy) => {
      paintWallPattern(gm, 0, 0, tileW, hM, 'brick', 1, ux, uy, r, seed);
      const Y = (m) => hM - m; // metres above the pavement -> painter y
      const fw = Math.max(1.5 * ux, 0.07);
      for (let s = 0; s < UNITS; s++) {
        const x0 = s * unit, pil = 0.42, gx = x0 + pil, gw = unit - pil * 2;
        const doorLeft = (s + variant) % 2 === 0;
        const dw = 1.15, dx = doorLeft ? gx + 0.35 : gx + gw - dw - 0.35;
        // cast shadow of the fascia / ledge on the brick above the frame
        let grd = gm.createLinearGradient(0, Y(3.55), 0, Y(3.35));
        grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,0.25)');
        gm.fillStyle = grd; gm.fillRect(gx - 0.1, Y(3.55), gw + 0.2, 0.2);
        // frame
        gm.fillStyle = V.frame; gm.fillRect(gx, Y(3.35), gw, 3.35);
        gr.fillStyle = rgb(0, 120, 30); gr.fillRect(gx, Y(3.35), gw, 3.35);
        // stall riser (bulkhead) under the display windows
        const rx0 = gx + fw, rw = gw - fw * 2;
        const risL = doorLeft ? dx + dw + fw : rx0, risR = doorLeft ? rx0 + rw : dx - fw;
        gm.fillStyle = V.riser; gm.fillRect(risL, Y(0.55), risR - risL, 0.55 - fw);
        if (V.riserKind === 'panel') {
          const n = Math.max(2, Math.round((risR - risL) / 1.2));
          for (let k = 0; k < n; k++) {
            const px = risL + (k + 0.15) * (risR - risL) / n, pw = (risR - risL) / n * 0.7;
            gm.fillStyle = shadeRgb(fRgb, 0.7); gm.fillRect(px, Y(0.45), pw, 0.3);
            gm.fillStyle = shadeRgb(fRgb, 1.25); gm.fillRect(px, Y(0.45) + 0.3 - Math.max(uy, 0.02), pw, Math.max(uy, 0.02));
          }
        } else if (V.riserKind === 'tile') {
          const T = [];
          for (let yy = 0.05; yy < 0.5; yy += 0.1) for (let xx = risL; xx < risR; xx += 0.1) T.push(xx, Y(yy + 0.1), Math.max(ux * 0.6, 0.008), 0.1);
          for (let yy = 0.05; yy < 0.5; yy += 0.1) T.push(risL, Y(yy), risR - risL, Math.max(uy * 0.6, 0.008));
          fillBuckets(gm, [T], ['rgba(255,255,255,0.18)']);
        } else if (V.riserKind === 'granite') {
          gm.fillStyle = 'rgba(255,255,255,0.08)'; gm.fillRect(risL, Y(0.55), risR - risL, 0.06);
        }
        gr.fillStyle = rgb(0, V.riserKind === 'granite' ? 70 : 150, 0); gr.fillRect(risL, Y(0.55), risR - risL, 0.55);
        // display glazing with mullions + transom lights
        const glassL = risL, glassR = risR, gy0 = 0.55, gy1 = 2.8;
        paintGlass(gm, glassL, Y(gy1), glassR - glassL, gy1 - gy0, V.glass, r, low);
        // interior depth: darker lower half (counters / shelving silhouettes)
        gm.fillStyle = 'rgba(10,12,14,0.35)'; gm.fillRect(glassL, Y(1.35), glassR - glassL, 0.8);
        for (let k = 0; k < 3; k++) { gm.fillStyle = `rgba(${(r() * 60) | 0},${(r() * 50) | 0},${(r() * 40) | 0},0.35)`; gm.fillRect(glassL + r() * (glassR - glassL - 0.8), Y(1.1 + r() * 0.9), 0.4 + r() * 0.5, 0.3 + r() * 0.5); }
        const nm = 1 + ((r() * 2) | 0);
        const M1 = [], M2 = [];
        for (let k = 1; k <= nm; k++) { const mx = glassL + ((glassR - glassL) * k) / (nm + 1); M1.push(mx - fw / 2, Y(gy1), fw, gy1 - gy0); M2.push(mx + fw / 2, Y(gy1), Math.max(ux, fw * 0.3), gy1 - gy0); }
        const tl0 = 2.9, tl1 = 3.28;
        paintGlass(gm, gx + fw, Y(tl1), gw - fw * 2, tl1 - tl0, V.glass, r);
        const nt = Math.max(3, Math.round(gw / 0.75));
        for (let k = 1; k < nt; k++) M1.push(gx + (gw * k) / nt - fw * 0.35, Y(tl1), fw * 0.7, tl1 - tl0);
        fillBuckets(gm, [M1, M2], [V.frame, 'rgba(0,0,0,0.3)']);
        // recessed entry door: deep jamb shadows, glass door with push bar
        gm.fillStyle = shadeRgb(fRgb, 0.55); gm.fillRect(dx, Y(2.6), dw, 2.6);
        paintGlass(gm, dx + 0.1, Y(2.45), dw - 0.2, 2.3, '#33434d', r);
        gm.fillStyle = V.frame; gm.fillRect(dx + 0.1, Y(1.1), dw - 0.2, 0.06);
        grd = gm.createLinearGradient(dx, 0, dx + 0.25, 0);
        grd.addColorStop(0, 'rgba(0,0,0,0.45)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
        gm.fillStyle = grd; gm.fillRect(dx, Y(2.6), 0.25, 2.6);
        grd = gm.createLinearGradient(0, Y(2.6), 0, Y(2.3));
        grd.addColorStop(0, 'rgba(0,0,0,0.45)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
        gm.fillStyle = grd; gm.fillRect(dx, Y(2.6), dw, 0.3);
        revealShade(gm, gx, Y(3.35), gw, 3.35, 0.3, 0.16);
        // ledge / sill of the frieze (untinted stone) + its drip shadow
        gm.fillStyle = '#cfc8b8'; gm.fillRect(gx - 0.12, Y(3.45), gw + 0.24, 0.1);
        gm.fillStyle = 'rgba(255,255,255,0.35)'; gm.fillRect(gx - 0.12, Y(3.45), gw + 0.24, Math.max(uy, 0.02));
        gr.fillStyle = rgb(0, 200, 0); gr.fillRect(gx - 0.12, Y(3.45), gw + 0.24, 0.1);
        gr.fillStyle = rgb(0, 25, 40); gr.fillRect(glassL, Y(gy1), glassR - glassL, gy1 - gy0); gr.fillRect(gx + fw, Y(tl1), gw - fw * 2, tl1 - tl0); gr.fillRect(dx + 0.1, Y(2.45), dw - 0.2, 2.3);
        // recessed openings (parallax): glazing + door
        gd.fillStyle = '#000'; gd.fillRect(gx, Y(3.35), gw, 3.35);
        // night: warm shop interiors, lit transoms
        ge.fillStyle = `rgba(255,${214 + ((r() * 30) | 0)},${150 + ((r() * 60) | 0)},0.5)`;
        ge.fillRect(glassL, Y(gy1), glassR - glassL, gy1 - gy0);
        ge.fillStyle = 'rgba(255,225,170,0.38)'; ge.fillRect(gx + fw, Y(tl1), gw - fw * 2, tl1 - tl0); ge.fillRect(dx + 0.1, Y(2.45), dw - 0.2, 2.3);
      }
    }, { mask: 1, rough: 0.9, metal: 0 }, 1.0);
    return addLayer('facade', key, { ...src, tileW, tileH: hM, recess: 0.2, relief: RELIEF.brick, room: { w: unit, h: 3.6, depth: 7, bottom: 0.55, top: 2.8 } },
      { bay: unit, floor: hM, winW: 3.5, sill: 0.55, shop: true });
  }

  // Awning fabric (surface array): striped (coloured stripes tinted per shop, white stripes untinted) or solid.
  function awningSlot(striped) {
    const key = `awning:${striped ? 1 : 0}`;
    if (cache.has(key)) return cache.get(key);
    const tileM = 2.4;
    const src = paintLayer('surface', tileM, tileM, (g, ge, gr, gd, ux, uy) => {
      g.fillStyle = shadeRgb(NRGB, 1); g.fillRect(0, 0, tileM, tileM);
      if (striped) {
        const W = [], Wm = [];
        for (let x = 0.3; x < tileM; x += 0.6) { W.push(x, 0, 0.3, tileM); Wm.push(x, 0, 0.3, tileM); }
        fillBuckets(g, [W], ['#ebe8df']);
        fillBuckets(gr, [Wm], [rgb(0, 225, 0)]);
      }
      const L = [];
      for (let y = 0; y < tileM; y += 0.04) L.push(0, y, tileM, Math.max(uy * 0.5, 0.006));
      fillBuckets(g, [L], ['rgba(0,0,0,0.06)']);
      speckle(g, 0.03, striped ? 881 : 882, 0.02, 3, false);
    }, { mask: 1, rough: 0.88, metal: 0 });
    return addLayer('surface', key, { ...src, tileW: tileM, tileH: tileM });
  }

  // Dormer / gable window: white casing, two-pane sash (untinted); faint lamp glow at night.
  function dormerSlot() {
    const key = 'dormer';
    if (cache.has(key)) return cache.get(key);
    const W = 1.3, H = 1.9, r = M.rand(313);
    const src = paintLayer('surface', W, H, (g, ge, gr) => {
      g.fillStyle = '#ebe7dd'; g.fillRect(0, 0, W, H);
      const x = 0.22, y = 0.32, w = W - 0.44, h = H - 0.55;
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x - 0.03, y - 0.03, w + 0.06, h + 0.06);
      paintGlass(g, x, y, w, h / 2 - 0.02, '#46545e', r);
      paintGlass(g, x, y + h / 2 + 0.02, w, h / 2 - 0.02, '#46545e', r);
      g.fillStyle = '#ebe7dd'; g.fillRect(x, y + h / 2 - 0.035, w, 0.07);
      revealShade(g, x, y, w, h, 0.12, 0.08);
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, W, 0.05);
      gr.fillStyle = rgb(0, 40, 0); gr.fillRect(x, y, w, h);
      ge.fillStyle = 'rgba(255,205,140,0.75)'; ge.fillRect(x, y, w, h);
    }, { mask: 0, rough: 0.7, metal: 0 });
    return addLayer('surface', key, { ...src, tileW: W, tileH: H });
  }

  // Open parking deck: concrete spandrels (tinted), dark openings with columns, parked cars and ceiling lights.
  function parkingSlot() {
    const key = 'parking';
    if (cache.has(key)) return cache.get(key);
    const bay = 8, BAYS = 3, floor = 3.0, FLOORS = 3, pxm = 21;
    const tileW = bay * BAYS, tileH = floor * FLOORS, W = tileW * pxm, H = tileH * pxm;
    const r = M.rand(31337);
    const src = paintLayer('facade', W, H, (gm, ge, gr, gd, ux, uy) => {
      paintWallPattern(gm, 0, 0, W, H, 'concrete', pxm, ux, uy, r, 31337);
      for (let f = 0; f < FLOORS; f++) {
        const oy = H - (f + 1) * floor * pxm, oh = (floor - 1.1) * pxm; // opening above a 1.1 m spandrel
        const grd = gm.createLinearGradient(0, oy, 0, oy + oh);
        grd.addColorStop(0, '#2b2c2e'); grd.addColorStop(0.25, '#1b1c1d'); grd.addColorStop(1, '#2e2f30');
        gm.fillStyle = grd; gm.fillRect(0, oy, W, oh);
        gr.fillStyle = rgb(0, 235, 0); gr.fillRect(0, oy, W, oh);
        gd.fillStyle = '#000'; gd.fillRect(0, oy, W, oh);
        for (let x = 0.3 * pxm; x < W; x += 2.6 * pxm) {
          if (r() < 0.35) continue;
          gm.fillStyle = ['#3a3f48', '#5b2a2a', '#555', '#2a2e36', '#6b6f75'][(r() * 5) | 0];
          gm.fillRect(x, oy + oh - 0.75 * pxm, 2.1 * pxm, 0.75 * pxm);
        }
        for (let x = bay * pxm * 0.25; x < W; x += bay * pxm * 0.5) {
          gm.fillStyle = '#d9dcd6'; gm.fillRect(x - 0.5 * pxm, oy + 2, 1.0 * pxm, 3);
          ge.fillStyle = 'rgba(235,245,255,0.9)'; ge.fillRect(x - 0.6 * pxm, oy + 1, 1.2 * pxm, 5);
          ge.fillStyle = 'rgba(200,215,230,0.2)'; ge.fillRect(x - 1.8 * pxm, oy, 3.6 * pxm, oh);
        }
        for (let b = 0; b <= BAYS; b++) {
          const cx0 = b * bay * pxm - 0.3 * pxm;
          gm.fillStyle = shadeRgb(NRGB, 0.92); gm.fillRect(cx0, oy, 0.6 * pxm, oh);
          gm.fillStyle = 'rgba(0,0,0,0.25)'; gm.fillRect(cx0 + 0.45 * pxm, oy, 0.15 * pxm, oh);
          gr.fillStyle = rgb(255, 230, 0); gr.fillRect(cx0, oy, 0.6 * pxm, oh);
          gd.fillStyle = '#fff'; gd.fillRect(cx0, oy, 0.6 * pxm, oh);
        }
        gm.fillStyle = 'rgba(0,0,0,0.35)'; gm.fillRect(0, oy + oh, W, 2);
      }
    }, { mask: 1, rough: 230 / 255, metal: 0 }, 0.8);
    return addLayer('facade', key, { ...src, tileW, tileH, recess: 0.3, relief: RELIEF.concrete },
      { bay, floor, winW: bay, sill: 1.1 });
  }

  // ------------------------------------------------ surface layers (painted in metres)
  // Plain tiling surface. kind: brick | stone | concrete | plain | tile | seam
  function surfaceSlot(kind, tileM, opts = {}) {
    const key = `surf:${kind}:${tileM}`;
    if (cache.has(key)) return cache.get(key);
    const r = M.rand(11 * 7919 + 1 + kind.length * 13);
    const seed = hashStr(key);
    const src = paintLayer('surface', tileM, tileM, (g, ge, gr, gd, ux, uy) => {
      if (kind === 'tile') {
        const N = NRGB;
        g.fillStyle = shadeRgb(N, 0.8); g.fillRect(0, 0, tileM, tileM);
        const rowH = 0.28, tw = 0.25;
        const B = [[], [], [], [], [], []], D = [];
        for (let y = 0, row = 0; y < tileM; y += rowH, row++) {
          for (let x = -(row % 2) * tw / 2; x < tileM; x += tw) {
            B[(r() * 6) | 0].push(x + ux, y, tw - 2 * ux, rowH - 2 * uy);
            D.push(x + ux, y + rowH - 3 * uy, tw - 2 * ux, 2 * uy);
          }
        }
        fillBuckets(g, B, [0.9, 0.94, 0.98, 1.02, 1.06, 1.1].map((f) => shadeRgb(N, f)));
        fillBuckets(g, [D], ['rgba(0,0,0,0.25)']);
        speckle(g, 0.04, seed);
      } else if (kind === 'shingle') {
        // asphalt 3-tab shingles: 14 cm courses, 33 cm tabs with keyways, staggered by half a tab per course;
        // shadow line under every course, strong granule grain, a few darker (weathered / replaced) tabs
        const N = NRGB, rowH = 0.143, tab = 1 / 3;
        g.fillStyle = shadeRgb(N, 0.9); g.fillRect(0, 0, tileM, tileM);
        const B = [[], [], [], [], [], []], K = [], D = [];
        for (let y = 0, row = 0; y < tileM - 1e-6; y += rowH, row++) {
          for (let x = -((row % 2) * tab) / 2 - (row % 3) * 0.05; x < tileM; x += tab) {
            B[r() < 0.025 ? 0 : 1 + ((r() * 5) | 0)].push(x, y, tab, rowH);
            K.push(x, y + rowH * 0.12, Math.max(ux, 0.01), rowH * 0.88);
          }
          D.push(0, y + rowH - Math.max(uy * 1.5, 0.012), tileM, Math.max(uy * 1.5, 0.012));
        }
        fillBuckets(g, B, [0.84, 0.94, 0.97, 1.0, 1.03, 1.06].map((f) => shadeRgb(N, f)));
        fillBuckets(g, [K, D], ['rgba(0,0,0,0.35)', 'rgba(0,0,0,0.3)']);
        speckle(g, 0.09, seed, 0.03, 3);
      } else if (kind === 'slate') {
        // natural slate: 20 cm courses of 22–36 cm slates, mottled per slate, dark joints and a lit lower edge
        const N = NRGB, rowH = 0.2;
        g.fillStyle = shadeRgb(N, 0.7); g.fillRect(0, 0, tileM, tileM);
        const B = [[], [], [], [], [], [], []], J = [], L = [];
        for (let y = 0; y < tileM - 1e-6; y += rowH) {
          let x = -r() * 0.3;
          while (x < tileM) {
            const w = 0.22 + r() * 0.14;
            B[(r() * 7) | 0].push(x + ux, y + uy, w - 2 * ux, rowH - uy);
            J.push(x, y, Math.max(ux, 0.008), rowH);
            x += w;
          }
          L.push(0, y + rowH - Math.max(uy, 0.01), tileM, Math.max(uy, 0.01));
        }
        fillBuckets(g, B, [0.82, 0.88, 0.94, 1.0, 1.05, 1.1, 1.16].map((f) => shadeRgb(N, f)));
        fillBuckets(g, [J, L], ['rgba(0,0,0,0.4)', 'rgba(255,255,255,0.12)']);
        speckle(g, 0.05, seed, 0.04, 6);
      } else if (kind === 'seam') { // standing-seam metal roof
        g.fillStyle = shadeRgb(NRGB, 1); g.fillRect(0, 0, tileM, tileM);
        speckle(g, 0.035, seed);
        const s = 0.5, L = [], D = [];
        for (let x = 0; x < tileM; x += s) { L.push(x, 0, 2 * ux, tileM); D.push(x + 2 * ux, 0, ux, tileM); }
        fillBuckets(g, [L, D], [shadeRgb(NRGB, 1.18), shadeRgb(NRGB, 0.8)]);
      } else {
        paintWallPattern(g, 0, 0, tileM, tileM, kind, 1, ux, uy, r, seed);
      }
    }, { mask: 1, rough: opts.roughness ?? 0.9, metal: opts.metal ?? 0 });
    return addLayer('surface', key, { ...src, tileW: tileM, tileH: tileM });
  }

  // Flat roof membrane (tinted per building: white TPO, grey, dark EPDM): seams every 3 m with end laps, ponding
  // stains around drains, dirt streaks, walkway pads and strong grain so the big decks read as real roofs from the air.
  function flatRoofSlot() {
    const key = 'roof:flat';
    if (cache.has(key)) return cache.get(key);
    const tileM = 16;
    const r = M.rand(4242);
    const src = paintLayer('surface', tileM, tileM, (g, ge, gr, gd, ux, uy) => {
      g.fillStyle = shadeRgb(NRGB, 0.95); g.fillRect(0, 0, tileM, tileM); // (weathered: a bit below the nominal colour)
      // broad tonal blotches (UV-weathering, re-coats)
      for (let i = 0; i < 9; i++) {
        const x = r() * tileM, y = r() * tileM, rad = 1.5 + r() * 3.5;
        const grd = g.createRadialGradient(x, y, 0, x, y, rad);
        const c = r() < 0.5 ? '0,0,0' : '255,255,255';
        grd.addColorStop(0, `rgba(${c},${0.04 + r() * 0.05})`); grd.addColorStop(1, `rgba(${c},0)`);
        g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      // stains
      for (let i = 0; i < 12; i++) {
        g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.07})`;
        g.beginPath(); g.ellipse(r() * tileM, r() * tileM, 0.4 + r() * 1.4, 0.25 + r() * 0.8, r() * 3, 0, 7); g.fill();
      }
      // roof drains: ponding ring + dark streaks running towards them
      for (let i = 0; i < 3; i++) {
        const x = 1.5 + r() * (tileM - 3), y = 1.5 + r() * (tileM - 3), rad = 1.0 + r() * 1.4;
        g.save(); g.translate(x, y); g.scale(1, 0.6 + r() * 0.5); g.rotate(r() * 3);
        const grd = g.createRadialGradient(0, 0, 0, 0, 0, rad);
        grd.addColorStop(0, `rgba(0,0,0,${0.12 + r() * 0.08})`); grd.addColorStop(0.6, 'rgba(0,0,0,0.05)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd; g.fillRect(-rad, -rad, rad * 2, rad * 2);
        g.restore();
        g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.arc(x, y, 0.1, 0, 7); g.fill();
        for (let k = 0; k < 2; k++) {
          const a = r() * Math.PI * 2, len = 1.5 + r() * 2.5;
          g.save(); g.translate(x, y); g.rotate(a);
          const sg = g.createLinearGradient(0, 0, len, 0);
          sg.addColorStop(0, 'rgba(0,0,0,0.1)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = sg; g.fillRect(0, -0.1, len, 0.2);
          g.restore();
        }
      }
      // membrane seams every 3 m (heat-welded laps: dark line + light edge) and staggered end laps
      const S = [], Hl = [], E = [];
      for (let x = 0; x < tileM; x += 3) { S.push(x, 0, Math.max(1.2 * ux, 0.05), tileM); Hl.push(x + Math.max(1.2 * ux, 0.05), 0, Math.max(ux, 0.03), tileM); }
      for (let x = 0; x < tileM; x += 3) { const y = r() * tileM; E.push(x, y, 3, Math.max(1.2 * uy, 0.05)); }
      fillBuckets(g, [S, Hl, E], [shadeRgb(NRGB, 0.78), shadeRgb(NRGB, 1.06), shadeRgb(NRGB, 0.8)]);
      // walkway pads (light, slightly rough squares in a row)
      const wy = r() * tileM, P = [];
      for (let x = 0; x < tileM; x += 0.9) P.push(x + 0.05, wy, 0.75, 0.75);
      fillBuckets(g, [P], [shadeRgb(NRGB, 1.12)]);
      speckle(g, 0.09, 4242, 0.05, 3);
    }, { mask: 1, rough: 0.93, metal: 0 });
    return addLayer('surface', key, { ...src, tileW: tileM, tileH: tileM });
  }

  // Gravel-ballasted flat roof: coarse stone grain, wind-swept bare patches and drains.
  function gravelRoofSlot() {
    const key = 'roof:gravel';
    if (cache.has(key)) return cache.get(key);
    const tileM = 16;
    const r = M.rand(9191);
    const src = paintLayer('surface', tileM, tileM, (g) => {
      g.fillStyle = shadeRgb(NRGB, 0.93); g.fillRect(0, 0, tileM, tileM);
      for (let i = 0; i < 14; i++) {
        const x = r() * tileM, y = r() * tileM, rad = 0.8 + r() * 2.6;
        const grd = g.createRadialGradient(x, y, 0, x, y, rad);
        const c = r() < 0.6 ? '0,0,0' : '255,255,255';
        grd.addColorStop(0, `rgba(${c},${0.06 + r() * 0.08})`); grd.addColorStop(1, `rgba(${c},0)`);
        g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      for (let i = 0; i < 2; i++) { // drains: gravel pushed back from a dark ring
        const x = 1.5 + r() * (tileM - 3), y = 1.5 + r() * (tileM - 3);
        g.fillStyle = 'rgba(0,0,0,0.08)'; g.beginPath(); g.arc(x, y, 0.6 + r() * 0.5, 0, 7); g.fill();
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.arc(x, y, 0.14, 0, 7); g.fill();
      }
      speckle(g, 0.16, 9191, 0.07, 2);
    }, { mask: 1, rough: 0.97, metal: 0 });
    return addLayer('surface', key, { ...src, tileW: tileM, tileH: tileM });
  }

  function copperSlot() {
    const key = 'roof:copper';
    if (cache.has(key)) return cache.get(key);
    const tileM = 4, r = M.rand(7 * 7919 + 1), base = hexRgb(M.palette?.copperGreen || '#6b9d88');
    const src = paintLayer('surface', tileM, tileM, (g, ge, gr, gd, ux) => {
      g.fillStyle = rgb(...base); g.fillRect(0, 0, tileM, tileM);
      const A = [], B = [];
      for (let i = 0; i < 90; i++) (r() > 0.5 ? A : B).push(r() * tileM, 0, (1 + r() * 3) * ux, tileM);
      g.globalAlpha = 0.5;
      fillBuckets(g, [A, B], ['rgba(40,70,60,0.1)', 'rgba(160,210,190,0.1)']);
      g.globalAlpha = 1;
      const L = [];
      for (let x = 0; x < tileM; x += 0.45) L.push(x, 0, 1.5 * ux, tileM);
      fillBuckets(g, [L], [shadeRgb(base, 0.78)]);
      speckle(g, 0.03, 77, 0, 4, false);
    }, { mask: 0, rough: 0.6, metal: 0.25 });
    return addLayer('surface', key, { ...src, tileW: tileM, tileH: tileM });
  }

  // Rooftop mechanical units: light metal with louvre lines
  function unitSlot() {
    const key = 'unit';
    if (cache.has(key)) return cache.get(key);
    const tileM = 2;
    const src = paintLayer('surface', tileM, tileM, (g, ge, gr, gd, ux, uy) => {
      g.fillStyle = shadeRgb(NRGB, 1.05); g.fillRect(0, 0, tileM, tileM);
      const L = [];
      for (let y = 0; y < tileM; y += 0.125) L.push(0, y, tileM, Math.max(uy, 0.03));
      fillBuckets(g, [L], [shadeRgb(NRGB, 0.78)]);
      speckle(g, 0.03, 77);
    }, { mask: 1, rough: 0.55, metal: 0.35 });
    return addLayer('surface', key, { ...src, tileW: tileM, tileH: tileM });
  }

  // Top of a packaged rooftop unit (one 1.6 m tile per fan): galvanised panel with a round fan guard and blades.
  function unitTopSlot() {
    const key = 'unit:top';
    if (cache.has(key)) return cache.get(key);
    const tileM = 1.6;
    const src = paintLayer('surface', tileM, tileM, (g, ge, gr, gd, ux) => {
      g.fillStyle = '#b9bcbd'; g.fillRect(0, 0, tileM, tileM);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, tileM, 0.03); g.fillRect(0, 0, 0.03, tileM);
      g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, tileM - 0.03, tileM, 0.03);
      const c = tileM / 2, R = 0.58;
      g.fillStyle = '#26292b'; g.beginPath(); g.arc(c, c, R, 0, 7); g.fill();
      g.strokeStyle = '#8c9092'; g.lineWidth = Math.max(ux, 0.018);
      for (let k = 1; k <= 5; k++) { g.beginPath(); g.arc(c, c, (R * k) / 5, 0, 7); g.stroke(); }
      g.fillStyle = '#5b5f62';
      for (let k = 0; k < 5; k++) {
        g.save(); g.translate(c, c); g.rotate((k / 5) * Math.PI * 2 + 0.3);
        g.beginPath(); g.ellipse(R * 0.45, 0, R * 0.42, R * 0.14, 0.35, 0, 7); g.fill(); g.restore();
      }
      g.fillStyle = '#9ea2a4'; g.beginPath(); g.arc(c, c, 0.09, 0, 7); g.fill();
      speckle(g, 0.03, 515, 0, 4, false);
      gr.fillStyle = rgb(0, 120, 90); gr.fillRect(0, 0, tileM, tileM);
    }, { mask: 0, rough: 0.5, metal: 0.35 });
    return addLayer('surface', key, { ...src, tileW: tileM, tileH: tileM });
  }

  // Skylight glazing (sky-tinted glass in an aluminium grid; faint glow from below at night).
  function skylightSlot() {
    const key = 'skylight';
    if (cache.has(key)) return cache.get(key);
    const tileM = 1.2, r = M.rand(1212);
    const src = paintLayer('surface', tileM, tileM, (g, ge, gr, gd, ux) => {
      g.fillStyle = '#c9ccce'; g.fillRect(0, 0, tileM, tileM);
      paintGlass(g, 0.05, 0.05, tileM - 0.1, tileM - 0.1, '#6d8797', r);
      g.fillStyle = '#c9ccce'; g.fillRect(tileM / 2 - 0.025, 0, 0.05, tileM);
      gr.fillStyle = rgb(0, 150, 80); gr.fillRect(0, 0, tileM, tileM);
      gr.fillStyle = rgb(0, 20, 60); gr.fillRect(0.05, 0.05, tileM / 2 - 0.08, tileM - 0.1); gr.fillRect(tileM / 2 + 0.03, 0.05, tileM / 2 - 0.08, tileM - 0.1);
      ge.fillStyle = 'rgba(255,236,200,0.5)'; ge.fillRect(0.05, 0.05, tileM - 0.1, tileM - 0.1);
    }, { mask: 0, rough: 0.2, metal: 0.3 });
    return addLayer('surface', key, { ...src, tileW: tileM, tileH: tileM });
  }

  // Painted trim (fascia boards, soffits, posts, metal copings): plain neutral, tinted
  function trimSlot() {
    const key = 'trim';
    if (cache.has(key)) return cache.get(key);
    const src = paintLayer('surface', 1, 1, (g) => { g.fillStyle = NEUTRAL; g.fillRect(0, 0, 1, 1); }, { mask: 1, rough: 0.7, metal: 0.1 });
    return addLayer('surface', key, { ...src, tileW: 1, tileH: 1 });
  }

  // Glazed double entrance door (lit at night)
  function doorSlot() {
    const key = 'door';
    if (cache.has(key)) return cache.get(key);
    const px = 128, r = M.rand(9);
    const src = paintLayer('surface', px, px, (g, ge) => {
      g.fillStyle = '#2c2f31'; g.fillRect(0, 0, px, px);
      paintGlass(g, 6, 8, px / 2 - 9, px - 10, '#3e5360', r);
      paintGlass(g, px / 2 + 3, 8, px / 2 - 9, px - 10, '#3e5360', r);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(6, 8, px - 12, 6);
      ge.fillStyle = 'rgba(255,215,150,0.85)'; ge.fillRect(6, 8, px - 12, px - 10);
    }, { mask: 0, rough: 0.2, metal: 0.4 });
    return addLayer('surface', key, { ...src, tileW: 2.4, tileH: 3.0 });
  }

  // Panelled front door with a glazed top light and white casing (door leaf tinted per house)
  function woodDoorSlot() {
    const key = 'door:wood';
    if (cache.has(key)) return cache.get(key);
    const W = 64, H = 128, r = M.rand(21);
    const N = NRGB;
    const src = paintLayer('surface', W, H, (g, ge, gr) => {
      g.fillStyle = '#efece4'; g.fillRect(0, 0, W, H);               // casing (untinted)
      gr.fillStyle = rgb(0, 150, 0); gr.fillRect(0, 0, W, H);
      g.fillStyle = shadeRgb(N, 1); g.fillRect(7, 14, W - 14, H - 14); // leaf (tinted)
      gr.fillStyle = rgb(255, 120, 0); gr.fillRect(7, 14, W - 14, H - 14);
      for (const [x, y, w, h] of [[12, 52, 17, 30], [35, 52, 17, 30], [12, 88, 17, 32], [35, 88, 17, 32]]) {
        g.fillStyle = shadeRgb(N, 0.8); g.fillRect(x, y, w, h);
        g.fillStyle = shadeRgb(N, 1.1); g.fillRect(x, y, w, 2);
      }
      paintGlass(g, 12, 20, W - 24, 26, '#4d5a63', r);                 // glazed top panel
      gr.fillStyle = rgb(0, 30, 0); gr.fillRect(12, 20, W - 24, 26);
      g.fillStyle = '#c9a44a'; g.fillRect(W - 16, 84, 4, 4);           // brass knob
      ge.fillStyle = 'rgba(255,205,140,0.9)'; ge.fillRect(12, 20, W - 24, 26);
    }, { mask: 1, rough: 0.9, metal: 0 });
    return addLayer('surface', key, { ...src, tileW: 1.1, tileH: 2.3 });
  }

  // ------------------------------------------------ texture arrays + materials (call after all slots are known)
  function buildArray(list, size, channel) {
    const n = Math.max(1, list.length);
    const stride = size * size * 4;
    const data = new Uint8Array(stride * n);
    list.forEach((src, i) => { const px = src[channel]; if (px && px.length === stride) data.set(px, i * stride); });
    const tex = new THREE.DataArrayTexture(data, size, size, n);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.min(8, ctx.renderer?.capabilities?.getMaxAnisotropy?.() ?? 4);
    tex.colorSpace = channel === 'rough' ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    tex.needsUpdate = true; // (the CPU copy is kept so three can re-upload after a WebGL context restore)
    return tex;
  }

  // ONE material for all generic-building geometry (so a chunk is a single draw call, in the main and the shadow
  // passes): it samples the FACADE arrays or the SURFACE arrays, chosen per vertex by bit 15 of the layer index.
  // Facade texels: one-step parallax inside recessed openings, interior mapping behind the glass, analytic wall
  // relief. Surface texels (roofs & trim): world-space macro variation on up-facing surfaces so large decks and roof
  // fields don't read as flat uniform planes. Both: dirt / ambient-occlusion band at the foot of vertical faces
  // (ground height in tint.w).
  //
  // Interior mapping (facade, not on 'low'): every window belongs to a room cell (one bay x one storey of the layer's
  // tile). The view ray is continued behind the glass into a box room (side walls, floor, ceiling, back wall at the
  // layer's room depth); the room's colours, furniture band, blinds and — at night — whether its light is on and its
  // colour temperature come from a hash of (cell, building). Glass = low roughness inside a recessed opening.
  // room data per layer: A = (tileW, tileH, cellW, cellH) m, B = (depth, window bottom, window top, reveal depth) m
  function arrayMaterial(name, texF, texS, nightIntensity, roomA = [], roomB = []) {
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff', roughness: 1, metalness: 1, emissive: new THREE.Color('#fff3e2'), emissiveIntensity: 0,
    });
    mat.name = name;
    const parallax = !low && roomA.length > 0;
    mat.defines = { ...mat.defines, TINT_RANGE: TINT_RANGE.toFixed(1), GROUND_BIAS: GROUND_BIAS.toFixed(1) };
    if (parallax) {
      mat.defines.BLD_PARALLAX = ''; mat.defines.BLD_NL = String(roomA.length);
      // interior mapping (1) and wall relief (2); ?bldfx= switches them off for comparisons
      let fx = 3;
      try { const q = new URLSearchParams(location.search).get('bldfx'); if (q !== null && q !== '') fx = +q; } catch { /* no location */ }
      if (fx & 1) mat.defines.BLD_INTERIOR = '';
      if (fx & 2) mat.defines.BLD_RELIEF = '';
    }
    const uRoomA = { value: roomA }, uRoomB = { value: roomB };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.tAlbedoF = { value: texF.albedo };
      shader.uniforms.tEmitF = { value: texF.emissive };
      shader.uniforms.tRoughF = { value: texF.rough };
      shader.uniforms.tAlbedoS = { value: texS.albedo };
      shader.uniforms.tEmitS = { value: texS.emissive };
      shader.uniforms.tRoughS = { value: texS.rough };
      shader.uniforms.uHover = uniforms.uHover;
      shader.uniforms.uSelect = uniforms.uSelect;
      shader.uniforms.uHiColor = uniforms.uHiColor;
      if (parallax) { shader.uniforms.uRoomA = uRoomA; shader.uniforms.uRoomB = uRoomB; }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec4 tint;
attribute uvec2 bidLayer;
varying float vBid;
flat varying float vLayer;
flat varying float vArr;
varying vec2 vAUv;
varying vec3 vTint;
varying vec2 vGY;
varying vec3 vWPos;
varying float vUp;
#ifdef BLD_PARALLAX
uniform vec4 uRoomA[ BLD_NL ];
uniform vec4 uRoomB[ BLD_NL ];
varying vec3 vTView;
varying vec2 vRecess;
flat varying vec4 vRoomA;
flat varying vec4 vRoomB;
flat varying float vKind;
#endif`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
	vBid = float( bidLayer.x );
	uint bLy = bidLayer.y & 0x7FFFu;
	vLayer = float( bLy );
	vArr = float( bidLayer.y >> 15u );                   // 0 = facade arrays, 1 = surface arrays
	vAUv = uv;
	vTint = tint.rgb * TINT_RANGE;
	{
		vec3 bWP = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
		vec3 bWN = normalize( mat3( modelMatrix ) * objectNormal );
		// (world y, ground y under the vertex): drives the grime band at the foot of the walls
		vGY = vec2( bWP.y, tint.w * 655.35 - GROUND_BIAS );
#ifdef BLD_PARALLAX
		// view vector in the wall's (u along the wall, v up, n out) frame; recess only on vertical faces
		vec3 bV = cameraPosition - bWP;
		vTView = vec3( dot( bV, vec3( - bWN.z, 0.0, bWN.x ) ), bV.y, dot( bV, bWN ) );
		int bl = min( int( bLy ), BLD_NL - 1 );
		float bVertical = ( 1.0 - step( 0.3, abs( bWN.y ) ) ) * ( 1.0 - vArr ); // (room data: facade layers only)
		vec4 bRB = uRoomB[ bl ];
		float bKind = floor( bRB.w / 10.0 + 0.01 );
		vRoomA = uRoomA[ bl ];
		vRoomB = vec4( bRB.xyz, bRB.w - bKind * 10.0 ) * bVertical;
		vKind = bKind * bVertical;
		vRecess = vec2( vRoomB.w ) / max( vRoomA.xy, vec2( 1e-3 ) );
#endif
		vWPos = bWP;
		vUp = bWN.y;
	}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2DArray tAlbedoF;
uniform sampler2DArray tEmitF;
uniform sampler2DArray tRoughF;
uniform sampler2DArray tAlbedoS;
uniform sampler2DArray tEmitS;
uniform sampler2DArray tRoughS;
uniform float uHover;
uniform float uSelect;
uniform vec3 uHiColor;
varying float vBid;
flat varying float vLayer;
flat varying float vArr;
varying vec2 vAUv;
varying vec3 vTint;
varying vec2 vGY;
varying vec3 vWPos;
varying float vUp;
#ifdef BLD_PARALLAX
varying vec3 vTView;
varying vec2 vRecess;
flat varying vec4 vRoomA;
flat varying vec4 vRoomB;
flat varying float vKind;
// Wall relief height (0 = joint / lap, 1 = face) at texture metres m (u along the wall, v up) for a relief code.
float bBevel( float c, float solid, float e ) { return smoothstep( 0.0, e, c ) * ( 1.0 - smoothstep( solid - e, solid, c ) ); }
float bReliefH( vec2 m, float kind, vec2 tile ) {
	if ( kind < 1.5 ) {            // running-bond brick (brickPixels)
		vec2 px = tile / 512.0;
		float PW = 0.215 + max( 0.85 * px.x, 0.01 ), CH = 0.0675 + max( 0.85 * px.y, 0.01 );
		float row = floor( m.y / CH ), cy = m.y - row * CH;
		float cx = mod( m.x + mod( row, 2.0 ) * PW * 0.5, PW );
		return min( bBevel( cx, 0.215, 0.005 ), bBevel( cy, 0.0675, 0.004 ) );
	} else if ( kind < 2.5 ) {     // ashlar: 0.6 m courses of 1.2 m blocks, counted from the tile top
		float yd = tile.y - m.y, row = floor( yd / 0.6 ), cy = yd - row * 0.6;
		float cx = mod( m.x + mod( row, 2.0 ) * 0.6, 1.2 );
		return min( bBevel( cx, 1.2, 0.012 ), bBevel( 0.6 - cy, 0.6, 0.012 ) );
	} else if ( kind < 4.5 ) {     // clapboard (0.18 m) / wall shingles (0.2 m): each course thickens to its lower edge
		float p = kind < 3.5 ? 0.18 : 0.2;
		float fb = fract( ( tile.y - m.y ) / p );
		return fb * 0.8 * ( 1.0 - smoothstep( 0.93, 1.0, fb ) ) + 0.2;
	} else {                       // panel / board-formed concrete joints
		float p = kind < 5.5 ? 1.5 : 3.0, cx = mod( m.x, p );
		return bBevel( cx, p, 0.02 );
	}
}
float bH3( vec3 p ) { p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) ); p += dot( p, p.yxz + 33.33 ); return fract( ( p.x + p.y ) * p.z ); }
vec3 bWallPaint( float h ) {
	return h < 0.3 ? vec3( 0.80, 0.77, 0.70 ) : h < 0.5 ? vec3( 0.74, 0.76, 0.74 ) : h < 0.65 ? vec3( 0.70, 0.73, 0.78 )
		: h < 0.78 ? vec3( 0.78, 0.70, 0.60 ) : h < 0.9 ? vec3( 0.62, 0.68, 0.60 ) : vec3( 0.86, 0.84, 0.80 );
}
vec3 bFloorColor( float h ) {
	return h < 0.45 ? vec3( 0.42, 0.29, 0.19 ) : h < 0.7 ? vec3( 0.30, 0.30, 0.32 ) : h < 0.85 ? vec3( 0.52, 0.40, 0.28 ) : vec3( 0.25, 0.22, 0.24 );
}
#endif
float bHash( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }
float bNoise( vec2 p ) {
	vec2 i = floor( p ), f = fract( p ), u = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( bHash( i ), bHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( bHash( i + vec2( 0.0, 1.0 ) ), bHash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}`)
        .replace('#include <map_fragment>', `
	bool bFac = vArr < 0.5;
	float bL = vLayer;
	vec2 bGx = dFdx( vAUv ), bGy = dFdy( vAUv );
	vec2 bUv = vAUv;
#ifdef BLD_PARALLAX
	// one-step parallax: texels inside a recessed opening are looked up where the view ray meets the glass plane;
	// if that lands on the wall, we are looking at the reveal (jamb / head / sill) -> darkened wall
	float bOpen = 0.0;
	if ( bFac && vRoomB.w > 0.0 ) bOpen = 1.0 - smoothstep( 0.3, 0.7, textureGrad( tRoughF, vec3( vAUv, bL ), bGx, bGy ).a );
	bUv -= clamp( vTView.xy / max( vTView.z, 1e-3 ), - 2.5, 2.5 ) * vRecess * bOpen;
#endif
	vec3 aUv = vec3( bUv, bL );
	vec4 aAlbedo, aRough;
	if ( bFac ) { aAlbedo = textureGrad( tAlbedoF, aUv, bGx, bGy ); aRough = textureGrad( tRoughF, aUv, bGx, bGy ); }
	else { aAlbedo = textureGrad( tAlbedoS, aUv, bGx, bGy ); aRough = textureGrad( tRoughS, aUv, bGx, bGy ); }
	float bGlass = 0.0;
	vec3 bRoomE = vec3( 0.0 );
#ifdef BLD_PARALLAX
	aAlbedo.rgb *= 1.0 - 0.5 * bOpen * smoothstep( 0.3, 0.7, aRough.a );
#ifdef BLD_INTERIOR
	if ( vRoomB.x > 0.0 ) {
		bGlass = ( 1.0 - smoothstep( 0.17, 0.27, aRough.g ) ) * ( 1.0 - smoothstep( 0.3, 0.7, aRough.a ) ) * bOpen;
	}
	if ( bGlass > 0.001 ) {
		vec2 gm = bUv * vRoomA.xy;                       // texture metres (along the run, up the wall)
		vec2 cid = floor( gm / vRoomA.zw );
		vec2 f = gm - cid * vRoomA.zw;                   // position inside the room cell
		float bB = floor( vBid + 0.5 ); // (interpolated varying: round before hashing)
		float rh = bH3( vec3( cid + vec2( 0.5 ), bB * 1.371 + bL * 17.13 + 0.5 ) );
		float rh2 = fract( rh * 43.17 ), rh3 = fract( rh * 91.73 + 0.37 ), rh4 = fract( rh * 17.31 + 0.71 );
		vec3 wallC = bWallPaint( rh3 ), floorC = bFloorColor( rh4 );
		vec3 V = normalize( vTView );
		vec3 room;
		float blindF = rh > 0.52 ? ( rh - 0.52 ) / 0.48 : 0.0;
		float isBlind = step( 0.02, blindF ) * step( vRoomB.z - blindF * ( vRoomB.z - vRoomB.y ), f.y );
		if ( vTView.z < 420.0 && length( vTView ) < 420.0 ) {
			vec3 d = - V;
			d.z = min( d.z, - 0.03 );
			d.xy = sign( d.xy ) * max( abs( d.xy ), vec2( 1e-4 ) );
			vec3 o = vec3( f, 0.0 );
			vec3 t1 = ( vec3( 0.0, 0.0, - vRoomB.x ) - o ) / d, t2 = ( vec3( vRoomA.zw, 0.0 ) - o ) / d;
			vec3 tf = max( t1, t2 );
			float t = min( min( tf.x, tf.y ), tf.z );
			vec3 hp = o + d * t;
			float dk = clamp( - hp.z / vRoomB.x, 0.0, 1.0 );
			float shopKind = fract( rh * 5.71 );
			bool backW = t >= tf.z - 1e-4, sideW = !backW && t < tf.y - 1e-4;
			if ( vRoomB.x > 6.5 && hp.y > 0.2 && hp.y < 2.2 && ( ( backW && shopKind < 0.45 ) || ( sideW && shopKind < 0.22 ) ) ) {
				// shop with shelving: stocked in muted hashed colours, a few empty slots
				float sh = floor( ( hp.y - 0.2 ) / 0.4 ), along = backW ? hp.x : hp.z;
				float ph = bH3( vec3( sh, floor( along / 0.32 ), rh * 97.0 ) );
				vec3 goods = mix( vec3( 0.32 ), vec3( ph, fract( ph * 7.3 ), fract( ph * 3.1 ) ), 0.45 ) * ( 0.65 + 0.5 * fract( ph * 13.7 ) );
				float fy = fract( ( hp.y - 0.2 ) / 0.4 );
				room = fy < 0.08 ? vec3( 0.7 ) : ph < 0.14 || fy > 0.8 ? vec3( 0.1 ) : goods;
			} else if ( vRoomB.x > 6.5 && backW && hp.y < 1.05 && abs( hp.x - vRoomA.z * ( 0.35 + 0.3 * rh2 ) ) < vRoomA.z * 0.28 ) {
				room = mix( vec3( 0.18, 0.14, 0.11 ), vec3( 0.55, 0.52, 0.48 ), step( 0.5, rh4 ) ); // counter
			} else if ( backW ) {
				// back wall: furniture silhouette band, a picture / shelf
				room = wallC;
				float fx = abs( hp.x - vRoomA.z * ( 0.3 + 0.4 * rh2 ) );
				if ( hp.y < 0.75 + 0.35 * rh4 && fx < vRoomA.z * ( 0.18 + 0.2 * rh3 ) ) room = mix( floorC, vec3( 0.2 ), 0.4 + 0.3 * rh2 );
				else if ( hp.y > 1.4 && hp.y < 2.0 && abs( hp.x - vRoomA.z * ( 0.25 + 0.5 * rh4 ) ) < 0.35 && rh2 > 0.4 ) room = vec3( 0.35 + 0.4 * rh3, 0.3 + 0.3 * rh, 0.25 + 0.3 * rh4 );
			} else if ( t >= tf.y - 1e-4 ) {
				room = d.y < 0.0 ? floorC : vec3( 0.88, 0.87, 0.84 );
				// shop ceilings: rows of light panels
				if ( d.y > 0.0 && vRoomB.x > 6.5 ) room = fract( hp.x / 1.6 ) < 0.28 && fract( hp.z / 1.9 ) < 0.3 ? vec3( 2.2, 2.1, 1.9 ) : vec3( 0.55 );
			} else {
				room = wallC * 0.82;
			}
			room *= mix( 1.0, 0.55, dk );
		} else {
			room = mix( wallC, floorC, 0.45 ) * 0.75;
		}
		vec3 blindC = mix( vec3( 0.84, 0.82, 0.76 ), vec3( 0.42, 0.44, 0.47 ), step( 0.8, rh4 ) ) * ( 0.93 + 0.07 * step( 0.5, fract( f.y * 16.0 ) ) );
		// daylight: the room is dim behind the glass; the painted glass carries the sky reflection (Fresnel weighted)
		// (shops are lit during the day too: brighter, clearer glass)
		float shop = step( 6.5, vRoomB.x );
		float fres = mix( 0.3, 0.2, shop ) + mix( 0.7, 0.6, shop ) * pow( 1.0 - clamp( V.z, 0.0, 1.0 ), 4.0 );
		vec3 inside = mix( room * mix( 0.3, 0.42, shop ), blindC * 0.7, isBlind * ( 1.0 - shop ) );
		aAlbedo.rgb = mix( aAlbedo.rgb, mix( inside, aAlbedo.rgb, fres ), bGlass );
		// night: per-room light switch (building occupancy + room hash; shops mostly lit) and lamp colour
		float occ = shop > 0.5 ? 0.68 : 0.18 + 0.55 * fract( sin( bB * 12.9898 + 4.1 ) * 43758.5453 );
		float lit = max( step( rh2, occ ), shop * 0.14 ); // (closed shops keep a dim night light)
		vec3 lamp = rh3 < 0.55 ? vec3( 1.0, 0.72, 0.42 ) : rh3 < 0.85 ? vec3( 1.0, 0.86, 0.66 ) : rh3 < 0.95 ? vec3( 0.78, 0.86, 1.0 ) : vec3( 0.45, 0.55, 1.0 );
		bRoomE = lit * mix( lamp, vec3( 1.0, 0.88, 0.7 ), shop ) * mix( room * 0.72 + 0.04, blindC * 0.6, isBlind * ( 1.0 - shop ) ) * ( shop > 0.5 ? 0.24 : 1.0 );
	}
#endif
#endif
	diffuseColor *= aAlbedo;`)
        .replace('#include <color_fragment>', `
	float tintMask = smoothstep( 0.35, 0.75, aRough.r );
	diffuseColor.rgb *= mix( vec3( 1.0 ), vTint, tintMask );
	{
		// dirt splash + ambient occlusion at the foot of vertical faces, a little canyon darkening up to ~12 m
		float bVert = 1.0 - smoothstep( 0.4, 0.7, abs( vUp ) );
		float bH = vGY.x - vGY.y;
		float bAO = mix( 0.7, 1.0, smoothstep( 0.0, 1.4, bH ) ) * mix( 0.88, 1.0, smoothstep( 1.0, 14.0, bH ) );
		float bLum = dot( diffuseColor.rgb, vec3( 0.3, 0.55, 0.15 ) );
		vec3 bDusty = mix( diffuseColor.rgb, vec3( bLum ) * vec3( 1.02, 0.98, 0.92 ), 0.3 * ( 1.0 - smoothstep( 0.0, 1.0, bH ) ) );
		diffuseColor.rgb = mix( diffuseColor.rgb, bDusty * bAO, bVert * ( 1.0 - bGlass * 0.6 ) );
	}
	if ( ! bFac ) {
		float bUpF = smoothstep( 0.55, 0.9, vUp ) * tintMask;
		float bN = 0.6 * bNoise( vWPos.xz * 0.12 ) + 0.4 * bNoise( vWPos.xz * 0.035 + 17.0 );
		diffuseColor.rgb *= mix( 1.0, 0.8 + 0.4 * bN, bUpF );
	}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#if defined( BLD_PARALLAX ) && defined( BLD_RELIEF )
	if ( vKind > 0.5 ) {
		// analytic wall relief (mortar joints, clapboard laps, panel joints), faded out once a joint is sub-pixel
		vec2 m = bUv * vRoomA.xy;
		float fw = max( fwidth( m.x ), fwidth( m.y ) );
		float amt = tintMask * ( 1.0 - bOpen ) * ( 1.0 - smoothstep( 0.004, 0.014, fw ) );
		if ( amt > 0.01 ) {
			float dlt = 0.003;
			vec2 mL = fract( bUv ) * vRoomA.xy; // (the painted patterns restart on every tile)
			float h0 = bReliefH( mL, vKind, vRoomA.xy );
			vec2 grad = vec2( bReliefH( mL + vec2( dlt, 0.0 ), vKind, vRoomA.xy ) - h0, bReliefH( mL + vec2( 0.0, dlt ), vKind, vRoomA.xy ) - h0 ) / dlt;
			float depthM = vKind > 2.5 && vKind < 4.5 ? 0.02 : 0.009;
			vec3 nt = normalize( vec3( - grad * depthM * amt, 1.0 ) );
			vec3 nW = normal * mat3( viewMatrix );                     // view -> world (rotation part)
			vec3 tW = normalize( vec3( - nW.z, 0.0, nW.x ) + vec3( 1e-5 ) );
			vec3 tV = mat3( viewMatrix ) * tW, bV = mat3( viewMatrix ) * vec3( 0.0, 1.0, 0.0 );
			normal = normalize( tV * nt.x + bV * nt.y + normal * nt.z );
			// a touch of occlusion in the joints
			diffuseColor.rgb *= mix( 1.0, 0.82 + 0.18 * h0, amt );
		}
	}
#endif`)
        .replace('#include <roughnessmap_fragment>', '\tfloat roughnessFactor = roughness * max( aRough.g, 0.04 );')
        .replace('#include <metalnessmap_fragment>', '\tfloat metalnessFactor = metalness * aRough.b;')
        .replace('#include <emissivemap_fragment>', `
	vec3 bTexE;
	if ( bFac ) bTexE = textureGrad( tEmitF, aUv, bGx, bGy ).rgb; else bTexE = textureGrad( tEmitS, aUv, bGx, bGy ).rgb * 0.86;
	totalEmissiveRadiance *= mix( bTexE, bRoomE, bGlass );
	float hlS = 1.0 - step( 0.5, abs( vBid - uSelect ) );
	float hlH = 1.0 - step( 0.5, abs( vBid - uHover ) );
	float hl = max( hlS, hlH * 0.55 );
	diffuseColor.rgb = mix( diffuseColor.rgb, uHiColor, hl * 0.3 );
	totalEmissiveRadiance += uHiColor * hl * 0.22;`);
    };
    mat.customProgramCacheKey = () => `cmu-building-array-v4-${parallax ? roomA.length : 0}-${Object.keys(mat.defines).join(',')}`;
    M.registerNightMaterial(mat, nightIntensity);
    return mat;
  }

  let built = null;
  function build() {
    if (built) return built;
    const F = layers.facade, Sf = layers.surface;
    // per-layer room / reveal data for the facade shader
    const roomA = F.map((s) => new THREE.Vector4(s.tileW, s.tileH, s.room?.w || s.tileW, s.room?.h || s.tileH));
    // (w = reveal depth + 10 x relief code)
    const roomB = F.map((s) => new THREE.Vector4(s.room?.depth || 0, s.room?.bottom ?? 0.9, s.room?.top ?? 2.6, (s.recess || 0) + 10 * (s.relief || 0)));
    const tex = (list, sz) => ({ albedo: buildArray(list, sz.albedo, 'albedo'), emissive: buildArray(list, sz.emissive, 'emissive'), rough: buildArray(list, sz.rough, 'rough') });
    const all = arrayMaterial('buildings', tex(F, SZ.facade), tex(Sf, SZ.surface), 1.4, roomA, roomB);
    built = { all, facade: all, surface: all, layers: { facade: F.length, surface: Sf.length } };
    // release the painted pixels and the painting canvases (the texture arrays hold everything now)
    F.length = 0; Sf.length = 0;
    for (const e of pool.values()) { e.c.width = 0; e.c.height = 0; }
    pool.clear();
    return built;
  }

  return {
    uniforms,
    facade: facadeSlot,
    surface: surfaceSlot,
    flatRoof: flatRoofSlot,
    gravelRoof: gravelRoofSlot,
    copper: copperSlot,
    unit: unitSlot,
    unitTop: unitTopSlot,
    skylight: skylightSlot,
    trim: trimSlot,
    door: doorSlot,
    woodDoor: woodDoorSlot,
    house: houseSlot,
    storefront: storefrontSlot,
    storefrontVariants: SF_VARIANTS.length,
    awning: awningSlot,
    dormer: dormerSlot,
    parking: parkingSlot,
    build,
    get paintMs() { return paintMs; },
    slots: cache, // slot metadata only (key → { array, layer, tileW, tileH, ... }); pixels are freed by build()
    layers,
  };
}
