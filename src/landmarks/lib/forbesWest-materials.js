// Canvas-painted materials for the Forbes-Avenue-west landmarks (CIC, Hamburg Hall, Smith Hall, TCS Hall).
// Everything is generated at runtime and cached per context; canvases of textures that are never repainted are
// released after upload (ctx.materials.canvasTexture(..., { release: true })).
// UVs are metres unless noted (atlas materials use 0..1 cell UVs).
import * as THREE from 'three';
import { prng } from './north-kit.js';

const caches = new WeakMap();
function memo(ctx, key, make) {
  let c = caches.get(ctx);
  if (!c) { c = new Map(); caches.set(ctx, c); }
  if (!c.has(key)) c.set(key, make());
  return c.get(key);
}
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function tex(ctx, cnv, { tileW = 1, tileH = 1, color = true, clamp = false } = {}) {
  let t;
  if (ctx.materials?.canvasTexture) t = ctx.materials.canvasTexture(cnv, { repeatW: tileW, repeatH: tileH, color, release: true });
  else {
    t = new THREE.CanvasTexture(cnv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / tileW, 1 / tileH);
    if (color) t.colorSpace = THREE.SRGBColorSpace;
  }
  if (clamp) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
function hsl(hex, dl = 0, ds = 0) {
  const c = new THREE.Color(hex), o = {};
  c.getHSL(o);
  c.setHSL(o.h, Math.max(0, Math.min(1, o.s + ds)), Math.max(0, Math.min(1, o.l + dl)));
  return `#${c.getHexString()}`;
}
function night(ctx, m, k) { ctx.materials?.registerNightMaterial?.(m, k); return m; }
function speckle(g, w, h, r, n, alpha, size = 2) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = r() > 0.5 ? `rgba(255,255,255,${alpha * r()})` : `rgba(0,0,0,${alpha * r()})`;
    g.fillRect(r() * w, r() * h, size, size);
  }
}

export function plainMat(ctx, color, { roughness = 0.8, metalness = 0, envMapIntensity = 1, side = THREE.FrontSide } = {}) {
  return memo(ctx, `plain:${color}:${roughness}:${metalness}:${envMapIntensity}:${side}`, () => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness, envMapIntensity, side });
    m.name = `fw-plain-${color}`;
    return m;
  });
}

// ------------------------------------------------------------------ window atlas (Hornbostel sash, steel sash, doors)
// 8 x 4 cells. Row 0: double-hung sash windows (Hamburg Hall), row 1: tall round-headed lab windows with a fanlight
// (Hamburg wings), row 2: industrial steel sash (Smith Hall), row 3: panelled doors with a fanlight. In each row the
// odd columns are lit at night (a window picks a random column, so about half the windows glow).
const AX = 8, AY = 4;
export const WIN = { sash: 0, arched: 1, steel: 2, door: 3 };
export function sashAtlas(ctx) {
  return memo(ctx, 'sashAtlas', () => {
    const S = ctx.quality?.level === 'low' ? 64 : 128;
    const W = S * AX, H = S * AY;
    const cm = canvas(W, H), g = cm.getContext('2d');
    const ce = canvas(W, H), ge = ce.getContext('2d');
    const cr = canvas(W, H), gr = cr.getContext('2d');
    ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
    gr.fillStyle = '#b4b4b4'; gr.fillRect(0, 0, W, H);
    const r = prng(4800);
    const frameCol = '#2c463a', steelCol = '#2f3a36';
    for (let row = 0; row < AY; row++) {
      for (let col = 0; col < AX; col++) {
        const x0 = col * S, y0 = (AY - 1 - row) * S; // canvas y is top-down; atlas row 0 is at the bottom (v = 0)
        const lit = col % 2 === 1;
        // glass: sky reflection gradient + dim interior
        const grd = g.createLinearGradient(x0, y0, x0 + S * 0.5, y0 + S);
        grd.addColorStop(0, '#7f97a8'); grd.addColorStop(0.35, '#4c6272'); grd.addColorStop(1, '#27333b');
        g.fillStyle = grd; g.fillRect(x0, y0, S, S);
        // interior variation: blinds / curtains
        const k = r();
        if (k < 0.35) { g.fillStyle = `rgba(226,218,196,${0.45 + r() * 0.3})`; g.fillRect(x0, y0, S, S * (0.15 + r() * 0.4)); }
        else if (k < 0.55) { g.fillStyle = 'rgba(20,24,28,0.35)'; g.fillRect(x0, y0 + S * 0.5, S, S * 0.5); }
        gr.fillStyle = '#141414'; gr.fillRect(x0, y0, S, S);
        if (lit) {
          const warm = 190 + ((r() * 50) | 0);
          ge.fillStyle = `rgb(255,${warm},${(warm * 0.6) | 0})`; ge.globalAlpha = 0.7 + r() * 0.3;
          ge.fillRect(x0, y0, S, S); ge.globalAlpha = 1;
        } else if (r() < 0.3) { ge.fillStyle = 'rgb(40,48,70)'; ge.fillRect(x0, y0, S, S); }
        // bars
        const bar = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x0 + x, y0 + y, w, h); gr.fillStyle = '#9a9a9a'; gr.fillRect(x0 + x, y0 + y, w, h); ge.fillStyle = '#000'; ge.fillRect(x0 + x, y0 + y, w, h); };
        const fw = Math.max(2, S * 0.06), mw = Math.max(1, S * 0.022);
        if (row === 0) {
          // paired double-hung sash: central mullion, meeting rail at 52 %, 2x2 lights per sash half
          bar(0, 0, S, fw, frameCol); bar(0, S - fw, S, fw, frameCol); bar(0, 0, fw, S, frameCol); bar(S - fw, 0, fw, S, frameCol);
          bar(S / 2 - fw * 0.6, 0, fw * 1.2, S, frameCol);
          bar(0, S * 0.5 - fw * 0.5, S, fw * 1.1, frameCol);
          for (const cx of [0.25, 0.75]) bar(S * cx - mw / 2, 0, mw, S, frameCol);
          for (const cy of [0.25]) bar(0, S * cy - mw / 2, S, mw, frameCol);
        } else if (row === 1) {
          // tall lab window: fanlight zone in the top quarter (radial bars read on the round head), 3 x 6 panes
          bar(0, 0, S, fw, frameCol); bar(0, S - fw, S, fw, frameCol); bar(0, 0, fw, S, frameCol); bar(S - fw, 0, fw, S, frameCol);
          bar(0, S * 0.28, S, fw * 0.9, frameCol);                   // spring-line transom
          bar(0, S * 0.62, S, fw * 0.9, frameCol);                   // sash meeting rail
          for (const cx of [1 / 3, 2 / 3]) bar(S * cx - mw / 2, S * 0.28, mw, S * 0.72, frameCol);
          for (const cy of [0.39, 0.5, 0.74, 0.86]) bar(0, S * cy - mw / 2, S, mw, frameCol);
          for (const a of [0.2, 0.4, 0.6, 0.8]) { // fan bars in the head
            g.save(); g.strokeStyle = frameCol; g.lineWidth = mw * 1.2; g.beginPath();
            g.moveTo(x0 + S / 2, y0 + S * 0.28); g.lineTo(x0 + S * a, y0); g.stroke(); g.restore();
          }
        } else if (row === 2) {
          // steel industrial sash: 4 x 5 small panes, projecting hopper band in the middle
          bar(0, 0, S, fw, steelCol); bar(0, S - fw, S, fw, steelCol); bar(0, 0, fw, S, steelCol); bar(S - fw, 0, fw, S, steelCol);
          for (let i = 1; i < 4; i++) bar(S * i / 4 - mw / 2, 0, mw, S, steelCol);
          for (let j = 1; j < 5; j++) bar(0, S * j / 5 - mw / 2, S, mw, steelCol);
          bar(0, S * 0.4 - fw / 2, S, fw, steelCol); bar(0, S * 0.6 - fw / 2, S, fw, steelCol);
          if (col < 2) { g.fillStyle = 'rgba(20,20,20,0.35)'; g.fillRect(x0 + fw, y0 + S * 0.4, S - 2 * fw, S * 0.2); }
        } else {
          // door: two glazed leaves under a fanlight
          bar(0, 0, S, fw, frameCol); bar(0, S - fw, S, fw, frameCol); bar(0, 0, fw, S, frameCol); bar(S - fw, 0, fw, S, frameCol);
          bar(0, S * 0.3, S, fw, frameCol);
          bar(S / 2 - fw / 2, S * 0.3, fw, S * 0.7, frameCol);
          bar(fw, S * 0.82, S - 2 * fw, S * 0.18 - fw, frameCol);     // kick panels
          for (const cy of [0.5, 0.66]) bar(0, S * cy, S, mw, frameCol);
        }
      }
    }
    const map = tex(ctx, cm, { clamp: true });
    const emissiveMap = tex(ctx, ce, { clamp: true });
    const roughnessMap = tex(ctx, cr, { color: false, clamp: true });
    const m = new THREE.MeshStandardMaterial({
      map, emissiveMap, roughnessMap, roughness: 1, metalness: 0.3, envMapIntensity: 1.25,
      emissive: new THREE.Color('#ffd9a2'), emissiveIntensity: 0,
    });
    m.name = 'fw-sash-atlas';
    night(ctx, m, 1.5);
    return m;
  });
}
// UV rectangle of one atlas cell: kind = WIN.*; rand → column
export function sashCell(kind, rand) {
  const i = (rand() * AX) | 0, m = 0.004;
  return [(i + m) / AX, (kind + m) / AY, (i + 1 - m) / AX, (kind + 1 - m) / AY];
}

// ------------------------------------------------------------------ CIC cream ceramic tile rainscreen
export function creamTile(ctx) {
  return memo(ctx, 'creamTile', () => {
    const PX = 256, M = 2.4, ppm = PX / M, r = prng(4720);
    const c = canvas(PX, PX), g = c.getContext('2d');
    g.fillStyle = '#bdb6a8'; g.fillRect(0, 0, PX, PX);
    const tw = 0.6 * ppm, th = 0.3 * ppm;
    for (let y = 0; y < PX; y += th) for (let x = 0; x < PX; x += tw) {
      g.fillStyle = hsl('#e3dccb', (r() - 0.5) * 0.035);
      g.fillRect(x + 1, y + 1, tw - 2, th - 2);
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x + 1, y + 1, tw - 2, 2);
    }
    speckle(g, PX, PX, r, 600, 0.05);
    const m = new THREE.MeshStandardMaterial({ map: tex(ctx, c, { tileW: M, tileH: M }), roughness: 0.55, metalness: 0.02 });
    m.name = 'fw-cream-tile';
    return m;
  });
}

// ------------------------------------------------------------------ TCS Hall two-tone buff Norman brick in vertical panels
export function tcsBrick(ctx) {
  return memo(ctx, 'tcsBrick', () => {
    const TW = 4.8, TH = 2.4, ppm = 100, W = TW * ppm, H = TH * ppm, r = prng(4665);
    const c = canvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#d6ccb6'; g.fillRect(0, 0, W, H);
    // vertical panels: [width m, colour]
    const panels = [[1.45, '#c8ad80'], [0.3, '#e0d0ac'], [1.05, '#d3bd93'], [0.3, '#e2d4b2'], [1.4, '#c4a87b'], [0.3, '#dccba5']];
    const bw = 0.6 * ppm, bh = 0.1 * ppm, j = 1.2;
    let x = 0;
    for (const [pw, col] of panels) {
      const px0 = x * ppm, px1 = (x + pw) * ppm;
      for (let row = 0, y = 0; y < H; row++, y += bh) {
        const off = (row % 2) * bw / 2;
        for (let bx = px0 - off; bx < px1; bx += bw) {
          const a = Math.max(px0, bx), b = Math.min(px1, bx + bw);
          if (b - a < 1) continue;
          g.fillStyle = hsl(col, (r() - 0.5) * 0.05);
          g.fillRect(a + (a === bx ? j : 0), H - y - bh + j, b - a - (a === bx ? j : 0), bh - j);
        }
      }
      x += pw;
    }
    speckle(g, W, H, r, 900, 0.05);
    const m = new THREE.MeshStandardMaterial({ map: tex(ctx, c, { tileW: TW, tileH: TH }), roughness: 0.88 });
    m.name = 'fw-tcs-brick';
    return m;
  });
}

// Dark grey-green slate tiles (TCS Hall corner piers), running bond
export function slateTile(ctx) {
  return memo(ctx, 'slateTile', () => {
    const PX = 256, M = 2.4, ppm = PX / M, r = prng(77);
    const c = canvas(PX, PX), g = c.getContext('2d');
    g.fillStyle = '#3f4442'; g.fillRect(0, 0, PX, PX);
    const tw = 0.6 * ppm, th = 0.3 * ppm;
    for (let row = 0, y = 0; y < PX; row++, y += th) {
      for (let x = -(row % 2) * tw / 2; x < PX; x += tw) {
        g.fillStyle = hsl('#626966', (r() - 0.5) * 0.07);
        g.fillRect(x + 1, y + 1, tw - 2, th - 2);
      }
    }
    speckle(g, PX, PX, r, 900, 0.07);
    const m = new THREE.MeshStandardMaterial({ map: tex(ctx, c, { tileW: M, tileH: M }), roughness: 0.7, metalness: 0.05 });
    m.name = 'fw-slate';
    return m;
  });
}

// Vertical ribbed (corrugated) aluminium, for TCS Hall's recessed top storey
export function ribbedAlu(ctx) {
  return memo(ctx, 'ribbedAlu', () => {
    const PX = 128, M = 1.2, ppm = PX / M;
    const c = canvas(PX, PX), g = c.getContext('2d');
    const rib = 0.15 * ppm;
    for (let x = 0; x < PX; x += rib) {
      const grd = g.createLinearGradient(x, 0, x + rib, 0);
      grd.addColorStop(0, '#9ea4a8'); grd.addColorStop(0.4, '#dfe3e5'); grd.addColorStop(0.7, '#c3c8cb'); grd.addColorStop(1, '#8f9599');
      g.fillStyle = grd; g.fillRect(x, 0, rib, PX);
    }
    const m = new THREE.MeshStandardMaterial({ map: tex(ctx, c, { tileW: M, tileH: M }), roughness: 0.38, metalness: 0.55 });
    m.name = 'fw-ribbed-alu';
    return m;
  });
}

// Light precast concrete (CIC frame and louvres) with faint form lines
export function precast(ctx, color = '#c4bfb4') {
  return memo(ctx, `precast:${color}`, () => {
    const PX = 256, M = 4, ppm = PX / M, r = prng(12);
    const c = canvas(PX, PX), g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, PX, PX);
    for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '60,55,50'},${0.035 * r()})`; g.fillRect(r() * PX, r() * PX, 10 + r() * 60, 10 + r() * 60); }
    speckle(g, PX, PX, r, 1500, 0.06);
    g.fillStyle = 'rgba(0,0,0,0.1)'; g.fillRect(0, PX - 2, PX, 2);
    const m = new THREE.MeshStandardMaterial({ map: tex(ctx, c, { tileW: M, tileH: M }), roughness: 0.86 });
    m.name = 'fw-precast';
    return m;
  });
}

// ------------------------------------------------------------------ Hamburg Hall frontispiece (cast stone, carved)
// One texture exactly covering the pavilion's front face: w x h metres, the arch opening from s = a0 to a1 with its
// crown at archTop (metres above the texture bottom). Ashlar joints, carved foliage panels on the piers and the
// frieze inscription over the arch.
export function frontispiece(ctx, { w, h, a0, a1, archTop, friezeY, text = 'U.S. BUREAU OF MINES' }) {
  return memo(ctx, `frontis:${w}:${h}:${a0}:${a1}:${archTop}:${friezeY}`, () => {
    const ppm = ctx.quality?.level === 'low' ? 36 : 64;
    const W = Math.round(w * ppm), H = Math.round(h * ppm), r = prng(1915);
    const c = canvas(W, H), g = c.getContext('2d');
    const Y = (m) => H - m * ppm; // metres above bottom → canvas y
    const stone = '#ded8c9';
    g.fillStyle = stone; g.fillRect(0, 0, W, H);
    speckle(g, W, H, r, 2500, 0.05);
    for (let i = 0; i < 50; i++) { g.fillStyle = `rgba(${r() > 0.6 ? '120,110,90' : '255,255,250'},${0.04 * r()})`; g.fillRect(r() * W, r() * H * 0.3 + H * 0.7 * r(), 6 + r() * 40, 20 + r() * 90); }
    // ashlar joints
    g.fillStyle = 'rgba(90,80,65,0.28)';
    for (let m = 0.9, row = 0; m < h; m += 0.62, row++) {
      g.fillRect(0, Y(m), W, 1.5);
      for (let s = (row % 2) * 0.55; s < w; s += 1.1) g.fillRect(s * ppm, Y(m + 0.62), 1.5, 0.62 * ppm);
    }
    // weathered base
    const gb = g.createLinearGradient(0, Y(1.2), 0, H);
    gb.addColorStop(0, 'rgba(90,85,75,0)'); gb.addColorStop(1, 'rgba(90,85,75,0.22)');
    g.fillStyle = gb; g.fillRect(0, Y(1.2), W, 1.2 * ppm);
    // carved foliage panels: one on each pier
    const panel = (s0, s1, m0, m1) => {
      const x0 = s0 * ppm, x1 = s1 * ppm, y0 = Y(m1), y1 = Y(m0);
      g.fillStyle = 'rgba(70,62,50,0.35)'; g.fillRect(x0 - 3, y0 - 3, x1 - x0 + 6, y1 - y0 + 6);          // sunk margin
      g.fillStyle = hsl(stone, -0.04); g.fillRect(x0, y0, x1 - x0, y1 - y0);
      const cx = (x0 + x1) / 2, lw = (x1 - x0);
      for (let y = y1 - lw * 0.3, k = 0; y > y0 + lw * 0.2; y -= lw * 0.42, k++) {
        const side = k % 2 ? 1 : -1;
        // stem
        g.strokeStyle = 'rgba(80,70,55,0.55)'; g.lineWidth = Math.max(1.5, lw * 0.05);
        g.beginPath(); g.moveTo(cx, y + lw * 0.42); g.quadraticCurveTo(cx + side * lw * 0.18, y + lw * 0.2, cx, y); g.stroke();
        // leaves (shadow below, highlight above: reads as relief under the sun)
        for (const [dx, dy, rs] of [[side * 0.22, 0.05, 0.2], [-side * 0.18, 0.18, 0.16], [side * 0.05, -0.08, 0.14]]) {
          const lx = cx + dx * lw, ly = y + dy * lw, rr = rs * lw;
          g.fillStyle = 'rgba(70,60,45,0.45)'; g.beginPath(); g.ellipse(lx + rr * 0.15, ly + rr * 0.2, rr, rr * 0.62, side * 0.6, 0, Math.PI * 2); g.fill();
          g.fillStyle = hsl(stone, 0.05); g.beginPath(); g.ellipse(lx, ly, rr, rr * 0.6, side * 0.6, 0, Math.PI * 2); g.fill();
          g.fillStyle = 'rgba(80,70,55,0.4)'; g.fillRect(lx - 0.5, ly - rr * 0.5, 1, rr);
        }
      }
    };
    const pierW = a0;
    const pm = pierW * 0.28;
    panel(pm, pierW - pm, 1.8, archTop - 0.4);
    panel(a1 + pm, w - pm, 1.8, archTop - 0.4);
    // voussoir joints around the arch
    const ac = ((a0 + a1) / 2) * ppm, ar = ((a1 - a0) / 2) * ppm, ay = Y(archTop - (a1 - a0) / 2);
    g.strokeStyle = 'rgba(90,80,65,0.35)'; g.lineWidth = 1.5;
    for (let k = 0; k <= 12; k++) {
      const t = Math.PI - (k / 12) * Math.PI;
      g.beginPath(); g.moveTo(ac + Math.cos(t) * ar, ay - Math.sin(t) * ar); g.lineTo(ac + Math.cos(t) * (ar + 0.75 * ppm), ay - Math.sin(t) * (ar + 0.75 * ppm)); g.stroke();
    }
    g.beginPath(); g.arc(ac, ay, ar + 0.75 * ppm, Math.PI, 0); g.stroke();
    // keystone
    g.fillStyle = hsl(stone, 0.04); g.fillRect(ac - 0.35 * ppm, ay - ar - 0.85 * ppm, 0.7 * ppm, 0.9 * ppm);
    g.fillStyle = 'rgba(80,70,55,0.4)'; g.fillRect(ac - 0.35 * ppm, ay - ar - 0.85 * ppm, 0.7 * ppm, 2);
    // frieze inscription (incised: dark letters with a light lower lip)
    const fs = Math.round(0.42 * ppm);
    g.font = `600 ${fs}px "Times New Roman", Georgia, serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const ty = Y(friezeY);
    const spaced = text.split('').join(String.fromCharCode(8202));
    g.fillStyle = 'rgba(255,255,250,0.6)'; g.fillText(spaced, W / 2 + 1, ty + 1.5);
    g.fillStyle = 'rgba(62,54,42,0.85)'; g.fillText(spaced, W / 2, ty);
    const m = new THREE.MeshStandardMaterial({ map: tex(ctx, c, { tileW: w, tileH: h }), roughness: 0.82 });
    m.name = 'fw-frontispiece';
    return m;
  });
}

// ------------------------------------------------------------------ signs
// Flat sign texture (UV 0..1 over the sign quad): lines = [{ text, size (fraction of height), weight, font, y }]
export function signMat(ctx, key, { w, h, bg = null, color = '#ffffff', lines, ppm = 64, emissive = false }) {
  return memo(ctx, `sign:${key}`, () => {
    const W = Math.min(2048, Math.round(w * ppm)), H = Math.min(1024, Math.round(h * ppm));
    const c = canvas(W, H), g = c.getContext('2d');
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, W, H); } else g.clearRect(0, 0, W, H);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const l of lines) {
      g.font = `${l.weight || 600} ${Math.round(l.size * H)}px ${l.font || 'Arial, Helvetica, sans-serif'}`;
      g.fillStyle = l.color || color;
      const t = l.spacing ? l.text.split('').join(String.fromCharCode(8202)) : l.text;
      g.fillText(t, W * (l.x ?? 0.5), H * l.y);
    }
    const map = tex(ctx, c, { clamp: true });
    const m = new THREE.MeshStandardMaterial({ map, roughness: 0.6, metalness: 0.1, transparent: !bg, alphaTest: bg ? 0 : 0.4 });
    if (emissive) { m.emissive = new THREE.Color('#ffffff'); m.emissiveMap = map; m.emissiveIntensity = 0; night(ctx, m, 0.8); }
    m.name = `fw-sign-${key}`;
    return m;
  });
}
