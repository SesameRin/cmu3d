// Procedural canvas textures + materials for the Oakland landmarks (Cathedral of Learning, Heinz Chapel,
// Mellon Institute). All painted at runtime; UVs are metres (u along the wall, v up from a reference level).
// Each facade texture comes with an emissive map (lit windows + a faint warm "floodlight" on the stone)
// driven at night by ctx.materials.registerNightMaterial.
import * as THREE from 'three';

export const STONE = {
  cathedral: '#cdc3ae', // Indiana limestone, weathered buff-grey
  chapel: '#d0cabd',    // grey Indiana limestone
  mellon: '#ddd5c2',    // cleaner, paler limestone
  stpaul: '#a9a292',    // St. Paul Cathedral: soot-weathered grey-buff limestone
};

// ------------------------------------------------------------------ small colour helpers
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgb(r, g, b, a = 1) { return `rgba(${r | 0},${g | 0},${b | 0},${a})`; }
function shadeRgb(hex, f) { const [r, g, b] = hexToRgb(hex); return rgb(Math.min(255, r * f), Math.min(255, g * f), Math.min(255, b * f)); }
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// Seamless 256 px tile of faint light/dark stone speckle, written straight into ImageData once and then laid
// over each texture as a repeating pattern (one fill instead of tens of thousands of fillRect calls).
let SPECKLE = null;
function speckleTile() {
  if (SPECKLE) return SPECKLE;
  const S = 256, c = canvas(S, S), g = c.getContext('2d');
  const img = g.createImageData(S, S), d = img.data, r = seeded(4271);
  for (let i = 0, n = (S * S) / 30; i < n; i++) {
    const v = r() > 0.5 ? 255 : 30, a = (r() * 13) | 0; // alpha up to 0.05
    const x0 = (r() * S) | 0, y0 = (r() * S) | 0, w = 1 + ((r() * 2.4) | 0), h = 1 + ((r() * 2.4) | 0);
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const k = (((y % S) * S) + (x % S)) * 4;
      d[k] = d[k + 1] = d[k + 2] = v; d[k + 3] = a;
    }
  }
  g.putImageData(img, 0, 0);
  return (SPECKLE = c);
}
function speckle(g, W, H) {
  const p = g.createPattern(speckleTile(), 'repeat');
  if (!p) return;
  g.fillStyle = p; g.fillRect(0, 0, W, H);
}

// ------------------------------------------------------------------ painters
// Coursed ashlar. The canvas is W x H px covering wM x hM metres; v=0 is the bottom edge.
function paintAshlar(g, W, H, wM, hM, color, r, { course = 0.62, block = [0.8, 1.9], joint = 0.1, vary = 0.04, streaks = 0.5 } = {}) {
  const px = W / wM, py = H / hM;
  g.fillStyle = color; g.fillRect(0, 0, W, H);
  for (let v = 0, row = 0; v < hM; v += course, row++) {
    const y0 = H - (v + course) * py, y1 = H - v * py;
    let u = -r() * block[1];
    while (u < wM) {
      const bw = block[0] + r() * (block[1] - block[0]);
      g.fillStyle = shadeRgb(color, 1 + (r() - 0.5) * 2 * vary);
      g.fillRect(u * px + 1, y0 + 1, bw * px - 1, y1 - y0 - 1);
      g.fillStyle = `rgba(60,50,40,${joint})`;
      g.fillRect(u * px, y0, 1, y1 - y0);
      u += bw;
    }
    g.fillStyle = `rgba(60,50,40,${joint * 1.1})`; g.fillRect(0, y0, W, 1);
    g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, y0 + 1, W, 1);
  }
  speckle(g, W, H);
  // soft vertical weathering streaks
  for (let i = 0; i < 14 * streaks; i++) {
    const x = r() * W, w = 2 + r() * W * 0.04, y = r() * H * 0.6, h = H * (0.2 + r() * 0.5);
    const grd = g.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, 'rgba(70,60,50,0)'); grd.addColorStop(0.3, `rgba(70,60,50,${0.05 + r() * 0.06})`); grd.addColorStop(1, 'rgba(70,60,50,0)');
    g.fillStyle = grd; g.fillRect(x, y, w, h);
  }
}

// Path of a two-centred pointed arch opening. x,w in px; yTop = apex y, yBot = bottom (canvas y grows down).
// k = radius / span (0.5 = round arch, 1 = equilateral, >1 lancet).
function archPath(g, x, w, ySpring, yBot, k = 1) {
  const R = Math.max(0.5, k) * w;
  const hA = Math.sqrt(Math.max(0, R * R - (R - w / 2) ** 2));
  const a1 = Math.atan2(-hA, w / 2 - R), a2 = Math.atan2(-hA, R - w / 2);
  g.beginPath();
  g.moveTo(x, yBot);
  g.lineTo(x, ySpring);
  g.arc(x + R, ySpring, R, Math.PI, a1 < 0 ? a1 + Math.PI * 2 : a1, false);
  g.arc(x + w - R, ySpring, R, a2, 0, false);
  g.lineTo(x + w, yBot);
  g.closePath();
  return hA;
}
function archApex(w, k) { const R = Math.max(0.5, k) * w; return Math.sqrt(Math.max(0, R * R - (R - w / 2) ** 2)); }

function glassFill(g, x, y, w, h, top = '#46525c', bot = '#1c232a') {
  const grd = g.createLinearGradient(x, y, x + w * 0.4, y + h);
  grd.addColorStop(0, top); grd.addColorStop(0.55, bot); grd.addColorStop(1, top);
  g.fillStyle = grd;
}

// lit-window colours (emissive)
function litColor(r, cool = 0.25) {
  if (r() < cool) return rgb(215 + r() * 30, 225 + r() * 25, 255, 0.85);
  const w = 180 + r() * 60;
  return rgb(255, w + 15, w - 55, 0.9);
}

// ------------------------------------------------------------------ texture factory
const CACHE = new WeakMap(); // ctx.materials -> { mats, dims }

export function createOaklandMaterials(ctx) {
  const M = ctx.materials;
  if (CACHE.has(M)) return CACHE.get(M);
  const maxAniso = ctx.renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;
  const texCache = new Map();

  function tex(c, repW, repH, color = true, wrap = true) {
    const t = new THREE.CanvasTexture(c);
    if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    else t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.repeat.set(1 / repW, 1 / repH);
    t.anisotropy = Math.min(8, maxAniso);
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  }

  // Build {map, emissiveMap, roughnessMap} from a painter(gm, ge, gr, W, H, r)
  function painted(key, W, H, repW, repH, painter, { wrap = true, seed = 1 } = {}) {
    if (texCache.has(key)) return texCache.get(key);
    const cm = canvas(W, H), ce = canvas(W, H), cr = canvas(W, H);
    const gm = cm.getContext('2d'), ge = ce.getContext('2d'), gr = cr.getContext('2d');
    ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
    gr.fillStyle = '#e0e0e0'; gr.fillRect(0, 0, W, H);
    painter(gm, ge, gr, W, H, seeded(seed * 7919 + 13));
    const out = { map: tex(cm, repW, repH, true, wrap), emissiveMap: tex(ce, repW, repH, true, wrap), roughnessMap: tex(cr, repW, repH, false, wrap) };
    texCache.set(key, out);
    return out;
  }

  function facadeMat(name, t, { night = 1.3, metalness = 0.04 } = {}) {
    const m = new THREE.MeshStandardMaterial({
      map: t.map, emissiveMap: t.emissiveMap, roughnessMap: t.roughnessMap,
      roughness: 1, metalness, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0,
    });
    m.name = `oaklandA-${name}`;
    M.registerNightMaterial(m, night);
    return m;
  }

  // Stone for piers / trims: shared canvas texture, private material so the night glow is ours only.
  function stoneMat(name, color, glow, glowColor = '#ffd8a8', tile = 4) {
    const map = M.surfaceTexture('stone', color, tile, 11);
    const m = new THREE.MeshStandardMaterial({ map, color: '#ffffff', roughness: 0.86, emissive: new THREE.Color(glowColor), emissiveMap: map, emissiveIntensity: 0 });
    m.name = `oaklandA-${name}`;
    if (glow > 0) M.registerNightMaterial(m, glow);
    return m;
  }

  // ---------------------------------------------------------------- Cathedral: tower shaft
  // tile = 2 bays (3.3 m) x 8 storeys (3.6 m)
  const TOWER = { bay: 3.3, floor: 3.6, bays: 4, floors: 8 };
  const cathTower = painted('cathTower', 512, 1024, TOWER.bay * TOWER.bays, TOWER.floor * TOWER.floors, (gm, ge, gr, W, H, r) => {
    const wM = TOWER.bay * TOWER.bays, hM = TOWER.floor * TOWER.floors, px = W / wM, py = H / hM;
    paintAshlar(gm, W, H, wM, hM, STONE.cathedral, r, { course: 0.6, block: [0.7, 1.6] });
    ge.fillStyle = rgb(62, 50, 36); ge.fillRect(0, 0, W, H); // floodlight glow on stone
    for (let b = 0; b < TOWER.bays; b++) {
      // Each bay: a continuous recessed channel (the vertical "slit") between the stone piers, holding a pair of
      // narrow Gothic lights per storey and carved spandrel panels - dark stripes against pale limestone ribs.
      const x0 = (b * TOWER.bay + 0.66) * px, x1 = ((b + 1) * TOWER.bay - 0.66) * px, cw = x1 - x0;
      gm.fillStyle = 'rgba(52,43,34,0.42)'; gm.fillRect(x0, 0, cw, H);
      gm.fillStyle = 'rgba(30,24,19,0.5)'; gm.fillRect(x0, 0, 3, H);            // reveal in shadow
      gm.fillStyle = 'rgba(255,250,240,0.2)'; gm.fillRect(x1 - 2, 0, 2, H);      // lit reveal
      const mull = 0.12 * px, m = 0.08 * px, lw = (cw - 2 * m - mull) / 2;
      for (let f = 0; f < TOWER.floors; f++) {
        const vF = f * TOWER.floor;
        const sill = vF + 0.5, top = sill + 2.5;
        const yb = H - sill * py, yTop = H - top * py;
        for (let k = 0; k < 2; k++) {
          const wx = x0 + m + k * (lw + mull);
          const ys = yTop + archApex(lw, 0.75);
          glassFill(gm, wx, yTop, lw, yb - yTop, '#55616a', '#1b2228');
          archPath(gm, wx, lw, ys, yb, 0.75); gm.fill();
          gm.fillStyle = 'rgba(140,140,130,0.45)';                                   // steel casement bars
          gm.fillRect(wx + lw / 2 - 0.5, ys, 1, yb - ys);
          for (let t = 1; t < 4; t++) gm.fillRect(wx, ys + ((yb - ys) * t) / 4, lw, 1);
          gr.fillStyle = '#383838'; archPath(gr, wx, lw, ys, yb, 0.75); gr.fill();
          ge.fillStyle = '#000'; archPath(ge, wx, lw, ys, yb, 0.75); ge.fill();
          if (r() < 0.36) { ge.fillStyle = litColor(r, 0.35); archPath(ge, wx + 1, lw - 2, ys + 1, yb - 1, 0.75); ge.fill(); }
        }
        // carved spandrel: dark recessed panel with two blind trefoil arches (keeps the channel reading as one stripe)
        const syT = H - (vF + TOWER.floor + 0.5) * py, syB = yTop - 0.06 * py;
        gm.fillStyle = shadeRgb(STONE.cathedral, 0.56); gm.fillRect(x0 + m, syT, cw - 2 * m, syB - syT);
        gm.strokeStyle = 'rgba(210,200,185,0.35)'; gm.lineWidth = 1;
        for (let q = 0; q < 2; q++) {
          const ax = x0 + m + q * (lw + mull) + 3, aw = lw - 6;
          archPath(gm, ax, aw, syT + (syB - syT) * 0.45, syB - 2, 0.9); gm.stroke();
        }
      }
    }
  }, { seed: 3 });

  // ---------------------------------------------------------------- Cathedral: Commons Room storey (tall lancets)
  const COMMONS = { bay: 3.3, bays: 2, h: 20 };
  const cathCommons = painted('cathCommons', 256, 768, COMMONS.bay * COMMONS.bays, COMMONS.h, (gm, ge, gr, W, H, r) => {
    const wM = COMMONS.bay * COMMONS.bays, hM = COMMONS.h, px = W / wM, py = H / hM;
    paintAshlar(gm, W, H, wM, hM, STONE.cathedral, r, { course: 0.6, block: [0.8, 1.7] });
    ge.fillStyle = rgb(62, 50, 36); ge.fillRect(0, 0, W, H);
    // plinth + string course
    gm.fillStyle = shadeRgb(STONE.cathedral, 0.9); gm.fillRect(0, H - 1.0 * py, W, 1.0 * py);
    gm.fillStyle = shadeRgb(STONE.cathedral, 1.1); gm.fillRect(0, H - 15.3 * py, W, 0.35 * py);
    gm.fillStyle = 'rgba(40,32,25,0.3)'; gm.fillRect(0, H - 14.95 * py, W, 3);
    for (let b = 0; b < COMMONS.bays; b++) {
      const w = 2.3 * px, x = (b * COMMONS.bay + COMMONS.bay / 2) * px - w / 2;
      const yb = H - 2.0 * py, ys = H - 11.8 * py;
      const hA = archApex(w, 1.05);
      // hood mould
      gm.strokeStyle = shadeRgb(STONE.cathedral, 0.8); gm.lineWidth = 3;
      archPath(gm, x - 0.2 * px, w + 0.4 * px, ys, yb, 1.05); gm.stroke();
      gm.fillStyle = 'rgba(25,22,18,0.7)'; archPath(gm, x - 2, w + 4, ys, yb, 1.05); gm.fill();
      glassFill(gm, x, ys - hA, w, yb - ys + hA, '#5a5a4e', '#23241f');
      archPath(gm, x, w, ys, yb, 1.05); gm.fill();
      gr.fillStyle = '#404040'; archPath(gr, x, w, ys, yb, 1.05); gr.fill();
      // leaded tracery: 2 mullions, transoms, oculus in the head
      gm.fillStyle = shadeRgb(STONE.cathedral, 0.95);
      for (let m = 1; m < 3; m++) gm.fillRect(x + (w * m) / 3 - 2, ys - hA * 0.3, 4, yb - ys + hA * 0.3);
      for (let t = 1; t < 4; t++) gm.fillRect(x, ys + ((yb - ys) * t) / 4, w, 3);
      gm.strokeStyle = shadeRgb(STONE.cathedral, 0.95); gm.lineWidth = 3;
      gm.beginPath(); gm.arc(x + w / 2, ys - hA * 0.45, w * 0.2, 0, Math.PI * 2); gm.stroke();
      // warm interior glow (Commons Room chandeliers)
      ge.fillStyle = rgb(255, 205, 130, 0.85); archPath(ge, x + 2, w - 4, ys, yb - 2, 1.05); ge.fill();
      ge.fillStyle = 'rgba(0,0,0,0.6)';
      for (let m = 1; m < 3; m++) ge.fillRect(x + (w * m) / 3 - 2, ys - hA, 4, yb - ys + hA);
      for (let t = 1; t < 4; t++) ge.fillRect(x, ys + ((yb - ys) * t) / 4, w, 3);
    }
  }, { seed: 5 });

  // ---------------------------------------------------------------- Cathedral: 4-storey base podium
  const BASE = { bay: 4.2, bays: 4, h: 20 };
  const cathBase = painted('cathBase', 640, 768, BASE.bay * BASE.bays, BASE.h, (gm, ge, gr, W, H, r) => {
    const wM = BASE.bay * BASE.bays, hM = BASE.h, px = W / wM, py = H / hM;
    paintAshlar(gm, W, H, wM, hM, STONE.cathedral, r, { course: 0.6, block: [0.8, 1.9] });
    ge.fillStyle = rgb(55, 44, 32); ge.fillRect(0, 0, W, H);
    gm.fillStyle = shadeRgb(STONE.cathedral, 0.88); gm.fillRect(0, H - 0.9 * py, W, 0.9 * py);
    for (const v of [5.2, 15.8]) { gm.fillStyle = shadeRgb(STONE.cathedral, 1.1); gm.fillRect(0, H - (v + 0.3) * py, W, 0.3 * py); gm.fillStyle = 'rgba(40,32,25,0.3)'; gm.fillRect(0, H - v * py, W, 3); }
    const lit = (x, y, w, h, pathFn) => {
      gr.fillStyle = '#3c3c3c'; pathFn(gr); gr.fill();
      if (r() < 0.32) { ge.fillStyle = litColor(r, 0.3); ge.globalAlpha = 0.8; pathFn(ge); ge.fill(); ge.globalAlpha = 1; }
      else { ge.fillStyle = '#000'; pathFn(ge); ge.fill(); }
    };
    for (let b = 0; b < BASE.bays; b++) {
      const cx = (b * BASE.bay + BASE.bay / 2) * px;
      // ground floor: pointed two-light window
      {
        const w = 2.0 * px, x = cx - w / 2, yb = H - 1.1 * py, ys = H - 4.1 * py;
        gm.strokeStyle = shadeRgb(STONE.cathedral, 0.78); gm.lineWidth = 3;
        archPath(gm, x - 0.18 * px, w + 0.36 * px, ys, yb, 1); gm.stroke();
        glassFill(gm, x, ys - w, w, yb - ys + w); archPath(gm, x, w, ys, yb, 1); gm.fill();
        lit(x, ys, w, yb - ys, (g) => archPath(g, x + 1, w - 2, ys, yb, 1));
        gm.fillStyle = shadeRgb(STONE.cathedral, 0.97); gm.fillRect(cx - 2, ys - archApex(w, 1) * 0.5, 4, yb - ys + archApex(w, 1) * 0.5);
        gm.fillRect(x, ys + (yb - ys) * 0.45, w, 3);
      }
      // upper storeys: Tudor two-light windows with label moulds
      for (const f of [0, 1, 2]) {
        const sill = 6.0 + f * 3.55, top = sill + 2.15;
        const w = 2.1 * px, x = cx - w / 2, yb = H - sill * py, yt = H - top * py;
        gm.fillStyle = 'rgba(30,25,20,0.5)'; gm.fillRect(x - 2, yt - 2, w + 4, yb - yt + 4);
        glassFill(gm, x, yt, w, yb - yt); gm.fillRect(x, yt, w, yb - yt);
        lit(x, yt, w, yb - yt, (g) => { g.beginPath(); g.rect(x + 1, yt + 1, w - 2, yb - yt - 2); });
        gm.fillStyle = shadeRgb(STONE.cathedral, 0.98); gm.fillRect(cx - 3, yt, 6, yb - yt); gm.fillRect(x, yt + (yb - yt) * 0.3, w, 2);
        // label (drip) mould
        gm.fillStyle = shadeRgb(STONE.cathedral, 0.8);
        gm.fillRect(x - 0.18 * px, yt - 0.22 * py, w + 0.36 * px, 3);
        gm.fillRect(x - 0.18 * px, yt - 0.22 * py, 3, 0.45 * py);
        gm.fillRect(x + w + 0.18 * px - 3, yt - 0.22 * py, 3, 0.45 * py);
        gm.fillStyle = shadeRgb(STONE.cathedral, 1.12); gm.fillRect(x - 3, yb, w + 6, 3);
      }
    }
  }, { seed: 7 });

  // ---------------------------------------------------------------- Cathedral: crown storeys (tall pointed openings)
  const CROWN = { bay: 3.3, bays: 2, h: 16 };
  const cathCrown = painted('cathCrown', 256, 640, CROWN.bay * CROWN.bays, CROWN.h, (gm, ge, gr, W, H, r) => {
    const wM = CROWN.bay * CROWN.bays, hM = CROWN.h, px = W / wM, py = H / hM;
    paintAshlar(gm, W, H, wM, hM, STONE.cathedral, r, { course: 0.6, block: [0.7, 1.5], streaks: 0.8 });
    ge.fillStyle = rgb(120, 92, 52); ge.fillRect(0, 0, W, H); // golden flood on the crown
    for (let b = 0; b < CROWN.bays; b++) {
      const w = 2.2 * px, x = (b * CROWN.bay + CROWN.bay / 2) * px - w / 2;
      const yb = H - 0.8 * py, ys = H - 11.0 * py, hA = archApex(w, 1.2);
      gm.fillStyle = 'rgba(40,32,25,0.45)'; archPath(gm, x - 3, w + 6, ys, yb, 1.2); gm.fill();
      glassFill(gm, x, ys - hA, w, yb - ys + hA, '#4d5860', '#1d2328');
      archPath(gm, x, w, ys, yb, 1.2); gm.fill();
      gr.fillStyle = '#3a3a3a'; archPath(gr, x, w, ys, yb, 1.2); gr.fill();
      ge.fillStyle = '#000'; archPath(ge, x, w, ys, yb, 1.2); ge.fill();
      ge.fillStyle = rgb(255, 205, 120, 0.9);
      for (const f of [0, 1, 2]) if (r() < 0.75) ge.fillRect(x + 2, H - (f * 3.6 + 3.9) * py, w - 4, 3.0 * py);
      if (r() < 0.9) { ge.beginPath(); archPath(ge, x + 2, w - 4, ys, H - 10.8 * py, 1.2); ge.fill(); }
      gm.fillStyle = shadeRgb(STONE.cathedral, 1.0);
      gm.fillRect(x + w / 2 - 2, ys - hA * 0.5, 4, yb - ys + hA * 0.5);
      for (const f of [1, 2]) { gm.fillRect(x, H - (f * 3.6 + 0.8) * py, w, 0.35 * py); ge.fillStyle = '#000'; ge.fillRect(x, H - (f * 3.6 + 0.8) * py, w, 0.35 * py); }
      // gablet (wimperg) above the opening
      gm.strokeStyle = shadeRgb(STONE.cathedral, 0.82); gm.lineWidth = 3;
      gm.beginPath(); gm.moveTo(x - 0.35 * px, ys + 0.2 * py); gm.lineTo(x + w / 2, ys - hA - 1.6 * py); gm.lineTo(x + w + 0.35 * px, ys + 0.2 * py); gm.stroke();
    }
  }, { seed: 9 });

  // ---------------------------------------------------------------- pierced parapet / blind arcade
  const parapet = painted('parapet', 128, 128, 2.0, 2.0, (gm, ge, gr, W, H, r) => {
    const px = W / 2, py = H / 2;
    paintAshlar(gm, W, H, 2, 2, STONE.cathedral, r, { course: 0.5, block: [0.6, 1.2], streaks: 0 });
    ge.fillStyle = rgb(80, 64, 44); ge.fillRect(0, 0, W, H);
    for (let k = 0; k < 2; k++) {
      const w = 0.62 * px, x = (k + 0.5) * px - w / 2, yb = H - 0.25 * py, ys = H - 0.95 * py;
      gm.fillStyle = 'rgba(28,24,20,0.8)'; archPath(gm, x, w, ys, yb, 1); gm.fill();
      ge.fillStyle = '#000'; archPath(ge, x, w, ys, yb, 1); ge.fill();
    }
    gm.fillStyle = shadeRgb(STONE.cathedral, 1.12); gm.fillRect(0, H - 1.6 * py, W, 0.14 * py);
  }, { seed: 11 });

  // ---------------------------------------------------------------- Heinz Chapel: nave bay (tall two-light lancet)
  const NAVE = { bay: 4.7, h: 20 };
  function stainedGlass(gm, ge, x, ys, w, yb, r, k, emissive = true) {
    const hA = archApex(w, k);
    const top = ys - hA;
    gm.save(); archPath(gm, x, w, ys, yb, k); gm.clip();
    // daylight: deep jewel tones seen from outside, mostly blue and ruby with a little gold
    const cols = ['#1f3160', '#233a70', '#2a2550', '#5a1e2a', '#1d3f47', '#4d3f22'];
    const ecol = ['#3355ff', '#2f6bff', '#6a4dff', '#ff3040', '#e8a030', '#30b8a0', '#ffd070'];
    const wts = [3, 3, 2, 3, 1, 1, 1];
    const pick = (arr) => { let t = r() * wts.slice(0, arr.length).reduce((a, b) => a + b, 0); for (let i = 0; i < arr.length; i++) { t -= wts[i]; if (t <= 0) return arr[i]; } return arr[0]; };
    const cell = Math.max(4, Math.min(w / 12, 14)); // ~0.3 m panes of glass
    for (let yy = top; yy < yb; yy += cell * 1.4) for (let xx = x; xx < x + w; xx += cell) {
      gm.fillStyle = pick(cols); gm.fillRect(xx, yy, cell + 1, cell * 1.4 + 1);
    }
    gm.fillStyle = 'rgba(10,10,14,0.35)'; gm.fillRect(x, top, w, yb - top);
    gm.strokeStyle = 'rgba(20,20,20,0.55)'; gm.lineWidth = 1;                       // lead lines
    for (let yy = top; yy < yb; yy += cell * 1.4) { gm.beginPath(); gm.moveTo(x, yy); gm.lineTo(x + w, yy); gm.stroke(); }
    gm.restore();
    if (emissive) {
      ge.save(); archPath(ge, x, w, ys, yb, k); ge.clip();
      for (let yy = top; yy < yb; yy += cell * 1.4) for (let xx = x; xx < x + w; xx += cell) {
        ge.fillStyle = pick(ecol); ge.globalAlpha = 0.45 + r() * 0.35; ge.fillRect(xx, yy, cell + 1, cell * 1.4 + 1);
      }
      ge.globalAlpha = 1;
      ge.strokeStyle = 'rgba(0,0,0,0.8)'; ge.lineWidth = 1;
      for (let yy = top; yy < yb; yy += cell * 1.4) { ge.beginPath(); ge.moveTo(x, yy); ge.lineTo(x + w, yy); ge.stroke(); }
      for (let xx = x; xx < x + w; xx += cell) { ge.beginPath(); ge.moveTo(xx, top); ge.lineTo(xx, yb); ge.stroke(); }
      ge.restore();
    }
  }
  const chapelNave = painted('chapelNave', 192, 768, NAVE.bay, NAVE.h, (gm, ge, gr, W, H, r) => {
    const px = W / NAVE.bay, py = H / NAVE.h;
    paintAshlar(gm, W, H, NAVE.bay, NAVE.h, STONE.chapel, r, { course: 0.45, block: [0.6, 1.3], streaks: 0.6 });
    ge.fillStyle = rgb(48, 40, 30); ge.fillRect(0, 0, W, H);
    gm.fillStyle = shadeRgb(STONE.chapel, 0.88); gm.fillRect(0, H - 1.2 * py, W, 1.2 * py);
    gm.fillStyle = shadeRgb(STONE.chapel, 1.1); gm.fillRect(0, H - 3.7 * py, W, 0.25 * py);
    const w = 2.7 * px, x = W / 2 - w / 2, yb = H - 3.9 * py, ys = H - 13.2 * py, k = 1.25;
    gm.strokeStyle = shadeRgb(STONE.chapel, 0.8); gm.lineWidth = 4; archPath(gm, x - 0.25 * px, w + 0.5 * px, ys, yb, k); gm.stroke();
    gm.fillStyle = 'rgba(25,22,20,0.7)'; archPath(gm, x - 3, w + 6, ys, yb, k); gm.fill();
    stainedGlass(gm, ge, x, ys, w, yb, r, k);
    gr.fillStyle = '#353535'; archPath(gr, x, w, ys, yb, k); gr.fill();
    // tracery: central mullion, two sub-lancets and a quatrefoil in the head
    const hA = archApex(w, k);
    gm.fillStyle = shadeRgb(STONE.chapel, 0.97); ge.fillStyle = '#000';
    gm.fillRect(W / 2 - 3, ys - hA * 0.35, 6, yb - ys + hA * 0.35); ge.fillRect(W / 2 - 3, ys - hA * 0.35, 6, yb - ys + hA * 0.35);
    for (const t of [0.33, 0.66]) { gm.fillRect(x, ys + (yb - ys) * t, w, 3); ge.fillRect(x, ys + (yb - ys) * t, w, 3); }
    gm.strokeStyle = shadeRgb(STONE.chapel, 0.97); gm.lineWidth = 3;
    for (const s of [0, 1]) { archPath(gm, x + s * w / 2 + 2, w / 2 - 4, ys + 4, ys + 0.5 * py, 1.1); gm.stroke(); }
    gm.beginPath(); gm.arc(W / 2, ys - hA * 0.55, w * 0.17, 0, Math.PI * 2); gm.stroke();
  }, { seed: 13 });

  // ---------------------------------------------------------------- Heinz Chapel: gable atlas (front facade | transept)
  // Left half: west front, 17 m wide x 32 m. Right half: transept gable, 9 m wide x 32 m. UV = normalised.
  const GABLE = { frontW: 17, transW: 9, h: 32 };
  const chapelGable = painted('chapelGable', 1024, 1024, 1, 1, (gm, ge, gr, W, H, r) => {
    const half = W / 2, py = H / GABLE.h;
    // front
    {
      const px = half / GABLE.frontW;
      paintAshlar(gm, half, H, GABLE.frontW, GABLE.h, STONE.chapel, r, { course: 0.45, block: [0.6, 1.4] });
      ge.fillStyle = rgb(60, 50, 38); ge.fillRect(0, 0, half, H);
      const cx = half / 2;
      // portal: deep recessed orders
      // portal (doors 0-4.4 m, tympanum above, three recessed orders)
      const pw = 4.2 * px, ps = H - 4.6 * py, pb = H - 0.02 * py;
      for (let o = 3; o >= 0; o--) {
        const w = pw + o * 0.5 * px;
        gm.fillStyle = o % 2 ? shadeRgb(STONE.chapel, 0.78 - o * 0.03) : shadeRgb(STONE.chapel, 0.9 - o * 0.03);
        archPath(gm, cx - w / 2, w, ps, pb, 1); gm.fill();
      }
      gm.fillStyle = shadeRgb(STONE.chapel, 0.95); archPath(gm, cx - pw / 2, pw, ps, H - 4.4 * py, 1); gm.fill(); // tympanum
      gm.fillStyle = 'rgba(60,50,40,0.5)'; for (let i = 0; i < 5; i++) gm.fillRect(cx - pw * 0.35 + i * pw * 0.17, H - 6.4 * py, pw * 0.08, 1.6 * py); // carved figures
      gm.fillStyle = '#4a3322'; gm.fillRect(cx - pw / 2, H - 4.4 * py, pw, 4.4 * py); // oak doors
      gm.fillStyle = '#2e2016'; gm.fillRect(cx - 2, H - 4.4 * py, 4, 4.4 * py);
      for (let i = 0; i < 6; i++) gm.fillRect(cx - pw / 2, H - (0.6 + i * 0.66) * py, pw, 2);
      // gallery of small niches over the portal, between string courses
      gm.fillStyle = shadeRgb(STONE.chapel, 1.1); gm.fillRect(0, H - 10.2 * py, half, 0.3 * py); gm.fillRect(0, H - 11.9 * py, half, 0.25 * py);
      for (let i = -4; i <= 4; i++) { const nx = cx + i * 1.2 * px - 0.3 * px; gm.fillStyle = 'rgba(40,35,30,0.55)'; archPath(gm, nx, 0.6 * px, H - 11.2 * py, H - 10.3 * py, 1); gm.fill(); }
      // great west window
      const ww = 6.4 * px, wx = cx - ww / 2, wys = H - 17.6 * py, wyb = H - 12.3 * py;
      gm.strokeStyle = shadeRgb(STONE.chapel, 0.78); gm.lineWidth = 5; archPath(gm, wx - 0.35 * px, ww + 0.7 * px, wys, wyb, 1); gm.stroke();
      stainedGlass(gm, ge, wx, wys, ww, wyb, r, 1);
      gr.fillStyle = '#353535'; archPath(gr, wx, ww, wys, wyb, 1); gr.fill();
      gm.fillStyle = shadeRgb(STONE.chapel, 0.97); ge.fillStyle = '#000';
      for (let m = 1; m < 4; m++) { gm.fillRect(wx + (ww * m) / 4 - 2, wys - 1.5 * py, 5, wyb - wys + 1.5 * py); ge.fillRect(wx + (ww * m) / 4 - 2, wys - 1.5 * py, 5, wyb - wys + 1.5 * py); }
      gm.fillRect(wx, wys + (wyb - wys) * 0.5, ww, 3);
      gm.strokeStyle = shadeRgb(STONE.chapel, 0.97); gm.lineWidth = 4;
      gm.beginPath(); gm.arc(cx, wys - archApex(ww, 1) * 0.5, ww * 0.2, 0, Math.PI * 2); gm.stroke();
      // oculus in gable
      gm.fillStyle = 'rgba(30,28,26,0.7)'; gm.beginPath(); gm.arc(cx, H - 26 * py, 1.2 * px, 0, Math.PI * 2); gm.fill();
      ge.fillStyle = rgb(255, 180, 90); ge.beginPath(); ge.arc(cx, H - 26 * py, 1.0 * px, 0, Math.PI * 2); ge.fill();
    }
    // transept
    {
      const x0 = half, px = half / GABLE.transW;
      gm.save(); gm.translate(x0, 0);
      paintAshlar(gm, half, H, GABLE.transW, GABLE.h, STONE.chapel, r, { course: 0.45, block: [0.6, 1.4] });
      gm.restore();
      ge.fillStyle = rgb(60, 50, 38); ge.fillRect(x0, 0, half, H);
      const ww = 5.0 * px, wx = x0 + half / 2 - ww / 2, wys = H - 20.5 * py, wyb = H - 2.6 * py;
      gm.strokeStyle = shadeRgb(STONE.chapel, 0.78); gm.lineWidth = 6; archPath(gm, wx - 0.3 * px, ww + 0.6 * px, wys, wyb, 1.1); gm.stroke();
      gm.fillStyle = 'rgba(25,22,20,0.7)'; archPath(gm, wx - 3, ww + 6, wys, wyb, 1.1); gm.fill();
      stainedGlass(gm, ge, wx, wys, ww, wyb, r, 1.1);
      gr.fillStyle = '#353535'; archPath(gr, wx, ww, wys, wyb, 1.1); gr.fill();
      gm.fillStyle = shadeRgb(STONE.chapel, 0.97); ge.fillStyle = '#000';
      for (let m = 1; m < 3; m++) { gm.fillRect(wx + (ww * m) / 3 - 3, wys - 2 * py, 6, wyb - wys + 2 * py); ge.fillRect(wx + (ww * m) / 3 - 3, wys - 2 * py, 6, wyb - wys + 2 * py); }
      for (let t = 1; t < 6; t++) { gm.fillRect(wx, wys + ((wyb - wys) * t) / 6, ww, 4); ge.fillRect(wx, wys + ((wyb - wys) * t) / 6, ww, 4); }
      gm.strokeStyle = shadeRgb(STONE.chapel, 0.97); gm.lineWidth = 5;
      gm.beginPath(); gm.arc(x0 + half / 2, wys - archApex(ww, 1.1) * 0.5, ww * 0.22, 0, Math.PI * 2); gm.stroke();
      gm.fillStyle = shadeRgb(STONE.chapel, 0.88); gm.fillRect(x0, H - 1.2 * py, half, 1.2 * py);
    }
  }, { wrap: false, seed: 17 });

  // ---------------------------------------------------------------- Mellon Institute: wall bay behind the colonnade
  const MBAY = { bay: 4.1, bays: 4, h: 12 };
  const mellonBay = painted('mellonBay', 640, 576, MBAY.bay * MBAY.bays, MBAY.h, (gm, ge, gr, W, H, r) => {
    const wM = MBAY.bay * MBAY.bays, px = W / wM, py = H / MBAY.h;
    paintAshlar(gm, W, H, wM, MBAY.h, STONE.mellon, r, { course: 0.75, block: [1.2, 2.4], vary: 0.025, streaks: 0.3, joint: 0.07 });
    ge.fillStyle = rgb(40, 34, 26); ge.fillRect(0, 0, W, H);
    const floors = [[1.1, 3.9], [4.7, 7.5], [8.3, 10.9]];
    for (let b = 0; b < MBAY.bays; b++) {
      const cx = (b + 0.5) * MBAY.bay * px, ww = 2.25 * px, x = cx - ww / 2, yb = H - 1.1 * py, yt = H - 10.9 * py;
      // moulded stone surround
      gm.fillStyle = shadeRgb(STONE.mellon, 1.06); gm.fillRect(x - 0.28 * px, yt - 0.28 * py, ww + 0.56 * px, yb - yt + 0.56 * py);
      gm.fillStyle = 'rgba(60,50,40,0.35)'; gm.fillRect(x - 3, yt - 3, ww + 6, yb - yt + 6);
      // three storeys: aluminium windows with dark cast-metal spandrels
      gm.fillStyle = '#5b5750'; gm.fillRect(x, yt, ww, yb - yt);
      for (const [a0, a1] of floors) {
        const y0 = H - a1 * py, y1 = H - a0 * py;
        gm.fillStyle = '#9ea3a6'; gm.fillRect(x, y0, ww, y1 - y0);
        glassFill(gm, x + 3, y0 + 3, ww - 6, y1 - y0 - 6, '#5d6b75', '#222b31'); gm.fillRect(x + 3, y0 + 3, ww - 6, y1 - y0 - 6);
        gm.fillStyle = '#a7abae';
        for (const t of [1 / 3, 2 / 3]) gm.fillRect(x + ww * t - 1.5, y0, 3, y1 - y0);
        gm.fillRect(x, y0 + (y1 - y0) * 0.62, ww, 2);
        gr.fillStyle = '#303030'; gr.fillRect(x + 3, y0 + 3, ww - 6, y1 - y0 - 6);
        // lab lighting: a few windows lit, per light (three lights per storey)
        for (let l = 0; l < 3; l++) {
          if (r() < 0.38) {
            const cool = r() < 0.55;
            ge.fillStyle = cool ? rgb(205, 215, 225, 0.55 + r() * 0.2) : rgb(245, 205, 150, 0.55 + r() * 0.25);
            ge.fillRect(x + 4 + (ww - 8) * l / 3, y0 + 4, (ww - 8) / 3 - 3, y1 - y0 - 8);
          }
        }
      }
      gm.strokeStyle = 'rgba(190,180,160,0.4)'; gm.lineWidth = 2;
      for (const v of [3.9, 7.5]) {
        const y0 = H - (v + 0.8) * py, y1 = H - v * py;
        gm.strokeRect(x + 5, y0 + 3, ww - 10, y1 - y0 - 6);
        for (let i = 0; i < 4; i++) { gm.beginPath(); gm.arc(x + ww * (0.2 + i * 0.2), (y0 + y1) / 2, (y1 - y0) * 0.22, 0, Math.PI * 2); gm.stroke(); }
      }
    }
  }, { seed: 19 });

  // ---------------------------------------------------------------- Mellon Institute: Ionic entablature strip
  // v = 0 at the architrave soffit: architrave (three fasciae) 0-1.2, frieze 1.2-2.3, cornice 2.3-3.0 m.
  const ENTAB = { w: 0.8, h: 3.2 };
  const mellonEntab = painted('mellonEntab', 128, 512, ENTAB.w, ENTAB.h, (gm, ge, gr, W, H, r) => {
    const px = W / ENTAB.w, py = H / ENTAB.h, Y = (v) => H - v * py;
    gm.fillStyle = STONE.mellon; gm.fillRect(0, 0, W, H);
    speckle(gm, W, H);
    ge.fillStyle = rgb(70, 58, 42); ge.fillRect(0, 0, W, H);
    const band = (v0, v1, f) => { gm.fillStyle = shadeRgb(STONE.mellon, f); gm.fillRect(0, Y(v1), W, Y(v0) - Y(v1)); };
    const line = (v, a = 0.35, t = 2) => { gm.fillStyle = `rgba(50,42,32,${a})`; gm.fillRect(0, Y(v) - t / 2, W, t); };
    // architrave fasciae: each band lit on top, shadowed at its foot
    band(0, 0.34, 0.93); band(0.34, 0.72, 0.97); band(0.72, 1.08, 1.0);
    for (const v of [0.34, 0.72, 1.08]) { line(v, 0.45, 2); gm.fillStyle = 'rgba(255,250,240,0.35)'; gm.fillRect(0, Y(v) + 1, W, 1); }
    // bead-and-reel moulding
    band(1.08, 1.2, 1.05);
    for (let x = 0; x < W; x += 0.1 * px) { gm.fillStyle = 'rgba(60,50,40,0.35)'; gm.fillRect(x, Y(1.17), 2, 0.07 * py); }
    // frieze (plain, faint block joints)
    band(1.2, 2.3, 1.02); line(1.2, 0.5, 3);
    gm.fillStyle = 'rgba(60,50,40,0.12)'; gm.fillRect(W * 0.62, Y(2.3), 1, 1.1 * py);
    // cornice: egg-and-dart, dentils, corona, cyma
    band(2.3, 2.42, 0.9);
    for (let x = 0; x < W; x += 0.16 * px) { gm.fillStyle = 'rgba(60,50,40,0.45)'; gm.beginPath(); gm.ellipse(x + 0.08 * px, Y(2.36), 0.045 * px, 0.05 * py, 0, 0, Math.PI * 2); gm.fill(); }
    band(2.42, 2.62, 1.03);
    for (let x = 0; x < W; x += 0.2 * px) { gm.fillStyle = 'rgba(40,34,26,0.7)'; gm.fillRect(x + 0.12 * px, Y(2.62), 0.07 * px, 0.2 * py); }
    band(2.62, 2.9, 1.08); line(2.62, 0.6, 3);
    band(2.9, 3.0, 0.95); line(2.9, 0.3, 2);
    gm.fillStyle = 'rgba(255,250,240,0.3)'; gm.fillRect(0, Y(3.0), W, 2);
    band(3.0, 3.2, 1.0);
  }, { seed: 29 });

  // ---------------------------------------------------------------- Mellon Institute: monolithic column stone (tile 3 m x 12 m)
  const colStone = painted('mellonColumn', 128, 512, 3, 12, (gm, ge, gr, W, H, r) => {
    gm.fillStyle = STONE.mellon; gm.fillRect(0, 0, W, H);
    speckle(gm, W, H); speckle(gm, W, H);
    for (let i = 0; i < 6; i++) { gm.fillStyle = `rgba(120,105,85,${0.04 + r() * 0.04})`; gm.fillRect(r() * W, 0, 2 + r() * 6, H); }
    const grd = gm.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(60,50,40,0.12)');
    gm.fillStyle = grd; gm.fillRect(0, 0, W, H);
    // uplight: bright at the foot, fading up the shaft
    const eg = ge.createLinearGradient(0, H, 0, 0);
    eg.addColorStop(0, rgb(255, 214, 160)); eg.addColorStop(0.35, rgb(170, 130, 90)); eg.addColorStop(1, rgb(60, 45, 30));
    ge.fillStyle = eg; ge.fillRect(0, 0, W, H);
    gr.fillStyle = '#b8b8b8'; gr.fillRect(0, 0, W, H);
  }, { seed: 23 });

  // ---------------------------------------------------------------- sedum green roof
  const sedumCanvas = canvas(128, 128);
  {
    const g = sedumCanvas.getContext('2d'), r = seeded(991);
    g.fillStyle = '#6f7a3a'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 1400; i++) { g.fillStyle = ['#7f8c40', '#5d6b2e', '#8a7a3c', '#9a5a3a', '#6e8a44'][(r() * 5) | 0]; g.fillRect(r() * 128, r() * 128, 2 + r() * 3, 2 + r() * 3); }
  }

  // ---------------------------------------------------------------- St. Paul Cathedral: wall bay (aisle + clerestory)
  // One 5 m bay, v = 0 at the facade ground: a two-light aisle lancet (sill 3.4, apex ~11.5 m, under the 13 m
  // aisle eaves) and a three-light clerestory lancet (sill 19.4, apex ~24.6 m, under the 25 m nave eaves).
  // The tile is 28 m tall: the top 2.8 m is plain plinth course, which is what shows where the walls continue
  // below the facade ground on the lower (rear, west) side of the site (v < 0 wraps to the top of the tile).
  const SPW = { bay: 5.0, h: 28 };
  const spWall = painted('spWall', 192, 1024, SPW.bay, SPW.h, (gm, ge, gr, W, H, r) => {
    const px = W / SPW.bay, py = H / SPW.h, Yp = (v) => H - v * py;
    paintAshlar(gm, W, H, SPW.bay, SPW.h, STONE.stpaul, r, { course: 0.5, block: [0.6, 1.4], streaks: 0.9 });
    ge.fillStyle = rgb(60, 50, 38); ge.fillRect(0, 0, W, H);
    gm.fillStyle = shadeRgb(STONE.stpaul, 0.84); gm.fillRect(0, Yp(1.1), W, 1.1 * py); gm.fillRect(0, 0, W, 2.3 * py); // plinth
    for (const v of [3.0, 12.4, 18.8, 25.2]) { // sill / string courses
      gm.fillStyle = shadeRgb(STONE.stpaul, 1.1); gm.fillRect(0, Yp(v + 0.26), W, 0.26 * py);
      gm.fillStyle = 'rgba(40,34,28,0.35)'; gm.fillRect(0, Yp(v), W, 3);
    }
    const win = (w, sill, spring, k, lights) => {
      const ww = w * px, x = W / 2 - ww / 2, yb = Yp(sill), ys = Yp(spring), hA = archApex(ww, k);
      gm.strokeStyle = shadeRgb(STONE.stpaul, 0.76); gm.lineWidth = 4; archPath(gm, x - 0.22 * px, ww + 0.44 * px, ys, yb, k); gm.stroke();
      gm.fillStyle = 'rgba(25,22,20,0.7)'; archPath(gm, x - 3, ww + 6, ys, yb, k); gm.fill();
      stainedGlass(gm, ge, x, ys, ww, yb, r, k);
      gr.fillStyle = '#353535'; archPath(gr, x, ww, ys, yb, k); gr.fill();
      gm.fillStyle = shadeRgb(STONE.stpaul, 0.97); ge.fillStyle = '#000';
      for (let m = 1; m < lights; m++) {
        const mx = x + (ww * m) / lights - 2;
        gm.fillRect(mx, ys - hA * 0.3, 4, yb - ys + hA * 0.3); ge.fillRect(mx, ys - hA * 0.3, 4, yb - ys + hA * 0.3);
      }
      gm.fillRect(x, ys + (yb - ys) * 0.5, ww, 3); ge.fillRect(x, ys + (yb - ys) * 0.5, ww, 3);
      gm.strokeStyle = shadeRgb(STONE.stpaul, 0.97); gm.lineWidth = 3;
      gm.beginPath(); gm.arc(W / 2, ys - hA * 0.5, ww * 0.18, 0, Math.PI * 2); gm.stroke();
    };
    win(2.5, 3.4, 9.2, 1.1, 2);
    win(2.7, 19.4, 22.2, 1.05, 3);
  }, { seed: 31 });

  // ---------------------------------------------------------------- St. Paul Cathedral: rose window (UV 0..1 disc)
  const spRose = painted('spRose', 256, 256, 1, 1, (gm, ge, gr, W, H, r) => {
    const cx = W / 2, cy = H / 2, R = W / 2, N = 16;
    gm.fillStyle = shadeRgb(STONE.stpaul, 0.95); gm.fillRect(0, 0, W, H);
    ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
    gr.fillStyle = '#353535'; gr.fillRect(0, 0, W, H);
    const cols = ['#1f3160', '#233a70', '#5a1e2a', '#2a2550', '#1d3f47', '#4d3f22'];
    const ecol = ['#3355ff', '#2f6bff', '#ff3040', '#6a4dff', '#30b8a0', '#ffd070'];
    for (let ring = 0; ring < 5; ring++) {
      const r0 = R * (0.1 + ring * 0.17), r1 = Math.min(R * 0.94, r0 + R * 0.17);
      for (let k = 0; k < N * 2; k++) {
        const a0 = (k / (N * 2)) * Math.PI * 2, a1 = ((k + 1) / (N * 2)) * Math.PI * 2;
        const ci = (r() * cols.length) | 0, al = 0.5 + r() * 0.4;
        for (const [g, c, alpha] of [[gm, cols[ci], 1], [ge, ecol[ci], al]]) {
          g.globalAlpha = alpha; g.fillStyle = c;
          g.beginPath(); g.arc(cx, cy, r1, a0, a1); g.arc(cx, cy, r0, a1, a0, true); g.closePath(); g.fill();
        }
        gm.globalAlpha = ge.globalAlpha = 1;
      }
    }
    gm.fillStyle = 'rgba(10,10,14,0.3)'; gm.beginPath(); gm.arc(cx, cy, R * 0.94, 0, Math.PI * 2); gm.fill();
    // stone tracery: rim, hub, 16 spokes and a crown of foiled circles
    for (const g of [gm, ge]) {
      g.strokeStyle = g === gm ? shadeRgb(STONE.stpaul, 1.02) : '#000';
      g.lineWidth = 8; g.beginPath(); g.arc(cx, cy, R * 0.95, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 5; g.beginPath(); g.arc(cx, cy, R * 0.3, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 4;
      for (let k = 0; k < N; k++) {
        const a = (k / N) * Math.PI * 2;
        g.beginPath(); g.moveTo(cx + Math.cos(a) * R * 0.3, cy + Math.sin(a) * R * 0.3); g.lineTo(cx + Math.cos(a) * R * 0.94, cy + Math.sin(a) * R * 0.94); g.stroke();
      }
      g.lineWidth = 3;
      for (let k = 0; k < N; k++) {
        const a = ((k + 0.5) / N) * Math.PI * 2;
        g.beginPath(); g.arc(cx + Math.cos(a) * R * 0.76, cy + Math.sin(a) * R * 0.76, R * 0.11, 0, Math.PI * 2); g.stroke();
      }
      g.beginPath(); g.arc(cx, cy, R * 0.12, 0, Math.PI * 2); g.stroke();
    }
  }, { wrap: false, seed: 37 });

  const mats = {
    // St. Paul Cathedral
    spWall: facadeMat('spWall', spWall, { night: 0.8 }),
    spRose: facadeMat('spRose', spRose, { night: 0.9 }),
    spStone: stoneMat('spStone', STONE.stpaul, 0.07, '#ffd8a8', 3),
    // cathedral
    cathTower: facadeMat('cathTower', cathTower),
    cathCommons: facadeMat('cathCommons', cathCommons, { night: 1.2 }),
    cathBase: facadeMat('cathBase', cathBase),
    cathCrown: facadeMat('cathCrown', cathCrown, { night: 1.5 }),
    cathParapet: facadeMat('cathParapet', parapet),
    cathStone: stoneMat('cathStone', STONE.cathedral, 0.1),
    cathCrownStone: stoneMat('cathCrownStone', STONE.cathedral, 0.32, '#ffc878'),
    // chapel
    chapelNave: facadeMat('chapelNave', chapelNave, { night: 0.75 }),
    chapelGable: facadeMat('chapelGable', chapelGable, { night: 0.75 }),
    chapelStone: stoneMat('chapelStone', STONE.chapel, 0.08),
    // mellon
    mellonBay: facadeMat('mellonBay', mellonBay, { night: 0.9 }),
    mellonEntab: facadeMat('mellonEntab', mellonEntab, { night: 0.9 }),
    mellonStone: stoneMat('mellonStone', STONE.mellon, 0.07, '#ffd8a8', 3),
    mellonFloor: (() => { const m = stoneMat('mellonFloor', '#b9b2a4', 0, '#000000', 2); return m; })(),
    mellonColumn: (() => {
      const m = new THREE.MeshStandardMaterial({ map: colStone.map, emissiveMap: colStone.emissiveMap, roughness: 0.62, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0 });
      m.name = 'oaklandA-mellonColumn';
      M.registerNightMaterial(m, 0.55);
      return m;
    })(),
    sedum: new THREE.MeshStandardMaterial({ map: tex(sedumCanvas, 3, 3), roughness: 1 }),
    // shared presets / plain colours
    roof: M.get('flatRoof'),
    slate: M.get('slateRoof'),
    copper: M.get('copperRoof'),
    bronze: M.get('bronze'),
    lead: M.color('#7c8388', { roughness: 0.42, metalness: 0.6 }),
    dark: M.color('#3b3029', { roughness: 0.7 }),
    oak: M.color('#4a3322', { roughness: 0.65 }),
    gold: M.get('gold'),
    darkMetal: M.get('darkMetal'),
    glassDark: M.get('glassDark'),
  };
  mats.sedum.name = 'oaklandA-sedum';
  const out = { mats, dims: { TOWER, COMMONS, BASE, CROWN, NAVE, GABLE, MBAY, ENTAB, SPW } };
  CACHE.set(M, out);
  return out;
}
