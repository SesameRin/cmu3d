// Extra canvas-painted materials for the north-campus landmarks. Everything is generated at runtime (no assets)
// and cached per context, so each material/texture exists once no matter how many meshes use it.
//
// UV convention (same as core/materials.js): metres. Walls: u = metres along the wall, v = metres above the
// building's reference floor level.
import * as THREE from 'three';
import { prng } from './north-kit.js';

const caches = new WeakMap();
function cacheFor(ctx) {
  let c = caches.get(ctx);
  if (!c) { c = new Map(); caches.set(ctx, c); }
  return c;
}
function memo(ctx, key, make) {
  const c = cacheFor(ctx);
  if (!c.has(key)) c.set(key, make());
  return c.get(key);
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
// release: drop the canvas backing store once three.js has uploaded it (for textures that are never repainted).
function texture(ctx, cnv, { tileW = 1, tileH = 1, srgb = true, wrap = THREE.RepeatWrapping, release = false } = {}) {
  const t = new THREE.CanvasTexture(cnv);
  if (release) t.onUpdate = () => { t.onUpdate = null; cnv.width = cnv.height = 1; };
  t.wrapS = t.wrapT = wrap;
  t.repeat.set(1 / tileW, 1 / tileH);
  const maxAniso = ctx.renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;
  t.anisotropy = Math.min(8, maxAniso);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
function hsl(hex, dl = 0, ds = 0) {
  const c = new THREE.Color(hex), o = {};
  c.getHSL(o);
  c.setHSL(o.h, Math.max(0, Math.min(1, o.s + ds)), Math.max(0, Math.min(1, o.l + dl)));
  return `#${c.getHexString()}`;
}
function night(ctx, mat, k) {
  if (ctx.materials?.registerNightMaterial) ctx.materials.registerNightMaterial(mat, k);
  return mat;
}

// ------------------------------------------------------------------ zinc diamond shingles (Gates-Hillman)
// "Black" pre-weathered zinc laid as small diamonds, 0.5 m module. Colour + bump + roughness maps.
export function zincShingles(ctx, { color = '#45494e', tileM = 4, seed = 3, metalness = 0.5, roughness = 0.52 } = {}) {
  return memo(ctx, `zinc:${color}:${tileM}:${seed}`, () => {
    const PX = 512, ppm = PX / tileM, r = prng(seed);
    const cm = canvas(PX, PX), g = cm.getContext('2d');
    const cb = canvas(PX, PX), gb = cb.getContext('2d');
    const cr = canvas(PX, PX), gr = cr.getContext('2d');
    g.fillStyle = hsl(color, -0.06); g.fillRect(0, 0, PX, PX);
    gb.fillStyle = '#404040'; gb.fillRect(0, 0, PX, PX);
    gr.fillStyle = '#909090'; gr.fillRect(0, 0, PX, PX);
    const dw = 0.5 * ppm, dh = 0.5 * ppm; // diamond module
    const diamond = (G, cx, cy, s) => {
      G.beginPath();
      G.moveTo(cx, cy - dh / 2 * s); G.lineTo(cx + dw / 2 * s, cy); G.lineTo(cx, cy + dh / 2 * s); G.lineTo(cx - dw / 2 * s, cy);
      G.closePath();
    };
    for (let row = -1; row <= PX / (dh / 2) + 1; row++) {
      for (let col = -1; col <= PX / dw + 1; col++) {
        const cx = col * dw + (row % 2 ? dw / 2 : 0), cy = row * dh / 2;
        const tone = (r() - 0.5) * 0.04;
        // colour: slight per-shingle variation, lighter upper half (overlap catches light)
        const grd = g.createLinearGradient(cx, cy - dh / 2, cx, cy + dh / 2);
        grd.addColorStop(0, hsl(color, tone + 0.035));
        grd.addColorStop(0.55, hsl(color, tone));
        grd.addColorStop(1, hsl(color, tone - 0.035));
        diamond(g, cx, cy, 0.965); g.fillStyle = grd; g.fill();
        // bump: raised shingle, lower edge thicker (lapped)
        const gg = gb.createLinearGradient(cx, cy - dh / 2, cx, cy + dh / 2);
        gg.addColorStop(0, '#7a7a7a'); gg.addColorStop(0.8, '#c8c8c8'); gg.addColorStop(1, '#e0e0e0');
        diamond(gb, cx, cy, 0.95); gb.fillStyle = gg; gb.fill();
        const rv = 120 + ((r() * 60) | 0);
        diamond(gr, cx, cy, 0.95); gr.fillStyle = `rgb(${rv},${rv},${rv})`; gr.fill();
      }
    }
    // faint streaks of weathering
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${0.025 * r()})`;
      g.fillRect(r() * PX, 0, 1 + r() * 4, PX);
    }
    const map = texture(ctx, cm, { tileW: tileM, tileH: tileM });
    const bumpMap = texture(ctx, cb, { tileW: tileM, tileH: tileM, srgb: false });
    const roughnessMap = texture(ctx, cr, { tileW: tileM, tileH: tileM, srgb: false });
    const m = new THREE.MeshStandardMaterial({ map, bumpMap, bumpScale: 0.6, roughnessMap, roughness: roughness * 1.6, metalness, envMapIntensity: 0.9 });
    m.name = 'north-zinc-shingle';
    return m;
  });
}

// Flat zinc / aluminium rainscreen panels with joints (Cohon addition, soffits, Tepper fins).
export function metalPanels(ctx, { color = '#8d949b', panelW = 1.2, panelH = 0.6, tileM = 4.8, metalness = 0.6, roughness = 0.42, seed = 5, joint = '#00000055' } = {}) {
  return memo(ctx, `panels:${color}:${panelW}:${panelH}:${tileM}`, () => {
    const PX = 512, ppm = PX / tileM, r = prng(seed);
    const cm = canvas(PX, PX), g = cm.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, PX, PX);
    const pw = panelW * ppm, ph = panelH * ppm;
    for (let y = 0, row = 0; y < PX; y += ph, row++) {
      for (let x = (row % 2) * pw * 0.5 - pw; x < PX; x += pw) {
        g.fillStyle = hsl(color, (r() - 0.5) * 0.05);
        g.fillRect(x + 1, y + 1, pw - 2, ph - 2);
      }
    }
    g.strokeStyle = joint; g.lineWidth = 2;
    for (let y = 0; y <= PX; y += ph) { g.beginPath(); g.moveTo(0, y); g.lineTo(PX, y); g.stroke(); }
    const map = texture(ctx, cm, { tileW: tileM, tileH: tileM });
    const m = new THREE.MeshStandardMaterial({ map, metalness, roughness, envMapIntensity: 1.0 });
    m.name = 'north-metal-panels';
    return m;
  });
}

// ------------------------------------------------------------------ window glass with per-window night lighting
// The texture is an 8x8 atlas of "window cells". Each window's UVs cover one cell (see cellUV) so windows light up
// individually at night while all glass shares one material.
export const GLASS_CELLS = 8;
// Paints the 8x8 window-cell atlas (PX x PX) into g (colour) and ge (night light; mono = white mask for the
// glazing array, otherwise warm colours).
function paintCells(g, ge, PX, { tint, lit, seed }, mono = false) {
  const N = GLASS_CELLS, S = PX / N, r = prng(seed);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, PX, PX);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i * S, y = j * S;
    const grd = g.createLinearGradient(x, y, x + S * 0.4, y + S);
    grd.addColorStop(0, hsl(tint, 0.14)); grd.addColorStop(0.5, tint); grd.addColorStop(1, hsl(tint, -0.08));
    g.fillStyle = grd; g.fillRect(x, y, S, S);
    const k = r();
    if (k < 0.3) { g.fillStyle = 'rgba(225,220,205,0.45)'; g.fillRect(x, y, S, S * (0.2 + r() * 0.5)); } // blinds
    else if (k < 0.5) { g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x, y + S * 0.12, S, Math.max(2, S / 16)); } // ceiling light line
    if (r() < lit) {
      const w = 170 + ((r() * 70) | 0);
      const a = 0.55 + r() * 0.45;
      if (mono) { const m = Math.round(255 * a * (0.8 + 0.2 * (w - 170) / 70)); ge.fillStyle = `rgb(${m},${m},${m})`; }
      else { ge.fillStyle = `rgb(255,${w},${(w * 0.62) | 0})`; ge.globalAlpha = a; }
      ge.fillRect(x, y, S, S);
      ge.globalAlpha = 1;
    } else if (r() < 0.25) { // dim screen glow / corridor light
      ge.fillStyle = mono ? 'rgb(64,64,64)' : 'rgb(90,110,150)'; ge.fillRect(x, y, S, S);
    }
  }
}
export function windowGlass(ctx, { tint = '#34424c', lit = 0.5, seed = 11, name = 'glass', reflect = 1.3 } = {}) {
  return memo(ctx, `wglass:${tint}:${lit}:${seed}`, () => {
    const PX = GLASS_CELLS * 32;
    const cm = canvas(PX, PX), g = cm.getContext('2d');
    const ce = canvas(PX, PX), ge = ce.getContext('2d');
    paintCells(g, ge, PX, { tint, lit, seed });
    const map = texture(ctx, cm, { wrap: THREE.ClampToEdgeWrapping });
    const emissiveMap = texture(ctx, ce, { wrap: THREE.ClampToEdgeWrapping });
    const m = new THREE.MeshStandardMaterial({
      map, emissiveMap, emissive: new THREE.Color('#ffe2b8'), emissiveIntensity: 0,
      metalness: 0.55, roughness: 0.08, envMapIntensity: reflect,
    });
    m.name = `north-${name}`;
    night(ctx, m, 1.6);
    return m;
  });
}
// UVs covering one random atlas cell: returns [u0,v0,u1,v1]
export function cellUV(rand) {
  const N = GLASS_CELLS, i = (rand() * N) | 0, j = (rand() * N) | 0, m = 0.12;
  return [(i + m) / N, (j + m) / N, (i + 1 - m) / N, (j + 1 - m) / N];
}

// ------------------------------------------------------------------ brick facade (Tepper roman brick, Cohon buff brick)
// A facade texture with a colour-blended brick field and a regular grid of windows. One tile = bays x floors.
// o: { colors[], brickW, brickH, joint, mortar, bay, floor, bays, floors, winW, winH, sill, frame, glass, lit,
//      pairs (two windows per bay), band (stone/metal band colour at slab level), bandH, seed, arched }
export function brickFacade(ctx, opts = {}) {
  const o = {
    colors: ['#d4b27a', '#c49a5c', '#e0c48e', '#b98c50'], weights: null, brickW: 0.29, brickH: 0.07, joint: 0.011, mortar: '#cdbf9f',
    bay: 3.2, floor: 4.2, bays: 4, floors: 3, winW: 1.4, winH: 2.3, sill: 0.9, frame: '#3b3f44', glass: '#3f5564',
    lit: 0.45, band: null, bandH: 0.3, seed: 7, arched: false, none: false, reveal: 0.12, ...opts,
  };
  return memo(ctx, `brickfac:${JSON.stringify(o)}`, () => {
    const tileW = o.bay * o.bays, tileH = o.floor * o.floors;
    const ppm = Math.min(o.ppm || 64, 1024 / tileW, 1024 / tileH);
    const W = Math.round(tileW * ppm), H = Math.round(tileH * ppm), r = prng(o.seed);
    const cm = canvas(W, H), g = cm.getContext('2d');
    const ce = canvas(W, H), ge = ce.getContext('2d');
    const cr = canvas(W, H), gr = cr.getContext('2d');
    ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
    gr.fillStyle = '#e8e8e8'; gr.fillRect(0, 0, W, H);
    // bricks
    g.fillStyle = o.mortar; g.fillRect(0, 0, W, H);
    const bw = o.brickW * ppm, bh = o.brickH * ppm, j = Math.max(1, o.joint * ppm);
    const pick = () => {
      if (!o.weights) return o.colors[(r() * o.colors.length) | 0];
      let t = r() * o.weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < o.colors.length; i++) { t -= o.weights[i]; if (t <= 0) return o.colors[i]; }
      return o.colors[0];
    };
    for (let row = 0, y = 0; y < H + bh; row++, y += bh + j) {
      const off = (row % 2) * (bw + j) / 2;
      for (let x = -off; x < W; x += bw + j) {
        g.fillStyle = hsl(pick(), (r() - 0.5) * 0.06);
        g.fillRect(x, H - y - bh, bw, bh); // rows counted from the bottom so v=0 starts on a course
      }
    }
    // subtle large-scale mottling
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(${r() > 0.5 ? '255,240,210' : '60,40,20'},${0.03 * r()})`;
      g.fillRect(r() * W, r() * H, 20 + r() * 80, 20 + r() * 80);
    }
    const fr = Math.max(2, 0.06 * ppm);
    for (let f = 0; f < o.floors; f++) {
      const yFloor = H - f * o.floor * ppm; // canvas y of this storey's floor line
      if (o.band) { g.fillStyle = o.band; g.fillRect(0, yFloor - o.bandH * ppm, W, o.bandH * ppm); }
      if (o.none) continue;
      for (let b = 0; b < o.bays; b++) {
        const n = o.pairs ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const cx = (b + (n === 1 ? 0.5 : (k === 0 ? 0.28 : 0.72))) * o.bay * ppm;
          const ww = o.winW * ppm, wh = o.winH * ppm;
          const x = cx - ww / 2, y = yFloor - (o.sill + o.winH) * ppm;
          // reveal shadow (deep brick reveals), heavier at the top/left (sun from above)
          g.fillStyle = 'rgba(20,14,8,0.55)';
          g.fillRect(x - fr, y - fr, ww + fr * 2, wh + fr * 2);
          g.save();
          if (o.arched) {
            g.beginPath(); g.moveTo(x, y + wh); g.lineTo(x, y + ww / 2); g.arc(cx, y + ww / 2, ww / 2, Math.PI, 0); g.lineTo(x + ww, y + wh); g.closePath(); g.clip();
          }
          g.fillStyle = o.frame; g.fillRect(x, y, ww, wh);
          const gx = x + fr, gy = y + fr, gw = ww - fr * 2, gh = wh - fr * 2;
          const grd = g.createLinearGradient(gx, gy, gx + gw * 0.4, gy + gh);
          grd.addColorStop(0, hsl(o.glass, 0.18)); grd.addColorStop(0.5, o.glass); grd.addColorStop(1, hsl(o.glass, -0.1));
          g.fillStyle = grd; g.fillRect(gx, gy, gw, gh);
          if (r() < 0.3) { g.fillStyle = 'rgba(230,222,205,0.4)'; g.fillRect(gx, gy, gw, gh * (0.15 + r() * 0.4)); }
          // inner reveal shadow on the glass (depth)
          g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(gx, gy, gw, o.reveal * ppm); g.fillRect(gx, gy, o.reveal * ppm * 0.6, gh);
          g.fillStyle = o.frame;
          g.fillRect(cx - fr / 2, y, fr, wh);
          if (o.winH > 1.8) g.fillRect(x, y + wh * 0.72, ww, fr * 0.8);
          g.restore();
          // stone/metal sill
          g.fillStyle = hsl(o.mortar, 0.05); g.fillRect(x - fr, y + wh, ww + fr * 2, Math.max(2, 0.07 * ppm));
          gr.fillStyle = '#1e1e1e'; gr.fillRect(x, y, ww, wh);
          if (r() < o.lit) {
            const w = 175 + ((r() * 60) | 0);
            ge.fillStyle = `rgba(255,${w + 15},${w - 45},${0.6 + r() * 0.4})`;
            ge.fillRect(gx, gy, gw, gh);
          }
        }
      }
    }
    const map = texture(ctx, cm, { tileW, tileH });
    if (o.none) { // plain masonry: colour map only, no night emission
      const m = new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0.0 });
      m.name = 'north-brick';
      return m;
    }
    const emissiveMap = texture(ctx, ce, { tileW, tileH });
    const roughnessMap = texture(ctx, cr, { tileW, tileH, srgb: false });
    const m = new THREE.MeshStandardMaterial({
      map, emissiveMap, roughnessMap, roughness: 1, metalness: 0.02,
      emissive: new THREE.Color('#ffcf8a'), emissiveIntensity: 0,
    });
    m.name = 'north-brick-facade';
    night(ctx, m, 1.4);
    return m;
  });
}

// Plain brick (no windows) using the same blend, for parapets, piers and blank walls.
// Higher texel density than the windowed facade (it is seen up close on piers, reveals and blank walls).
// The tile is a whole number of brick modules (and an even number of courses) so it repeats without seams.
export function brickPlain(ctx, opts = {}) {
  const bw = opts.brickW ?? 0.29, bh = opts.brickH ?? 0.07, j = opts.joint ?? 0.011;
  const bay = Math.max(1, Math.round(2.1 / (bw + j))) * (bw + j);
  const floor = 2 * Math.max(1, Math.round(1.2 / (bh + j))) * (bh + j);
  return brickFacade(ctx, { ...opts, none: true, bays: 2, floors: 1, bay, floor, lit: 0, ppm: 160 });
}

// Paints one curtain-wall tile (cols x rows glass cells) into g (colour) / ge (night light) at W x H px.
// fw = mullion width in px, spandrelPx = opaque band at the bottom of each row. mono → white mask instead of colour.
function paintCurtain(g, ge, W, H, { glass, frame, cols, rows, lit, seed, fritTop = false, spandrelColor = null }, fw, spandrelPx, mono = false) {
  const r = prng(seed);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  const grd = g.createLinearGradient(0, 0, W * 0.3, H);
  grd.addColorStop(0, hsl(glass, 0.12)); grd.addColorStop(0.5, glass); grd.addColorStop(1, hsl(glass, -0.07));
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  const cw = W / cols, rh = H / rows;
  for (let row = 0; row < rows; row++) {
    const y0 = H - (row + 1) * rh;
    if (spandrelPx > 0) { // opaque spandrel band at slab level
      g.fillStyle = spandrelColor || hsl(glass, -0.12); g.fillRect(0, y0 + rh - spandrelPx, W, spandrelPx);
    }
    for (let c = 0; c < cols; c++) {
      if (r() < 0.25) { g.fillStyle = 'rgba(225,220,205,0.35)'; g.fillRect(c * cw, y0, cw, rh * (0.15 + r() * 0.35)); }
      if (fritTop) { g.fillStyle = 'rgba(235,235,230,0.22)'; for (let k = 0; k < 6; k++) g.fillRect(c * cw, y0 + k * 3 * fw, cw, fw); }
      if (r() < lit) {
        const w = 180 + ((r() * 60) | 0), a = 0.55 + r() * 0.45;
        if (mono) { const m = Math.round(255 * a * (0.8 + 0.2 * (w - 180) / 60)); ge.fillStyle = `rgb(${m},${m},${m})`; }
        else ge.fillStyle = `rgba(255,${w + 15},${w - 40},${a})`;
        ge.fillRect(c * cw + fw, y0 + fw, cw - 2 * fw, rh - 2 * fw - spandrelPx);
      }
    }
  }
  g.fillStyle = frame;
  for (let c = 0; c <= cols; c++) g.fillRect(c * cw - fw / 2, 0, fw, H);
  for (let row = 0; row <= rows; row++) g.fillRect(0, H - row * rh - fw, W, fw * 2);
}

// Curtain wall: glass with mullion grid (vertical module mw, horizontal module mh). Night-lit by floor.
// (Stand-alone material; the landmarks use the shared glazing array below — see glz().)
export function curtainWall(ctx, { glass = '#3d5566', frame = '#9aa1a8', mw = 1.5, mh = 4.2, cols = 8, rows = 3, lit = 0.55, seed = 21, fritTop = false, spandrel = 0 } = {}) {
  return memo(ctx, `curtain:${glass}:${frame}:${mw}:${mh}:${lit}:${seed}:${fritTop}:${spandrel}`, () => {
    const tileW = mw * cols, tileH = mh * rows;
    const ppm = Math.min(32, 1024 / tileW, 1024 / tileH);
    const W = Math.round(tileW * ppm), H = Math.round(tileH * ppm);
    const cm = canvas(W, H), g = cm.getContext('2d');
    const ce = canvas(W, H), ge = ce.getContext('2d');
    paintCurtain(g, ge, W, H, { glass, frame, cols, rows, lit, seed, fritTop }, Math.max(2, 0.07 * ppm), spandrel * ppm);
    const map = texture(ctx, cm, { tileW, tileH });
    const emissiveMap = texture(ctx, ce, { tileW, tileH });
    const m = new THREE.MeshStandardMaterial({
      map, emissiveMap, roughness: 0.14, metalness: 0.45, envMapIntensity: 1.3,
      emissive: new THREE.Color('#ffe0b0'), emissiveIntensity: 0,
    });
    m.name = 'north-curtain';
    night(ctx, m, 1.5);
    return m;
  });
}

// ------------------------------------------------------------------ shared glazing texture array
// Every glass surface of the north landmarks (curtain walls, skylights, doors, punched-window glass) plus the small
// emissive lamp strips and dark openings share ONE material: a DataArrayTexture with one layer per pattern below.
// Geometry carries a per-vertex `glayer` attribute and UVs normalised to the pattern's tile (MeshKit.build does this
// for buckets whose material is a glz() descriptor), so all of a landmark's glazing is a single mesh / draw call.
// Albedo in RGB, night-light mask in A; roughness / metalness / night colour per layer via uniform arrays.
// Curtain patterns are unit-less (cols x rows cells); the caller gives the mullion module in metres (glz(mw, mh)).
const GLAZING = {
  gatesCurtain: { kind: 'curtain', glass: '#40596a', frame: '#a9b0b6', cols: 8, rows: 3, lit: 0.6, seed: 21, spandrel: 0.16 },
  gatesEntry: { kind: 'curtain', glass: '#4a6576', frame: '#c9ced2', cols: 4, rows: 1, lit: 1, seed: 5 },
  lightCurtain: { kind: 'curtain', glass: '#4d6778', frame: '#c5cacd', cols: 8, rows: 3, lit: 0.78, seed: 52, spandrel: 0.11 },
  door: { kind: 'curtain', glass: '#3d5363', frame: '#b8bec3', cols: 4, rows: 1, lit: 1, seed: 36 },
  skylight: { kind: 'curtain', glass: '#62808f', frame: '#cbd0d3', cols: 8, rows: 8, lit: 0.9, seed: 31 },
  darkCurtain: { kind: 'curtain', glass: '#3b4f5c', frame: '#30343a', cols: 8, rows: 3, lit: 0.55, seed: 33, spandrel: 0.35 },
  forbesGlass: { kind: 'curtain', glass: '#4a6272', frame: '#3a3f45', cols: 6, rows: 3, lit: 0.75, seed: 34 },
  tepperBase: { kind: 'curtain', glass: '#47606f', frame: '#3b3f44', cols: 6, rows: 3, lit: 0.9, seed: 41 },
  tepperCourt: { kind: 'curtain', glass: '#4e6878', frame: '#9ca4aa', cols: 6, rows: 3, lit: 0.85, seed: 42, fritTop: true },
  tepperVoid: { kind: 'curtain', glass: '#557081', frame: '#c9ced2', cols: 8, rows: 3, lit: 0.7, seed: 43, fritTop: true },
  oriel: { kind: 'curtain', glass: '#4f646c', frame: '#34413e', cols: 3, rows: 8, lit: 0.7, seed: 37 },  // Cohon glass bays
  // round 3: Warner Hall bronze window wall (dark bronze glass over greige spandrels), the Cohon 2016 atrium wall
  // (dark mullions), the black fitness box and the Cyert Hall ribbon windows
  warnerGrid: { kind: 'curtain', glass: '#2c2925', frame: '#6a5846', cols: 6, rows: 2, lit: 0.5, seed: 61, spandrel: 0.42, spandrelColor: '#766d62' },
  cucAtrium: { kind: 'curtain', glass: '#58727e', frame: '#2f3337', cols: 4, rows: 2, lit: 0.85, seed: 63 },
  blackBox: { kind: 'curtain', glass: '#394953', frame: '#1b1d20', cols: 3, rows: 3, lit: 0.75, seed: 64 },
  cyRibbon: { kind: 'curtain', glass: '#2e383f', frame: '#2b2724', cols: 5, rows: 1, lit: 0.55, seed: 65 },
  winGates: { kind: 'cells', tint: '#2f3d47', lit: 0.5, seed: 11 },
  winBuff: { kind: 'cells', tint: '#3e5161', lit: 0.5, seed: 23 },
  winTepper: { kind: 'cells', tint: '#34444f', lit: 0.55, seed: 29 },
  lamp: { kind: 'solid', color: '#d9d6cf', rough: 0.4, metal: 0, emit: '#fff1d6', k: 3 },
  dark: { kind: 'solid', color: '#1b1d1f', rough: 0.9, metal: 0 },
};
const emitCol = (a, b, k) => { const c = new THREE.Color(a).multiply(new THREE.Color(b)).multiplyScalar(k); return new THREE.Vector3(c.r, c.g, c.b); };

export function glazing(ctx) {
  return memo(ctx, 'glazing', () => {
    const names = Object.keys(GLAZING), n = names.length;
    // 384 px per layer: ≥ the texel density of the former per-material textures (32 px/m curtain walls, 32 px cells)
    const S = ctx.quality?.level === 'low' ? 256 : 384;
    const data = new Uint8Array(S * S * 4 * n);
    const cm = canvas(S, S), g = cm.getContext('2d', { willReadFrequently: true });
    const ce = canvas(S, S), ge = ce.getContext('2d', { willReadFrequently: true });
    const rough = [], metal = [], emit = [];
    names.forEach((name, li) => {
      const p = GLAZING[name];
      if (p.kind === 'curtain') {
        paintCurtain(g, ge, S, S, p, Math.max(2, 0.045 * S / p.cols), (p.spandrel || 0) * S / p.rows, true);
        rough.push(0.14); metal.push(0.45); emit.push(emitCol('#ffe0b0', '#ffe6ad', 1.5));
      } else if (p.kind === 'cells') {
        paintCells(g, ge, S, p, true);
        rough.push(0.08); metal.push(0.55); emit.push(emitCol('#ffe2b8', '#ffcd7f', 1.6));
      } else {
        g.fillStyle = p.color; g.fillRect(0, 0, S, S);
        ge.fillStyle = p.emit ? '#fff' : '#000'; ge.fillRect(0, 0, S, S);
        rough.push(p.rough); metal.push(p.metal); emit.push(p.emit ? emitCol(p.emit, '#ffffff', p.k) : new THREE.Vector3());
      }
      const a = g.getImageData(0, 0, S, S).data, e = ge.getImageData(0, 0, S, S).data;
      // DataArrayTexture rows start at v = 0 (bottom), canvas rows at the top → flip while packing
      const base = li * S * S * 4, rowB = S * 4;
      for (let y = 0; y < S; y++) {
        const src = (S - 1 - y) * rowB, dst = base + y * rowB;
        data.set(a.subarray(src, src + rowB), dst);                              // RGB (+ opaque A)
        for (let x = 3; x < rowB; x += 4) data[dst + x] = e[src + x - 3];         // A = night-light mask
      }
    });
    const tex = new THREE.DataArrayTexture(data, S, S, n);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.min(8, ctx.renderer?.capabilities?.getMaxAnisotropy?.() ?? 4);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff', roughness: 1, metalness: 1, envMapIntensity: 1.3,
      emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0,
    });
    mat.name = 'north-glazing';
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.tGlz = { value: tex };
      sh.uniforms.uGRough = { value: rough };
      sh.uniforms.uGMetal = { value: metal };
      sh.uniforms.uGEmit = { value: emit };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float glayer;\nvarying float vGLayer;\nvarying vec2 vGUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvGLayer = glayer;\n\tvGUv = uv;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2DArray tGlz;
uniform float uGRough[${n}];
uniform float uGMetal[${n}];
uniform vec3 uGEmit[${n}];
varying float vGLayer;
varying vec2 vGUv;`)
        .replace('#include <map_fragment>', `
	int gLi = int( vGLayer + 0.5 );
	vec4 gTex = texture( tGlz, vec3( vGUv, float( gLi ) ) );
	diffuseColor.rgb *= gTex.rgb;`)
        .replace('#include <roughnessmap_fragment>', '\tfloat roughnessFactor = uGRough[ gLi ];')
        .replace('#include <metalnessmap_fragment>', '\tfloat metalnessFactor = uGMetal[ gLi ];')
        .replace('#include <emissivemap_fragment>', '\ttotalEmissiveRadiance *= gTex.a * uGEmit[ gLi ];');
    };
    mat.customProgramCacheKey = () => `north-glazing-v1-${n}`;
    night(ctx, mat, 1);
    return { material: mat, texture: tex, index: Object.fromEntries(names.map((k, i) => [k, i])) };
  });
}
// Material descriptor for MeshKit.build: glazing layer `name`; for curtain patterns (mw, mh) = mullion module in metres.
export function glz(ctx, name, mw = 1.5, mh = 4) {
  const G = glazing(ctx);
  let p = GLAZING[name];
  if (!p) { console.warn(`[north] unknown glazing layer "${name}"`); name = 'dark'; p = GLAZING.dark; }
  const curtain = p.kind === 'curtain';
  return { isGlazing: true, material: G.material, layer: G.index[name], tileW: curtain ? mw * p.cols : 1, tileH: curtain ? mh * p.rows : 1 };
}

// ------------------------------------------------------------------ standing-seam metal (pitched roofs, eaves)
// Seams run along v (up the slope with the kit's roof UVs; vertical on walls).
export function seamMetal(ctx, { color = '#50555b', seam = 0.5, tileM = 4, seed = 9, metalness = 0.5, roughness = 0.5 } = {}) {
  return memo(ctx, `seam:${color}:${seam}:${tileM}:${metalness}:${roughness}`, () => {
    const PX = 256, ppm = PX / tileM, r = prng(seed), s = seam * ppm;
    const c = canvas(PX, PX), g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, PX, PX);
    for (let x = 0; x < PX; x += s) { g.fillStyle = hsl(color, (r() - 0.5) * 0.03); g.fillRect(x, 0, s, PX); }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${0.03 * r()})`; g.fillRect(r() * PX, 0, 1 + r() * 3, PX); }
    for (let x = 0; x < PX; x += s) { g.fillStyle = hsl(color, 0.12); g.fillRect(x, 0, 2, PX); g.fillStyle = hsl(color, -0.1); g.fillRect(x + 2, 0, 1, PX); }
    const map = texture(ctx, c, { tileW: tileM, tileH: tileM });
    const m = new THREE.MeshStandardMaterial({ map, metalness, roughness, envMapIntensity: 0.9 });
    m.name = 'north-seam-metal';
    return m;
  });
}

// ------------------------------------------------------------------ green (sedum) roof
export function greenRoof(ctx) {
  return memo(ctx, 'greenroof', () => {
    const PX = 256, r = prng(41), tileM = 6;
    const c = canvas(PX, PX), g = c.getContext('2d');
    g.fillStyle = '#5d7440'; g.fillRect(0, 0, PX, PX);
    const cols = ['#6f8a45', '#4f6a35', '#8a8f4a', '#7c6b45', '#5f8250', '#9a7a52'];
    for (let i = 0; i < 900; i++) {
      g.fillStyle = cols[(r() * cols.length) | 0];
      g.globalAlpha = 0.35 + r() * 0.5;
      g.beginPath(); g.arc(r() * PX, r() * PX, 2 + r() * 7, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    const map = texture(ctx, c, { tileW: tileM, tileH: tileM });
    const m = new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0 });
    m.name = 'north-green-roof';
    return m;
  });
}

// ------------------------------------------------------------------ Pausch Bridge railing panels
// Aluminium panels with abstract penguin cut-outs (alpha tested). Tile = 2 m panel x 1.2 m high.
// The emissive map is a colour gradient that the bridge animates at night (the LED light show).
export function penguinPanels(ctx) {
  return memo(ctx, 'penguins', () => {
    const PW = 2.0, PH = 1.2, ppm = 128, W = PW * ppm, H = Math.round(PH * ppm), r = prng(77);
    const cm = canvas(W, H), g = cm.getContext('2d');
    const ca = canvas(W, H), ga = ca.getContext('2d');
    // brushed aluminium
    g.fillStyle = '#c4c9ce'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(${r() > 0.5 ? 255 : 90},${r() > 0.5 ? 255 : 95},${r() > 0.5 ? 255 : 100},0.05)`; g.fillRect(0, r() * H, W, 1); }
    g.strokeStyle = '#8a9096'; g.lineWidth = 4; g.strokeRect(2, 2, W - 4, H - 4);
    ga.fillStyle = '#fff'; ga.fillRect(0, 0, W, H);
    // abstract penguins: body ellipse, head, beak, flipper; varied size / lean
    ga.fillStyle = '#000';
    const penguin = (x, y, s, lean) => {
      ga.save(); ga.translate(x, y); ga.rotate(lean); ga.scale(s, s);
      ga.beginPath(); ga.ellipse(0, 0, 11, 22, 0, 0, Math.PI * 2); ga.fill();            // body
      ga.beginPath(); ga.arc(1, -27, 8, 0, Math.PI * 2); ga.fill();                        // head
      ga.beginPath(); ga.moveTo(7, -29); ga.lineTo(16, -26); ga.lineTo(7, -24); ga.fill(); // beak
      ga.beginPath(); ga.ellipse(-11, -2, 4, 13, 0.35, 0, Math.PI * 2); ga.fill();         // flipper
      ga.beginPath(); ga.ellipse(-4, 23, 6, 2.5, 0, 0, Math.PI * 2); ga.ellipse(5, 23, 6, 2.5, 0, 0, Math.PI * 2); ga.fill(); // feet
      ga.restore();
    };
    const spots = [[0.19, 0.56, 1.85, -0.08], [0.5, 0.52, 1.5, 0.16], [0.8, 0.57, 1.75, -0.22]];
    for (const [fx, fy, s, l] of spots) penguin(fx * W, fy * H, s * (0.9 + r() * 0.2), l);
    // a few abstract ice-floe slots
    for (let i = 0; i < 4; i++) { ga.fillRect(r() * W, H * (0.1 + r() * 0.05), 20 + r() * 60, 5); }
    // keep the frame solid
    ga.fillStyle = '#fff'; ga.fillRect(0, 0, W, 8); ga.fillRect(0, H - 8, W, 8); ga.fillRect(0, 0, 8, H); ga.fillRect(W - 8, 0, 8, H);
    const map = texture(ctx, cm, { tileW: PW, tileH: PH });
    const alphaMap = texture(ctx, ca, { tileW: PW, tileH: PH, srgb: false });
    const emissiveMap = rainbowTexture(ctx);
    const m = new THREE.MeshStandardMaterial({
      map, alphaMap, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.38,
      emissive: new THREE.Color('#ffffff'), emissiveMap, emissiveIntensity: 0,
    });
    m.name = 'north-penguin-panels';
    night(ctx, m, 0.9);
    return m;
  });
}

// Horizontal hue gradient used by the Pausch bridge LEDs. u is metres along the bridge (repeats every 34 m).
export function rainbowTexture(ctx) {
  return memo(ctx, 'rainbow', () => {
    const W = 256, c = canvas(W, 4), g = c.getContext('2d');
    // Pausch show palette: deep blue, penguin cyan, crayon colours, sunset orange, magenta
    const stops = ['#1d3cff', '#18c6ff', '#38ff9a', '#fff23a', '#ff8a1c', '#ff2d6f', '#b02cff', '#1d3cff'];
    const grd = g.createLinearGradient(0, 0, W, 0);
    stops.forEach((s, i) => grd.addColorStop(i / (stops.length - 1), s));
    g.fillStyle = grd; g.fillRect(0, 0, W, 4);
    const t = texture(ctx, c, { tileW: 34, tileH: 1 });
    t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

// LED strip: emissive rainbow line (shares the animated gradient).
export function ledStrip(ctx) {
  return memo(ctx, 'ledstrip', () => {
    const m = new THREE.MeshStandardMaterial({
      color: '#d8dde2', roughness: 0.3, metalness: 0.2,
      emissive: new THREE.Color('#ffffff'), emissiveMap: rainbowTexture(ctx), emissiveIntensity: 0,
    });
    m.name = 'north-led';
    night(ctx, m, 1.8);
    return m;
  });
}

// Simple emissive "light" material (lamp heads, entrance canopy downlights).
export function lampMaterial(ctx, color = '#fff1d6', k = 3) {
  return memo(ctx, `lamp:${color}:${k}`, () => {
    const m = new THREE.MeshStandardMaterial({ color: '#d9d6cf', roughness: 0.4, emissive: new THREE.Color(color), emissiveIntensity: 0 });
    m.name = 'north-lamp';
    night(ctx, m, k);
    return m;
  });
}

// Generic cached standard material by params (painted steel, concrete tones ...).
export function plain(ctx, color, { roughness = 0.7, metalness = 0, side = THREE.FrontSide, transparent = false, opacity = 1, envMapIntensity = 1 } = {}) {
  return memo(ctx, `plain:${color}:${roughness}:${metalness}:${side}:${transparent}:${opacity}:${envMapIntensity}`, () => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, side, transparent, opacity, envMapIntensity, depthWrite: !transparent });
    m.name = `north-plain-${color}`;
    return m;
  });
}

// ------------------------------------------------------------------ building signage (round 3)
// One alpha-tested atlas of the lettering on the north landmarks: each row is one line of capitals. signRow() gives
// the UV rectangle and the width/height ratio of a row, so callers size their quads in metres.
const SIGN_ROWS = [
  { text: 'JARED L. COHON UNIVERSITY CENTER', font: '600 88px "Helvetica Neue", Arial, sans-serif' },
  { text: 'CARNEGIE MELLON UNIVERSITY', font: '500 92px "Helvetica Neue", Arial, sans-serif' },
  { text: 'TEPPER SCHOOL OF BUSINESS', font: '500 92px "Helvetica Neue", Arial, sans-serif' },
  { text: 'WARNER HALL', font: '500 96px Georgia, "Times New Roman", serif', spacing: 10 },
];
const SIGN_W = 2048, SIGN_RH = 128;
export function signAtlas(ctx) {
  return memo(ctx, 'signAtlas', () => {
    const c = canvas(SIGN_W, SIGN_RH * SIGN_ROWS.length), g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    const rows = SIGN_ROWS.map((r, i) => {
      // shrink the font until the whole line fits the atlas row
      const sp0 = r.spacing || 4, fit = (font) => { g.font = font; let w = 12; for (const ch of r.text) w += g.measureText(ch).width + sp0; return w; };
      let font = r.font, w0 = fit(font);
      if (w0 > SIGN_W - 16) {
        const m = /(\d+)px/.exec(font), px = m ? +m[1] : 88, gaps = sp0 * r.text.length;
        font = font.replace(/\d+px/, `${Math.floor(px * (SIGN_W - 16 - gaps) / (w0 - gaps))}px`);
      }
      g.font = font;
      g.textBaseline = 'middle';
      g.fillStyle = '#ffffff';
      const sp = r.spacing || 4;
      let x = 12;
      for (const ch of r.text) { g.fillText(ch, x, i * SIGN_RH + SIGN_RH / 2 + 4); x += g.measureText(ch).width + sp; }
      const w = Math.min(SIGN_W - 12, x + 8);
      const H = c.height;
      // CanvasTexture flips Y: canvas row i occupies v in [1 - (i+1)*rh/H, 1 - i*rh/H]
      return { u0: 4 / SIGN_W, u1: w / SIGN_W, v0: 1 - ((i + 1) * SIGN_RH) / H, v1: 1 - (i * SIGN_RH) / H, aspect: (w - 4) / SIGN_RH };
    });
    const map = texture(ctx, c, { wrap: THREE.ClampToEdgeWrapping, srgb: false, release: true });
    const m = new THREE.MeshStandardMaterial({
      color: '#e9ebec', alphaMap: map, alphaTest: 0.45, metalness: 0.55, roughness: 0.32, side: THREE.DoubleSide,
      emissive: new THREE.Color('#fff4e0'), emissiveIntensity: 0,
    });
    m.name = 'north-signs';
    night(ctx, m, 0.55);
    return { material: m, rows };
  });
}
// Lettering quad on a vertical wall: centre (cx, cy, cz), facing n = [nx, 0, nz], text height h (metres of the row
// box; capitals are ~65 % of it). Returns the width used.
export function signQuad(kit, key, atlas, row, cx, cy, cz, n, h) {
  const R = atlas.rows[row], w = h * R.aspect;
  const tx = n[2], tz = -n[0];            // along the wall, reading left → right for a viewer facing the wall
  const x0 = cx - tx * w / 2, z0 = cz - tz * w / 2, x1 = cx + tx * w / 2, z1 = cz + tz * w / 2;
  kit.quad(key, [x0, cy - h / 2, z0], [x1, cy - h / 2, z1], [x1, cy + h / 2, z1], [x0, cy + h / 2, z0], [n[0], 0, n[2]],
    [R.u0, R.v0], [R.u1, R.v0], [R.u1, R.v1], [R.u0, R.v1]);
  return w;
}

// ------------------------------------------------------------------ bronze diamond-lattice screen (Warner Hall)
export function latticeScreen(ctx, { color = '#5c4a36', tileM = 0.6 } = {}) {
  return memo(ctx, `lattice:${color}:${tileM}`, () => {
    const PX = 128, c = canvas(PX, PX), g = c.getContext('2d');
    const ca = canvas(PX, PX), ga = ca.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, PX, PX);
    g.fillStyle = hsl(color, 0.1); g.fillRect(0, 0, PX, PX / 2);
    ga.fillStyle = '#fff'; ga.fillRect(0, 0, PX, PX);
    ga.fillStyle = '#000';
    // scale-like diamond openings on a staggered grid
    const d = PX / 2;
    for (let j = -1; j <= 2; j++) for (let i = -1; i <= 2; i++) {
      const cx = i * d + (j % 2 ? d / 2 : 0), cy = j * d / 2;
      ga.beginPath(); ga.moveTo(cx, cy - d * 0.2); ga.lineTo(cx + d * 0.36, cy); ga.lineTo(cx, cy + d * 0.2); ga.lineTo(cx - d * 0.36, cy); ga.closePath(); ga.fill();
    }
    const map = texture(ctx, c, { tileW: tileM, tileH: tileM, release: true });
    const alphaMap = texture(ctx, ca, { tileW: tileM, tileH: tileM, srgb: false, release: true });
    const m = new THREE.MeshStandardMaterial({ map, alphaMap, alphaTest: 0.5, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.45 });
    m.name = 'north-lattice';
    return m;
  });
}

// ------------------------------------------------------------------ white marble cladding (Warner Hall piers)
export function marble(ctx, { color = '#e4e1da', tileM = 2.4 } = {}) {
  return memo(ctx, `marble:${color}:${tileM}`, () => {
    const PX = 256, r = prng(88), c = canvas(PX, PX), g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, PX, PX);
    // slab joints every 1.2 m (vertical panels) and faint grey veins
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = `rgba(110,110,105,${0.05 + r() * 0.08})`; g.lineWidth = 0.6 + r() * 1.4;
      g.beginPath(); let x = r() * PX, y = r() * PX; g.moveTo(x, y);
      for (let k = 0; k < 6; k++) { x += (r() - 0.3) * 40; y += (r() - 0.5) * 30; g.lineTo(x, y); }
      g.stroke();
    }
    g.fillStyle = 'rgba(90,88,84,0.35)';
    const ppm = PX / tileM;
    for (let x = 0; x < PX; x += 1.2 * ppm) g.fillRect(x, 0, 1, PX);
    for (let y = 0; y < PX; y += 1.2 * ppm) g.fillRect(0, y, PX, 1);
    const map = texture(ctx, c, { tileW: tileM, tileH: tileM, release: true });
    const m = new THREE.MeshStandardMaterial({ map, roughness: 0.42, metalness: 0.0 });
    m.name = 'north-marble';
    return m;
  });
}

// ------------------------------------------------------------------ gabion baskets (Cohon Center 2016 landscape)
// Rounded fieldstones in grey / tan / rust behind a square wire mesh. Tile 1.2 m.
export function gabion(ctx, { tileM = 1.2 } = {}) {
  return memo(ctx, `gabion:${tileM}`, () => {
    const PX = 256, ppm = PX / tileM, r = prng(57), c = canvas(PX, PX), g = c.getContext('2d');
    g.fillStyle = '#4a4540'; g.fillRect(0, 0, PX, PX);
    const cols = ['#8d8478', '#a39684', '#7b7266', '#b3a58c', '#8c6f58', '#9c9a93', '#6f675d'];
    for (let i = 0; i < 260; i++) {
      const x = r() * PX, y = r() * PX, w = (0.06 + r() * 0.1) * ppm, h = w * (0.45 + r() * 0.35);
      for (const [ox, oy] of [[0, 0], [PX, 0], [-PX, 0], [0, PX], [0, -PX]]) {
        g.fillStyle = cols[(r() * cols.length) | 0];
        g.beginPath(); g.ellipse(x + ox, y + oy, w / 2, h / 2, (r() - 0.5) * 0.6, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.beginPath(); g.ellipse(x + ox - w * 0.1, y + oy - h * 0.15, w * 0.3, h * 0.22, 0, 0, Math.PI * 2); g.fill();
      }
    }
    g.strokeStyle = 'rgba(200,200,195,0.55)'; g.lineWidth = 1.2;
    const m = 0.1 * ppm;
    for (let x = 0; x <= PX; x += m) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, PX); g.stroke(); }
    for (let y = 0; y <= PX; y += m) { g.beginPath(); g.moveTo(0, y); g.lineTo(PX, y); g.stroke(); }
    const map = texture(ctx, c, { tileW: tileM, tileH: tileM, release: true });
    const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0.05 });
    mat.name = 'north-gabion';
    return mat;
  });
}
