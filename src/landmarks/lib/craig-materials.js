// Canvas-painted materials for the Craig Street / Henry Street / Fifth Avenue landmarks (craig.js): the SEI's
// granite plinth, the INI's white panel skin, 300 S. Craig's red brick, the precast fins and coffered soffit of
// 4615 Forbes, and one small atlas with all the signs and lettering. Everything is generated at runtime and cached
// per context; canvases are released once three has uploaded them (none of these textures is ever repainted).
//
// UV convention (see ARCHITECTURE.md): metres; walls u = metres along the wall, v = metres above a reference level.
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
// Texture tiling tileW x tileH metres. The canvas backing store is dropped after the upload.
function tex(ctx, cnv, { tileW = 1, tileH = 1, srgb = true, wrap = THREE.RepeatWrapping, mips = true } = {}) {
  const t = new THREE.CanvasTexture(cnv);
  t.wrapS = t.wrapT = wrap;
  t.repeat.set(1 / tileW, 1 / tileH);
  t.anisotropy = Math.min(8, ctx.renderer?.capabilities?.getMaxAnisotropy?.() ?? 4);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = mips;
  if (!mips) t.minFilter = THREE.LinearFilter;
  t.onUpdate = () => { t.onUpdate = null; cnv.width = cnv.height = 1; };
  t.needsUpdate = true;
  return t;
}
function hsl(hex, dl = 0, ds = 0) {
  const c = new THREE.Color(hex), o = {};
  c.getHSL(o);
  c.setHSL(o.h, Math.max(0, Math.min(1, o.s + ds)), Math.max(0, Math.min(1, o.l + dl)));
  return `#${c.getHexString()}`;
}
const lowQ = (ctx) => ctx.quality?.level === 'low';
function std(name, params) {
  const m = new THREE.MeshStandardMaterial(params);
  m.name = `craig-${name}`;
  return m;
}
function noise(g, W, H, r, n, alpha, size) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '0,0,0'},${alpha * r()})`;
    const s = 1 + r() * size;
    g.fillRect(r() * W, r() * H, s, s);
  }
}

// ------------------------------------------------------------------ SEI granite / limestone ashlar
// Large sawn panels in a warm pinkish beige (the SEI plinth), slightly varied per panel, fine speckle, faint
// rain streaks hanging from every course joint. tile = 3 panels x 3 courses.
export function ashlar(ctx, { color = '#cbb6a3', blockW = 2.4, courseH = 1.2, seed = 3, streaks = 0.5 } = {}) {
  return memo(ctx, `ashlar:${color}:${blockW}:${courseH}:${streaks}`, () => {
    const tileW = blockW * 3, tileH = courseH * 3, ppm = lowQ(ctx) ? 36 : 64;
    const W = Math.round(tileW * ppm), H = Math.round(tileH * ppm), r = prng(seed);
    const c = canvas(W, H), g = c.getContext('2d');
    g.fillStyle = hsl(color, -0.12); g.fillRect(0, 0, W, H);
    const j = Math.max(1, Math.round(0.012 * ppm));
    for (let row = 0; row < 3; row++) {
      const off = row % 2 ? blockW * ppm / 2 : 0;
      for (let k = -1; k < 4; k++) {
        const x = k * blockW * ppm + off, y = H - (row + 1) * courseH * ppm;
        g.fillStyle = hsl(color, (r() - 0.5) * 0.05, (r() - 0.5) * 0.04);
        g.fillRect(x + j, y + j, blockW * ppm - j, courseH * ppm - j);
      }
    }
    noise(g, W, H, r, W * H / 60, 0.07, 1.5);
    // streaks below each course joint (weathering, very visible on the real plinth)
    for (let row = 0; row < 3; row++) {
      const y0 = H - (row + 1) * courseH * ppm + j;
      for (let i = 0; i < W / 6 * streaks; i++) {
        const x = r() * W, len = (0.15 + r() * 0.8) * courseH * ppm;
        const grd = g.createLinearGradient(0, y0, 0, y0 + len);
        grd.addColorStop(0, `rgba(70,60,45,${0.1 + r() * 0.12})`); grd.addColorStop(1, 'rgba(70,60,45,0)');
        g.fillStyle = grd; g.fillRect(x, y0, 1 + r() * 3, len);
      }
    }
    return std('ashlar', { map: tex(ctx, c, { tileW, tileH }), roughness: 0.78, metalness: 0 });
  });
}

// Polished speckled granite (SEI base course, 4615 Forbes podium caps)
export function granite(ctx, color = '#8e8580') {
  return memo(ctx, `granite:${color}`, () => {
    const tile = 2, PX = lowQ(ctx) ? 128 : 256, r = prng(5);
    const c = canvas(PX, PX), g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, PX, PX);
    for (let i = 0; i < PX * PX / 5; i++) {
      const k = r();
      g.fillStyle = k < 0.4 ? 'rgba(30,26,26,0.5)' : k < 0.7 ? 'rgba(230,220,215,0.45)' : 'rgba(150,110,100,0.4)';
      g.fillRect(r() * PX, r() * PX, 1 + r() * 1.5, 1 + r() * 1.5);
    }
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, PX, 1); g.fillRect(0, 0, 1, PX);
    return std('granite', { map: tex(ctx, c, { tileW: tile, tileH: tile }), roughness: 0.42, metalness: 0.05 });
  });
}

// ------------------------------------------------------------------ smooth painted panel / stucco
// INI and 407 S. Craig: white exterior insulation panels / stucco with faint joints and soft grime at the base.
export function whitePanel(ctx, { color = '#e8e6df', panelW = 2.4, panelH = 1.2, seed = 9, joints = true } = {}) {
  return memo(ctx, `white:${color}:${panelW}:${panelH}:${joints}`, () => {
    const tileW = panelW * 2, tileH = panelH * 4, ppm = lowQ(ctx) ? 24 : 48;
    const W = Math.round(tileW * ppm), H = Math.round(tileH * ppm), r = prng(seed);
    const c = canvas(W, H), g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '90,85,75'},${0.025 * r()})`;
      g.fillRect(r() * W, r() * H, 20 + r() * 90, 20 + r() * 90);
    }
    noise(g, W, H, r, W * H / 40, 0.05, 1.2);
    if (joints) {
      g.fillStyle = 'rgba(80,78,70,0.28)';
      for (let k = 0; k < 4; k++) g.fillRect(0, Math.round(k * panelH * ppm), W, 1);
      for (let k = 0; k < 2; k++) g.fillRect(Math.round(k * panelW * ppm), 0, 1, H);
    }
    return std('white', { map: tex(ctx, c, { tileW, tileH }), roughness: 0.8, metalness: 0 });
  });
}

// ------------------------------------------------------------------ red face brick (300 S. Craig, 2000s infill)
// Running bond, 0.215 x 0.065 m units, varied reds with a few darker headers; light grey mortar.
export function redBrick(ctx, { colors = ['#9a4634', '#a9533c', '#8e3f2f', '#b05d45', '#94473a'], mortar = '#b9aa9a', seed = 13 } = {}) {
  return memo(ctx, `redbrick:${colors.join()}:${mortar}`, () => {
    const bw = 0.215, bh = 0.065, j = 0.01;
    const cols = Math.round(2.2 / (bw + j)), rows = 2 * Math.round(0.9 / (bh + j));
    const tileW = cols * (bw + j), tileH = rows * (bh + j), ppm = lowQ(ctx) ? 64 : 128;
    const W = Math.round(tileW * ppm), H = Math.round(tileH * ppm), r = prng(seed);
    const c = canvas(W, H), g = c.getContext('2d');
    g.fillStyle = mortar; g.fillRect(0, 0, W, H);
    const BW = bw * ppm, BH = bh * ppm, J = j * ppm;
    for (let row = 0; row < rows; row++) {
      const off = row % 2 ? (BW + J) / 2 : 0, y = H - (row + 1) * (BH + J) + J / 2;
      for (let x = -off; x < W; x += BW + J) {
        g.fillStyle = hsl(colors[(r() * colors.length) | 0], (r() - 0.5) * 0.07);
        g.fillRect(x, y, BW, BH);
        if (r() < 0.25) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, y + BH * 0.6, BW, BH * 0.4); }
      }
    }
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(${r() > 0.5 ? '255,230,210' : '40,20,10'},${0.035 * r()})`;
      g.fillRect(r() * W, r() * H, 30 + r() * 90, 30 + r() * 90);
    }
    return std('redbrick', { map: tex(ctx, c, { tileW, tileH }), roughness: 0.9, metalness: 0 });
  });
}

// ------------------------------------------------------------------ precast concrete (4615 Forbes fins, SEI trim)
export function precast(ctx, { color = '#e3ded3', seed = 17 } = {}) {
  return memo(ctx, `precast:${color}`, () => {
    const tile = 3, PX = lowQ(ctx) ? 128 : 256, r = prng(seed);
    const c = canvas(PX, PX), g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, PX, PX);
    noise(g, PX, PX, r, PX * PX / 6, 0.07, 1.4);
    for (let i = 0; i < 25; i++) {   // soft grey weathering streaks
      const x = r() * PX, w = 2 + r() * 10, grd = g.createLinearGradient(0, 0, 0, PX);
      grd.addColorStop(0, 'rgba(90,85,75,0.1)'); grd.addColorStop(1, 'rgba(90,85,75,0)');
      g.fillStyle = grd; g.fillRect(x, 0, w, PX * (0.3 + r() * 0.7));
    }
    return std('precast', { map: tex(ctx, c, { tileW: tile, tileH: tile }), roughness: 0.82, metalness: 0 });
  });
}

// Coffered (waffle-slab) soffit under the cantilevered upper storey of 4615 Forbes. Mapped with world x/z (m).
export function cofferSoffit(ctx, { color = '#dcd6ca', module = 1.5 } = {}) {
  return memo(ctx, `coffer:${color}:${module}`, () => {
    const PX = lowQ(ctx) ? 64 : 128, r = prng(21);
    const c = canvas(PX, PX), g = c.getContext('2d');
    g.fillStyle = hsl(color, -0.05); g.fillRect(0, 0, PX, PX);
    const rib = PX * 0.14;
    // recessed pan with shaded slopes (light from below-front)
    g.fillStyle = hsl(color, -0.2); g.fillRect(rib, rib, PX - 2 * rib, PX - 2 * rib);
    g.fillStyle = hsl(color, -0.12); g.fillRect(rib * 1.6, rib * 1.6, PX - 3.2 * rib, PX - 3.2 * rib);
    g.fillStyle = hsl(color, 0.05);
    g.fillRect(0, 0, PX, rib * 0.8); g.fillRect(0, 0, rib * 0.8, PX);
    noise(g, PX, PX, r, PX * PX / 8, 0.06, 1.2);
    return std('coffer', { map: tex(ctx, c, { tileW: module, tileH: module }), roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  });
}

// ------------------------------------------------------------------ signs & lettering atlas (1024 x 1024)
// Regions in canvas pixels (x, y, w, h). signUV(name) → [u0, v0, u1, v1] for MeshKit quads (v = 0 at the bottom).
const FONT_SERIF = '"Source Serif 4", Georgia, "Times New Roman", serif';
const FONT_SANS = '"Helvetica Neue", Arial, "Noto Sans SC", sans-serif';
export const SIGN_REGIONS = {
  seiCarved: [0, 0, 1024, 110],     // carved lettering on the SEI's curved plinth wall (≈ 11 x 1.2 m)
  cmRail: [0, 112, 512, 72],        // red "Carnegie Mellon" letters on 407 S. Craig (≈ 5.5 x 0.8 m)
  forbes: [512, 112, 512, 72],      // "4615 FORBES" canopy fascia (≈ 4.6 x 0.65 m)
  iniBlade: [0, 190, 200, 440],     // red CMU blade sign at the INI (≈ 0.9 x 2.0 m)
  seiBoard: [210, 190, 300, 110],   // red "Software Engineering Institute" board on posts (≈ 1.8 x 0.66 m)
  craigBlade: [520, 190, 200, 440], // red CMU blade sign at 300 S. Craig
  craigNum: [210, 310, 300, 110],   // "300" address numerals
  iniWall: [0, 640, 1024, 90],      // INI name band over the Winthrop entrance
};
export function signUV(name) {
  const [x, y, w, h] = SIGN_REGIONS[name];
  const m = 1.5; // half-texel-ish inset against bleeding
  return [(x + m) / 1024, 1 - (y + h - m) / 1024, (x + w - m) / 1024, 1 - (y + m) / 1024];
}
export function signAtlas(ctx) {
  return memo(ctx, 'signs', () => {
    const S = 1024, c = canvas(S, S), g = c.getContext('2d');
    g.clearRect(0, 0, S, S);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const R = SIGN_REGIONS;
    const fit = (text, font, px, maxW) => { let s = px; g.font = `${font.replace('$', s)}`; while (g.measureText(text).width > maxW && s > 6) { s -= 1; g.font = font.replace('$', s); } };
    // SEI carved letters: dark weathered grooves with a light lower lip (reads as incised in the stone)
    {
      const [x, y, w, h] = R.seiCarved;
      const line = (t, px, maxW, yy) => {
        fit(t, `500 $px ${FONT_SERIF}`, px, maxW);
        g.fillStyle = 'rgba(255,245,230,0.55)'; g.fillText(t, x + w / 2 + 1, yy + 2);
        g.fillStyle = 'rgba(58,50,42,0.92)'; g.fillText(t, x + w / 2, yy);
      };
      g.letterSpacing = '4px';
      line('CARNEGIE MELLON UNIVERSITY', 28, w * 0.5, y + 24);
      g.letterSpacing = '6px';
      line('SOFTWARE ENGINEERING INSTITUTE', 60, w - 40, y + 74);
      g.letterSpacing = '0px';
    }
    {
      const [x, y, w, h] = R.cmRail;
      fit('Carnegie Mellon', `700 $px ${FONT_SERIF}`, 58, w - 30);
      g.fillStyle = '#c41230'; g.fillText('Carnegie Mellon', x + w / 2, y + h / 2 - 4);
      g.fillStyle = '#1c1c1c'; g.fillRect(x + 6, y + h - 12, w - 12, 8);
    }
    {
      const [x, y, w, h] = R.forbes;
      g.fillStyle = '#e9e5dc'; g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(x, y + h - 6, w, 6);
      g.letterSpacing = '4px';
      fit('4615 FORBES', `700 $px ${FONT_SANS}`, 50, w - 90);
      g.fillStyle = '#6b1f35'; g.fillText('4615 FORBES', x + w / 2, y + h / 2 + 2);
      g.letterSpacing = '0px';
    }
    const blade = (reg, lines) => {
      const [x, y, w, h] = R[reg];
      g.fillStyle = '#b5152b'; g.fillRect(x, y, w, h);
      g.fillStyle = '#1b1b1b'; g.fillRect(x, y, w, 46);
      g.fillStyle = '#ffffff'; g.font = `600 22px ${FONT_SERIF}`; g.fillText('Carnegie Mellon', x + w / 2, y + 24);
      g.save(); g.translate(x + w * 0.3, y + h * 0.62); g.rotate(-Math.PI / 2);
      g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,0.28)'; g.font = `800 56px ${FONT_SANS}`; g.fillText(lines.big, 0, 0);
      g.restore();
      g.textAlign = 'left'; g.fillStyle = '#ffffff';
      lines.small.forEach((t, i) => { g.font = `500 21px ${FONT_SANS}`; g.fillText(t, x + w * 0.52, y + h * 0.45 + i * 28); });
      g.font = `700 30px ${FONT_SANS}`; g.fillText(lines.num, x + w * 0.52, y + h - 36);
      g.textAlign = 'center';
    };
    blade('iniBlade', { big: 'INI', small: ['Information', 'Networking', 'Institute'], num: '4616' });
    blade('craigBlade', { big: '300', small: ['300 South', 'Craig', 'Street'], num: '300' });
    {
      const [x, y, w, h] = R.seiBoard;
      g.fillStyle = '#c0452f'; g.fillRect(x, y, w, h);
      g.fillStyle = '#1b1b1b'; g.fillRect(x, y, w, 24);
      g.fillStyle = '#ffffff'; g.font = `600 16px ${FONT_SERIF}`; g.textAlign = 'right'; g.fillText('Carnegie Mellon', x + w - 10, y + 13);
      g.textAlign = 'center';
      fit('Software Engineering Institute', `600 $px ${FONT_SANS}`, 26, w - 24);
      g.fillText('Software Engineering Institute', x + w / 2, y + 62);
    }
    {
      const [x, y, w, h] = R.craigNum;
      fit('300', `700 $px ${FONT_SERIF}`, 96, w);
      g.fillStyle = '#f2efe6'; g.fillText('300', x + w / 2, y + h / 2 + 4);
    }
    {
      const [x, y, w, h] = R.iniWall;
      g.letterSpacing = '5px';
      fit('INFORMATION NETWORKING INSTITUTE', `600 $px ${FONT_SANS}`, 46, w - 40);
      g.fillStyle = '#2b2d30'; g.fillText('INFORMATION NETWORKING INSTITUTE', x + w / 2, y + h / 2);
      g.letterSpacing = '0px';
    }
    const map = tex(ctx, c, { wrap: THREE.ClampToEdgeWrapping });
    return std('signs', { map, alphaTest: 0.45, roughness: 0.6, metalness: 0, side: THREE.DoubleSide });
  });
}

// ------------------------------------------------------------------ simple cached colours
export function flat(ctx, color, { roughness = 0.7, metalness = 0, side = THREE.FrontSide, emissive = null, night = 0 } = {}) {
  return memo(ctx, `flat:${color}:${roughness}:${metalness}:${side}:${emissive}:${night}`, () => {
    const m = std(`flat-${color}`, { color, roughness, metalness, side });
    if (emissive) {
      m.emissive = new THREE.Color(emissive);
      m.emissiveIntensity = 0;
      ctx.materials?.registerNightMaterial?.(m, night || 1);
    }
    return m;
  });
}
