// Canvas-painted textures + cached materials for the Oakland-B landmarks
// (Carnegie Institute complex, Dippy, Phipps Conservatory). All textures expect UVs in metres.
import * as THREE from 'three';

const CACHE = new WeakMap(); // ctx.materials → Map

function cacheFor(ctx) {
  let m = CACHE.get(ctx.materials);
  if (!m) { m = new Map(); CACHE.set(ctx.materials, m); }
  return m;
}
function cached(ctx, key, make) {
  const c = cacheFor(ctx);
  if (!c.has(key)) c.set(key, make());
  return c.get(key);
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function hexShade(hex, f) {
  const c = new THREE.Color(hex);
  const hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * f)));
  return `#${c.getHexString()}`;
}
/** Free the (large) source canvas once three.js has uploaded it to the GPU — the texture is never re-uploaded. */
function releaseAfterUpload(t) {
  t.onUpdate = () => {
    t.onUpdate = null;
    const img = t.image;
    if (img && typeof img.getContext === 'function') { img.width = 1; img.height = 1; }
  };
  return t;
}
function tex(ctx, cnv, repW, repH, color = true) {
  const t = new THREE.CanvasTexture(cnv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / repW, 1 / repH);
  t.anisotropy = Math.min(8, ctx.renderer?.capabilities?.getMaxAnisotropy?.() ?? 4);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return releaseAfterUpload(t);
}
/**
 * Black/white speckle (weathering grain) over the rectangle (x, y, w, h). Painted once into a small wrapping tile
 * through ImageData and laid down as a repeating pattern: two canvas calls instead of tens of thousands of
 * fillRects. Density matches the old per-speckle painter: `count` speckles over w*h (default w*h/size²/3).
 * The tile (≤ 256 px) divides the power-of-two / 1536 px canvases it is used on, so their tiling stays seamless.
 */
function noise(g, w, h, r, alpha, size = 2, count = null, x = 0, y = 0) {
  const tw = Math.min(256, w), th = Math.min(256, h);
  const n = Math.round((count ?? (w * h) / (size * size) / 3) * (tw * th) / (w * h));
  const tile = canvas(tw, th), tg = tile.getContext('2d');
  const img = tg.createImageData(tw, th), d = img.data;
  for (let i = 0; i < n; i++) {
    const v = r() > 0.5 ? 255 : 0, a = Math.round(255 * alpha * r());
    const px = Math.floor(r() * tw), py = Math.floor(r() * th);
    for (let dy = 0; dy < size; dy++) {
      const row = ((py + dy) % th) * tw;
      for (let dx = 0; dx < size; dx++) {
        const k = (row + ((px + dx) % tw)) * 4;
        d[k] = d[k + 1] = d[k + 2] = v; d[k + 3] = a;
      }
    }
  }
  tg.putImageData(img, 0, 0);
  g.save();
  g.fillStyle = g.createPattern(tile, 'repeat');
  g.fillRect(x, y, w, h);
  g.restore();
}

// ------------------------------------------------------------------------------------------------ Carnegie facade
// Frieze names: the 1907 extension has names of authors, artists, musicians and scientists carved in its entablature.
const NAMES = ['SHAKESPEARE', 'MICHELANGELO', 'BACH', 'GALILEO', 'BEETHOVEN', 'NEWTON', 'DANTE', 'RAPHAEL',
  'MOZART', 'DARWIN', 'HOMER', 'REMBRANDT', 'HANDEL', 'FRANKLIN', 'MILTON', 'TITIAN', 'HAYDN', 'COPERNICUS'];

export const FACADE = {
  bay: 6, bays: 6, height: 20,
  plinth: 0.8, rustTop: 7.2, string: 7.9, archBot: 16.2, friezeBot: 16.9, friezeTop: 18.2, wallTop: 19.2,
};

/**
 * Beaux-Arts sandstone wall for the Carnegie Institute: rusticated ground floor, smooth upper storey with pilasters and
 * tall mullioned windows, architrave, frieze with carved names. One texture tile = 6 bays x 20 m; v = 0 at floor level.
 * variant: 'museum' (1907 Forbes Ave extension) | 'library' (1895 Italian Renaissance, arched upper windows).
 */
export function carnegieFacade(ctx, variant = 'museum') {
  return cached(ctx, `facade:${variant}`, () => {
    const F = FACADE;
    const tileW = F.bay * F.bays, tileH = F.height;
    const W = 1536, H = 1024;
    const pu = W / tileW, pv = H / tileH;
    const X = (u) => u * pu, Y = (v) => H - v * pv;
    const r = rng(variant === 'library' ? 911 : 407);
    const base = variant === 'library' ? '#b8ae95' : '#bcb298';
    const c = canvas(W, H), g = c.getContext('2d');
    const ce = canvas(768, 512), ge = ce.getContext('2d');
    const eu = 768 / tileW, ev = 512 / tileH;
    ge.fillStyle = '#000'; ge.fillRect(0, 0, 768, 512);
    // night: warm floodlight wash from ground-level uplights, fading towards the cornice, brighter on the pilasters
    {
      const wash = ge.createLinearGradient(0, 512, 0, 0);
      wash.addColorStop(0, 'rgba(255,214,160,0.20)');
      wash.addColorStop(0.18, 'rgba(255,214,160,0.12)');
      wash.addColorStop(0.55, 'rgba(255,214,160,0.06)');
      wash.addColorStop(1, 'rgba(255,214,160,0.035)');
      ge.fillStyle = wash; ge.fillRect(0, 0, 768, 512);
      for (let b = 0; b <= F.bays; b++) {
        const x = b * F.bay * eu;
        const beam = ge.createLinearGradient(0, 512, 0, 512 - F.archBot * ev);
        beam.addColorStop(0, 'rgba(255,220,170,0.16)'); beam.addColorStop(1, 'rgba(255,220,170,0)');
        ge.fillStyle = beam; ge.fillRect(x - 0.6 * eu, 512 - F.archBot * ev, 1.2 * eu, F.archBot * ev);
      }
    }

    // smooth ashlar background
    g.fillStyle = base; g.fillRect(0, 0, W, H);
    // courses (upper storey): 0.6 m courses, staggered 1.2 m blocks
    for (let v = F.string, row = 0; v < F.wallTop + 1; v += 0.6, row++) {
      for (let u = -(row % 2) * 0.6; u < tileW; u += 1.2) {
        g.fillStyle = hexShade(base, 0.97 + r() * 0.06);
        g.fillRect(X(u) + 1, Y(v + 0.6) + 1, 1.2 * pu - 1, 0.6 * pv - 1);
      }
      g.fillStyle = 'rgba(90,80,60,0.28)';
      g.fillRect(0, Y(v), W, 1.2);
    }
    // rusticated ground floor: deep channelled courses (pillow blocks)
    for (let v = F.plinth, row = 0; v < F.rustTop - 0.01; v += 0.64, row++) {
      const top = Math.min(v + 0.64, F.rustTop);
      for (let u = -(row % 2) * 0.75; u < tileW; u += 1.5) {
        const x0 = X(u), x1 = X(u + 1.5), y0 = Y(top), y1 = Y(v);
        g.fillStyle = hexShade(base, 0.93 + r() * 0.07);
        g.fillRect(x0, y0, x1 - x0, y1 - y0);
        // pillow shading: light top-left, dark bottom-right
        g.fillStyle = 'rgba(255,250,235,0.35)'; g.fillRect(x0 + 2, y0 + 2, x1 - x0 - 4, 2);
        g.fillStyle = 'rgba(40,32,20,0.45)'; g.fillRect(x0, y1 - 4, x1 - x0, 4);
        g.fillStyle = 'rgba(40,32,20,0.35)'; g.fillRect(x1 - 3, y0, 3, y1 - y0);
      }
    }
    // plinth (darker, weathered)
    g.fillStyle = hexShade(base, 0.8); g.fillRect(0, Y(F.plinth), W, F.plinth * pv);
    g.fillStyle = 'rgba(255,250,235,0.35)'; g.fillRect(0, Y(F.plinth), W, 2);
    // string course
    g.fillStyle = hexShade(base, 1.07); g.fillRect(0, Y(F.string), W, (F.string - F.rustTop) * pv);
    g.fillStyle = 'rgba(40,32,20,0.5)'; g.fillRect(0, Y(F.rustTop) - 3, W, 5);
    g.fillStyle = 'rgba(255,250,235,0.4)'; g.fillRect(0, Y(F.string), W, 2);

    const glass = (x, y, w, h, lit) => {
      const grd = g.createLinearGradient(x, y, x + w * 0.4, y + h);
      grd.addColorStop(0, '#6d808c'); grd.addColorStop(0.5, '#34424c'); grd.addColorStop(1, '#222b31');
      g.fillStyle = grd; g.fillRect(x, y, w, h);
      if (lit) {
        const ex = (x / pu) * eu, ey = (y / pv) * ev, ew = (w / pu) * eu, eh = (h / pv) * ev;
        ge.fillStyle = `rgba(255,${200 + ((r() * 30) | 0)},${130 + ((r() * 40) | 0)},${0.65 + r() * 0.35})`;
        ge.fillRect(ex, ey, ew, eh);
      }
    };
    const shadowBox = (x, y, w, h, d = 5) => {
      g.fillStyle = 'rgba(30,24,15,0.55)'; g.fillRect(x - d, y - d, w + d * 2, h + d * 2);
    };

    for (let b = 0; b < F.bays; b++) {
      const cx = (b + 0.5) * F.bay;
      // ---- pilasters at bay edges (upper storey)
      const px = b * F.bay;
      for (const edge of [px, px + F.bay]) {
        if (edge === px + F.bay && b < F.bays - 1) continue;
        const x0 = X(edge - 0.45), x1 = X(edge + 0.45);
        g.fillStyle = hexShade(base, 1.06); g.fillRect(x0, Y(F.archBot), x1 - x0, (F.archBot - F.string) * pv);
        g.fillStyle = 'rgba(255,250,235,0.35)'; g.fillRect(x0, Y(F.archBot), 3, (F.archBot - F.string) * pv);
        g.fillStyle = 'rgba(40,32,20,0.35)'; g.fillRect(x1 - 4, Y(F.archBot), 4, (F.archBot - F.string) * pv);
        // capital band
        g.fillStyle = hexShade(base, 1.1); g.fillRect(x0 - 4, Y(F.archBot), x1 - x0 + 8, 0.45 * pv);
        g.fillStyle = 'rgba(40,32,20,0.4)'; g.fillRect(x0 - 4, Y(F.archBot - 0.45), x1 - x0 + 8, 3);
      }
      // ---- ground floor window with flat arch and keystone
      {
        const w = 1.7, y0 = 2.4, y1 = 5.6;
        const x = X(cx - w / 2), yT = Y(y1), ww = w * pu, hh = (y1 - y0) * pv;
        shadowBox(x, yT, ww, hh, 5);
        glass(x, yT, ww, hh, r() < 0.3);
        g.fillStyle = '#4b463d';
        for (let k = 1; k < 3; k++) g.fillRect(x + (ww * k) / 3 - 1.5, yT, 3, hh);
        for (let k = 1; k < 4; k++) g.fillRect(x, yT + (hh * k) / 4 - 1.5, ww, 3);
        // voussoirs
        const ay0 = Y(y1 + 0.85), ay1 = Y(y1);
        g.fillStyle = hexShade(base, 1.04); g.fillRect(x - 0.35 * pu, ay0, ww + 0.7 * pu, ay1 - ay0);
        g.strokeStyle = 'rgba(60,50,35,0.55)'; g.lineWidth = 1.5;
        for (let k = -4; k <= 4; k++) {
          const bx = X(cx + k * 0.24);
          g.beginPath(); g.moveTo(bx, ay1); g.lineTo(bx + k * 3, ay0); g.stroke();
        }
        g.fillStyle = hexShade(base, 1.12); g.fillRect(X(cx - 0.28), Y(y1 + 1.05), 0.56 * pu, 1.05 * pv);
        g.fillStyle = 'rgba(40,32,20,0.4)'; g.fillRect(X(cx + 0.28) - 3, Y(y1 + 1.05), 3, 1.05 * pv);
        // sill
        g.fillStyle = hexShade(base, 1.1); g.fillRect(x - 6, Y(y0), ww + 12, 0.18 * pv);
        g.fillStyle = 'rgba(40,32,20,0.45)'; g.fillRect(x - 6, Y(y0 - 0.18), ww + 12, 3);
      }
      // ---- upper storey window
      {
        const w = 2.4, y0 = 8.8, yMid0 = 12.3, yMid1 = 13.0, y1 = 15.3;
        const x = X(cx - w / 2), ww = w * pu;
        // moulded surround
        g.fillStyle = hexShade(base, 1.08);
        g.fillRect(x - 0.25 * pu, Y(y1 + 0.25), ww + 0.5 * pu, (y1 - y0 + 0.5) * pv);
        g.fillStyle = 'rgba(40,32,20,0.35)'; g.fillRect(x + ww + 0.25 * pu - 3, Y(y1 + 0.25), 3, (y1 - y0 + 0.5) * pv);
        const lit = r() < 0.35;
        if (variant === 'library') {
          // round-headed window
          const rad = w / 2, yT = y1 - rad;
          g.save();
          g.beginPath();
          g.moveTo(x, Y(y0)); g.lineTo(x, Y(yT));
          g.ellipse(X(cx), Y(yT), rad * pu, rad * pv, 0, Math.PI, 0);
          g.lineTo(x + ww, Y(y0)); g.closePath();
          g.fillStyle = 'rgba(30,24,15,0.6)'; g.fill();
          g.clip();
          glass(x + 4, Y(y1) + 4, ww - 8, (y1 - y0) * pv - 8, lit);
          g.fillStyle = '#4a453c';
          g.fillRect(X(cx) - 2, Y(y1), 4, (y1 - y0) * pv);
          for (const v of [11.2, 13.4]) g.fillRect(x, Y(v) - 2, ww, 4);
          g.restore();
          // archivolt
          g.strokeStyle = hexShade(base, 1.15); g.lineWidth = 0.22 * pu;
          g.beginPath(); g.ellipse(X(cx), Y(yT), (rad + 0.15) * pu, (rad + 0.15) * pv, 0, Math.PI, 0); g.stroke();
          g.fillStyle = hexShade(base, 1.15); g.fillRect(X(cx - 0.22), Y(y1 + 0.35), 0.44 * pu, 0.55 * pv);
        } else {
          shadowBox(x, Y(y1), ww, (y1 - y0) * pv, 4);
          glass(x, Y(yMid0), ww, (yMid0 - y0) * pv, lit);
          glass(x, Y(y1), ww, (y1 - yMid1) * pv, lit && r() < 0.8);
          // carved spandrel panel
          g.fillStyle = hexShade(base, 1.02); g.fillRect(x, Y(yMid1), ww, (yMid1 - yMid0) * pv);
          g.strokeStyle = 'rgba(60,50,35,0.5)'; g.lineWidth = 2;
          g.strokeRect(x + 6, Y(yMid1) + 5, ww - 12, (yMid1 - yMid0) * pv - 10);
          // stone mullions (3 lights) and transoms — "late Gothic" mullioned windows
          g.fillStyle = hexShade(base, 0.98);
          for (let k = 1; k < 3; k++) g.fillRect(x + (ww * k) / 3 - 3, Y(y1), 6, (y1 - y0) * pv);
          g.fillStyle = '#4a453c';
          for (const v of [10.5, 14.2]) g.fillRect(x, Y(v) - 1.5, ww, 3);
        }
        // sill
        g.fillStyle = hexShade(base, 1.12); g.fillRect(x - 10, Y(y0), ww + 20, 0.2 * pv);
        g.fillStyle = 'rgba(40,32,20,0.5)'; g.fillRect(x - 10, Y(y0 - 0.2), ww + 20, 3);
      }
    }
    // ---- architrave (three fasciae)
    g.fillStyle = hexShade(base, 1.05); g.fillRect(0, Y(F.friezeBot), W, (F.friezeBot - F.archBot) * pv);
    for (const v of [F.archBot + 0.22, F.archBot + 0.45]) {
      g.fillStyle = 'rgba(40,32,20,0.35)'; g.fillRect(0, Y(v), W, 2);
      g.fillStyle = 'rgba(255,250,235,0.3)'; g.fillRect(0, Y(v) + 2, W, 1);
    }
    // ---- frieze with carved names
    g.fillStyle = hexShade(base, 1.03); g.fillRect(0, Y(F.friezeTop), W, (F.friezeTop - F.friezeBot) * pv);
    g.fillStyle = 'rgba(40,32,20,0.4)'; g.fillRect(0, Y(F.friezeBot), W, 3);
    const off = variant === 'library' ? 9 : 0;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const fs = Math.round(0.62 * pv);
    g.font = `600 ${fs}px Georgia, "Times New Roman", serif`;
    for (let b = 0; b < F.bays; b++) {
      const name = NAMES[(b + off) % NAMES.length];
      const cx = X((b + 0.5) * F.bay), cy = Y((F.friezeBot + F.friezeTop) / 2);
      const spaced = name.split('').join(String.fromCharCode(8202));
      // shrink long names to fit the bay
      const maxW = (F.bay - 0.6) * pu;
      const m = g.measureText(spaced).width;
      g.save();
      g.translate(cx, cy);
      if (m > maxW) g.scale(maxW / m, 1);
      g.fillStyle = 'rgba(255,250,235,0.55)'; g.fillText(spaced, 1.5, 1.5);
      g.fillStyle = 'rgba(70,60,42,0.9)'; g.fillText(spaced, 0, 0);
      g.restore();
    }
    // ---- dentils + cornice soffit shadow
    g.fillStyle = hexShade(base, 1.08); g.fillRect(0, Y(F.wallTop + 1), W, (F.wallTop + 1 - F.friezeTop) * pv);
    for (let u = 0; u < tileW; u += 0.3) {
      g.fillStyle = 'rgba(40,32,20,0.45)'; g.fillRect(X(u + 0.18), Y(F.friezeTop + 0.32), 0.12 * pu, 0.3 * pv);
    }
    g.fillStyle = 'rgba(40,32,20,0.5)'; g.fillRect(0, Y(F.friezeTop + 0.4), W, 4);
    // weathering: soot streaks below the cornice & darker plinth zone
    for (let i = 0; i < 70; i++) {
      const x = r() * W, len = (2 + r() * 8) * pv;
      const grd = g.createLinearGradient(0, Y(F.friezeBot), 0, Y(F.friezeBot) + len);
      grd.addColorStop(0, 'rgba(60,55,45,0.10)'); grd.addColorStop(1, 'rgba(60,55,45,0)');
      g.fillStyle = grd; g.fillRect(x, Y(F.friezeBot), 2 + r() * 10, len);
    }
    const grd = g.createLinearGradient(0, Y(2.2), 0, H);
    grd.addColorStop(0, 'rgba(60,55,45,0)'); grd.addColorStop(1, 'rgba(60,55,45,0.18)');
    g.fillStyle = grd; g.fillRect(0, Y(2.2), W, 2.2 * pv);
    noise(g, W, H, r, 0.06, 2, 40000);

    const m = new THREE.MeshStandardMaterial({
      map: tex(ctx, c, tileW, tileH), emissiveMap: tex(ctx, ce, tileW, tileH),
      emissive: new THREE.Color('#ffcf8a'), emissiveIntensity: 0, roughness: 0.88, metalness: 0,
    });
    m.name = `carnegie-facade-${variant}`;
    ctx.materials.registerNightMaterial(m, 1.3);
    return m;
  });
}

/**
 * Carved inscriptions for the portico friezes, one row per line in a single atlas texture.
 * Returns { material, uv(row) → [v0, v1] }.
 */
export const INSCRIPTIONS = ['CARNEGIE MUSIC HALL', 'CARNEGIE INSTITUTE', 'FREE TO THE PEOPLE', 'CARNEGIE LIBRARY'];
export function inscriptions(ctx) {
  return cached(ctx, 'inscriptions', () => {
    const W = 2048, RH = 160, n = INSCRIPTIONS.length;
    const c = canvas(W, RH * n), g = c.getContext('2d');
    const r = rng(8);
    const base = '#c5bba1';
    for (let i = 0; i < n; i++) {
      const y0 = i * RH;
      g.fillStyle = base; g.fillRect(0, y0, W, RH);
      noise(g, W, RH, r, 0.04, 2, 3000, 0, y0);
      g.fillStyle = 'rgba(40,32,20,0.35)'; g.fillRect(0, y0 + RH - 6, W, 6);
      g.fillStyle = 'rgba(255,250,235,0.45)'; g.fillRect(0, y0, W, 3);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `600 ${Math.round(RH * 0.52)}px Georgia, "Times New Roman", serif`;
      const text = INSCRIPTIONS[i].split('').join(String.fromCharCode(8202, 8202));
      g.fillStyle = 'rgba(255,250,235,0.6)'; g.fillText(text, W / 2 + 2, y0 + RH / 2 + 2);
      g.fillStyle = 'rgba(62,52,36,0.92)'; g.fillText(text, W / 2, y0 + RH / 2);
    }
    const t = releaseAfterUpload(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, ctx.renderer?.capabilities?.getMaxAnisotropy?.() ?? 4);
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, emissive: new THREE.Color('#ffd9a0'), emissiveIntensity: 0 });
    m.name = 'carnegie-inscriptions';
    ctx.materials.registerNightMaterial(m, 0.04);
    return { material: m, uv: (row) => [1 - (row + 1) / n, 1 - row / n] };
  });
}

/** Plain Berea sandstone ashlar (0.6 m courses) for upper masses, parapets, trims. */
export function ashlar(ctx, tint = '#bdb399') {
  return cached(ctx, `ashlar:${tint}`, () => {
    const W = 256, H = 256, tile = 4.8; // metres
    const p = W / tile;
    const r = rng(77);
    const c = canvas(W, H), g = c.getContext('2d');
    g.fillStyle = tint; g.fillRect(0, 0, W, H);
    for (let y = 0, row = 0; y < H; y += 0.6 * p, row++) {
      for (let x = -(row % 2) * 0.6 * p; x < W; x += 1.2 * p) {
        g.fillStyle = hexShade(tint, 0.96 + r() * 0.07);
        g.fillRect(x + 1, y + 1, 1.2 * p - 1, 0.6 * p - 1);
      }
      g.fillStyle = 'rgba(90,80,60,0.3)'; g.fillRect(0, y, W, 1);
    }
    noise(g, W, H, r, 0.05, 2);
    const m = new THREE.MeshStandardMaterial({ map: tex(ctx, c, tile, tile), roughness: 0.9 });
    m.name = 'carnegie-ashlar';
    return m;
  });
}

/** Fluted column shaft: u = flute index (1 flute per unit), v = metres. */
export function flutedColumn(ctx) {
  return cached(ctx, 'fluted', () => {
    const W = 64, H = 64;
    const c = canvas(W, H), g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, W, 0);
    grd.addColorStop(0, '#d0c6ad'); grd.addColorStop(0.12, '#d6ccb3');
    grd.addColorStop(0.2, '#958a70'); grd.addColorStop(0.55, '#b0a58a'); grd.addColorStop(0.85, '#cabfa6'); grd.addColorStop(1, '#d0c6ad');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    noise(g, W, H, rng(5), 0.05, 1, 300);
    const t = tex(ctx, c, 1, 2);
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, emissive: new THREE.Color('#ffd9a0'), emissiveIntensity: 0 });
    m.name = 'carnegie-fluted';
    ctx.materials.registerNightMaterial(m, 0.045); // subtle floodlit look at night
    return m;
  });
}

/** Sandstone for porticos/entablatures — slightly lighter, floodlit at night. */
export function porticoStone(ctx) {
  return cached(ctx, 'porticoStone', () => {
    const base = ashlar(ctx, '#c5bba1');
    const m = base.clone();
    m.emissive = new THREE.Color('#ffd9a0');
    m.emissiveIntensity = 0;
    m.name = 'carnegie-portico';
    ctx.materials.registerNightMaterial(m, 0.04);
    return m;
  });
}

/** Norwegian larvikite (Scaife Galleries): polished grey-blue stone panels. */
export function larvikite(ctx) {
  return cached(ctx, 'larvikite', () => {
    const W = 256, H = 256, tile = 3.6;
    const p = W / tile;
    const r = rng(31);
    const c = canvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#4d555e'; g.fillRect(0, 0, W, H);
    for (let y = 0, row = 0; y < H; y += 0.9 * p, row++) {
      for (let x = 0; x < W; x += 1.8 * p) {
        g.fillStyle = hexShade('#525b64', 0.9 + r() * 0.2);
        g.fillRect(x + 1, y + 1, 1.8 * p - 2, 0.9 * p - 2);
      }
    }
    // feldspar schiller: tiny bluish sparkles
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${150 + r() * 60},${170 + r() * 60},${200 + r() * 55},${0.15 + r() * 0.35})`;
      g.fillRect(r() * W, r() * H, 1 + r() * 2, 1);
    }
    g.fillStyle = 'rgba(20,24,28,0.8)';
    for (let y = 0; y < H; y += 0.9 * p) g.fillRect(0, y, W, 1.5);
    for (let x = 0; x < W; x += 1.8 * p) g.fillRect(x, 0, 1.5, H);
    const m = new THREE.MeshStandardMaterial({ map: tex(ctx, c, tile, tile), roughness: 0.28, metalness: 0.15, envMapIntensity: 1.2 });
    m.name = 'scaife-larvikite';
    return m;
  });
}

/** Museum skylights: grey-green glass in a dense grid of dark glazing bars (u along the eave, v up the slope). */
export function skylightGlass(ctx) {
  return cached(ctx, 'skylight', () => {
    const W = 128, H = 128, tile = 2.4;
    const p = W / tile;
    const r = rng(21);
    const c = canvas(W, H), g = c.getContext('2d');
    for (let y = 0; y < H; y += 1.2 * p) for (let x = 0; x < W; x += 0.6 * p) {
      const k = 0.85 + r() * 0.3;
      g.fillStyle = `rgb(${Math.round(92 * k)},${Math.round(112 * k)},${Math.round(116 * k)})`;
      g.fillRect(x, y, 0.6 * p, 1.2 * p);
    }
    g.fillStyle = '#3a3d3f';
    for (let x = 0; x < W; x += 0.6 * p) g.fillRect(x - 1, 0, 2.5, H);
    for (let y = 0; y < H; y += 1.2 * p) g.fillRect(0, y - 1, W, 2);
    const m = new THREE.MeshStandardMaterial({ map: tex(ctx, c, tile, tile), roughness: 0.12, metalness: 0.45, envMapIntensity: 1.3 });
    m.name = 'carnegie-skylight';
    return m;
  });
}

/** Weathering steel (Richard Serra's "Carnegie"). */
export function corten(ctx) {
  return cached(ctx, 'corten', () => {
    const W = 128, H = 256;
    const r = rng(12);
    const c = canvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#7a3f24'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(${r() > 0.5 ? '140,70,35' : '70,35,20'},${0.1 + r() * 0.25})`;
      g.fillRect(r() * W, r() * H, 2 + r() * 8, 2 + r() * 6);
    }
    for (let i = 0; i < 40; i++) {
      const x = r() * W;
      g.fillStyle = 'rgba(50,25,15,0.15)'; g.fillRect(x, r() * H, 1 + r() * 2, 20 + r() * 80);
    }
    const m = new THREE.MeshStandardMaterial({ map: tex(ctx, c, 2, 4), roughness: 0.92, metalness: 0.2 });
    m.name = 'corten';
    return m;
  });
}

/** Aged bronze with green patina (Rhind's seated figures and muses, lamp standards). */
export function patinaBronze(ctx) {
  return cached(ctx, 'patinaBronze', () => {
    const W = 128, H = 128;
    const r = rng(44);
    const c = canvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#43392a'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 180; i++) {
      g.fillStyle = `rgba(${r() > 0.6 ? '70,112,96' : '96,80,52'},${0.06 + r() * 0.14})`;
      g.fillRect(r() * W, r() * H, 1 + r() * 3, 4 + r() * 18); // vertical run-off streaks
    }
    const m = new THREE.MeshStandardMaterial({ map: tex(ctx, c, 1.5, 1.5), roughness: 0.5, metalness: 0.6 });
    m.name = 'patina-bronze';
    return m;
  });
}

/** Dippy's fibreglass skin: dark greyish brown with subtle mottling. */
export function dippySkin(ctx) {
  return cached(ctx, 'dippySkin', () => {
    const W = 256, H = 256;
    const r = rng(1999);
    const c = canvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#5a4e42'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 700; i++) {
      const s = 3 + r() * 14;
      g.fillStyle = `rgba(${r() > 0.5 ? '120,105,88' : '45,38,31'},${0.08 + r() * 0.15})`;
      g.beginPath(); g.ellipse(r() * W, r() * H, s, s * (0.5 + r() * 0.5), r() * 3, 0, Math.PI * 2); g.fill();
    }
    // skin folds / wrinkles
    g.strokeStyle = 'rgba(35,30,24,0.25)'; g.lineWidth = 1.2;
    for (let i = 0; i < 90; i++) {
      const x = r() * W, y = r() * H;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 6, y + (r() - 0.5) * 10, x + 14 + r() * 10, y + (r() - 0.5) * 6); g.stroke();
    }
    const m = new THREE.MeshStandardMaterial({ map: tex(ctx, c, 2.5, 2.5), roughness: 0.62, metalness: 0.05 });
    m.name = 'dippy-skin';
    return m;
  });
}

/** Emissive lamp globe (street lanterns). */
export function lampGlobe(ctx) {
  return cached(ctx, 'lampGlobe', () => {
    const m = new THREE.MeshStandardMaterial({ color: '#f3efe2', roughness: 0.3, emissive: new THREE.Color('#ffd79a'), emissiveIntensity: 0 });
    m.name = 'lamp-globe';
    ctx.materials.registerNightMaterial(m, 2.6);
    return m;
  });
}

/** Dark bronze doors / window voids. */
export function darkBronze(ctx) {
  return cached(ctx, 'darkBronze', () => {
    const m = new THREE.MeshStandardMaterial({ color: '#5a4a34', roughness: 0.5, metalness: 0.45, emissive: new THREE.Color('#ffc57a'), emissiveIntensity: 0 });
    m.name = 'dark-bronze';
    ctx.materials.registerNightMaterial(m, 0.25);
    return m;
  });
}

// ------------------------------------------------------------------------------------------------ Phipps
// Night glow of the glasshouses. The real conservatory is lit from inside by display lighting among the plants: uneven,
// brightest low down, with dark ironwork — not an evenly glowing lantern. The shader modulates the emissive term by
//   · height above the room's floor (per-vertex 'aux'.x): 100 % in the lowest ~2.5 m, 30 % from ~9 m up to the ridge;
//   · low-frequency value noise in plan (~6 m cells) so roughly a quarter of the bays are near-dark;
//   · 'aux'.y = dimming 0..1 (the production greenhouses are back-of-house and barely lit); a negative value marks
//     evenly lit glazing (the Welcome Center lobby front) that skips the dark-bay noise;
//   · 50 % on back faces: the far side of a glasshouse is seen through the near side, so stacked layers don't add up.
// Meshes using these materials must carry the vec2 'aux' attribute (GeoBatch({ aux: true }) + build opts.aux).
const PHIPPS_GLOW_VERT = `
attribute vec2 aux;
varying vec3 vObPh;
varying vec2 vObAux;`;
const PHIPPS_GLOW_FRAG = `
varying vec3 vObPh;
varying vec2 vObAux;
float obPhHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float obPhNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(obPhHash(i), obPhHash(i + vec2(1.0, 0.0)), f.x), mix(obPhHash(i + vec2(0.0, 1.0)), obPhHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`;
const PHIPPS_GLOW_APPLY = `
{
  float obGlow = mix(1.0, 0.3, smoothstep(2.5, 9.0, vObPh.y - vObAux.x));
  if (vObAux.y >= 0.0) obGlow *= mix(0.05, 1.0, smoothstep(0.3, 0.62, obPhNoise(vObPh.xz * 0.16 + 3.7)));
  obGlow *= (1.0 - max(vObAux.y, 0.0)) * (gl_FrontFacing ? 1.0 : 0.5);
  totalEmissiveRadiance *= obGlow;
}`;
// night emissive intensity per glass variant (× the shader's glow factor)
const PHIPPS_NIGHT = { victorian: 0.45, modern: 0.38, frit: 0.42 };
function phippsGlowShader(m) {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>${PHIPPS_GLOW_VERT}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vObPh = position;\n  vObAux = aux;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>${PHIPPS_GLOW_FRAG}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>${PHIPPS_GLOW_APPLY}`);
  };
  m.customProgramCacheKey = () => 'oaklandB-phipps-glow-v1';
}

/**
 * Victorian glasshouse glazing: white-painted iron glazing bars + slightly green glass panes (RGBA, transparent).
 * UV: u = metres along the roof/wall profile (up the slope), v = metres along the length.
 * Night: the panes glow (interior lighting) through emissiveMap, shaped by the glow shader above.
 */
export function phippsGlass(ctx, variant = 'victorian') {
  return cached(ctx, `phGlass:${variant}`, () => {
    const W = 256, H = 256, tile = 2; // 2 m x 2 m
    const p = W / tile;
    const r = rng(variant === 'victorian' ? 1893 : 2006);
    const c = canvas(W, H), g = c.getContext('2d');
    const ce = canvas(128, 128), ge = ce.getContext('2d');
    const modern = variant !== 'victorian';
    const frit = variant === 'frit';
    g.clearRect(0, 0, W, H);
    // panes
    const paneA = frit ? 0.64 : modern ? 0.5 : 0.56;
    const tint = frit ? [232, 236, 234] : [184, 204, 199];
    for (let y = 0; y < H; y += (modern ? 1.0 : 0.5) * p) {
      for (let x = 0; x < W; x += (modern ? 2.0 : 0.6667) * p) {
        const k = 0.9 + r() * 0.2;
        const a = paneA * (0.85 + r() * 0.3) + (r() < 0.08 ? 0.18 : 0); // occasional whitewashed pane
        g.fillStyle = `rgba(${Math.min(255, Math.round(tint[0] * k))},${Math.min(255, Math.round(tint[1] * k))},${Math.min(255, Math.round(tint[2] * k))},${a.toFixed(3)})`;
        g.fillRect(x, y, (modern ? 2.0 : 0.6667) * p, (modern ? 1.0 : 0.5) * p);
      }
    }
    const bar = (x, y, w, h) => { g.fillStyle = 'rgba(247,247,242,1)'; g.fillRect(x, y, w, h); };
    if (!modern) {
      // glazing bars along the profile (constant v) every 0.5 m; iron ribs every 2 m (thicker)
      for (let y = 0; y < H; y += 0.5 * p) bar(0, y - 2.5, W, 5);
      bar(0, 0, W, 7); bar(0, H - 7, W, 7);
      // lap lines / purlins across (constant u) every 0.667 m (thin), main purlin every 2 m
      for (let x = 0; x < W; x += 0.6667 * p) { g.fillStyle = 'rgba(240,240,235,0.9)'; g.fillRect(x - 1.5, 0, 3, H); }
      bar(0, 0, 5, H); bar(W - 5, 0, 5, H);
    } else {
      for (let y = 0; y < H; y += 1.0 * p) bar(0, y - 2, W, 4);
      bar(0, 0, W, 3); bar(0, H - 3, W, 3);
      bar(0, 0, 3, H); bar(W - 3, 0, 3, H);
    }
    // emissive: panes lit from inside at night (same pane grid as the colour map, bars stay dark)
    ge.fillStyle = '#000'; ge.fillRect(0, 0, 128, 128);
    const ep = 128 / tile, pw = (modern ? 2.0 : 0.6667) * ep, ph = (modern ? 1.0 : 0.5) * ep;
    // Soft, nearly uniform glow per pane (a strong per-pane variation reads as a woven checkerboard from a distance;
    // the large-scale variation comes from the glow shader); glazing bars and iron ribs stay dark.
    ge.fillStyle = 'rgb(10,9,8)'; ge.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += ph) for (let x = 0; x < 128; x += pw) {
      const k = 0.84 + r() * 0.16;
      const grd = ge.createLinearGradient(0, y, 0, y + ph); // faint sheen: panes a touch brighter at one edge
      grd.addColorStop(0, `rgb(${Math.round(255 * k)},${Math.round(238 * k)},${Math.round(200 * k)})`);
      grd.addColorStop(1, `rgb(${Math.round(232 * k)},${Math.round(214 * k)},${Math.round(176 * k)})`);
      ge.fillStyle = grd;
      ge.fillRect(x + 2, y + 2, pw - 4, ph - 4);
    }
    if (!modern) { ge.fillStyle = 'rgb(6,6,5)'; ge.fillRect(0, 0, 128, 3); ge.fillRect(0, 0, 3, 128); } // iron ribs
    const map = tex(ctx, c, tile, tile);
    const em = tex(ctx, ce, tile, tile);
    const m = new THREE.MeshStandardMaterial({
      map, emissiveMap: em, emissive: new THREE.Color(modern ? '#fff4e2' : '#fff0d6'), emissiveIntensity: 0,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, roughness: 0.1, metalness: 0.2,
      envMapIntensity: 1.6,
    });
    m.name = `phipps-glass-${variant}`;
    // Thin glass: one pass is enough (three.js otherwise draws transparent DoubleSide meshes twice, back then front,
    // re-validating the program before each pass).
    m.forceSinglePass = true;
    phippsGlowShader(m);
    ctx.materials.registerNightMaterial(m, PHIPPS_NIGHT[variant] ?? 0.16);
    return m;
  });
}

/** Opaque white-painted ironwork (ridges, gutters, finials, drum bands). */
export function phippsWhite(ctx) {
  return cached(ctx, 'phWhite', () => {
    const m = new THREE.MeshStandardMaterial({ color: '#f1f0ea', roughness: 0.55, metalness: 0.1 });
    m.name = 'phipps-white';
    return m;
  });
}

/** Fleur-de-lis ridge cresting (alpha-tested cut-out). u along the ridge (metres), v up (metres). */
export function phippsCresting(ctx) {
  return cached(ctx, 'phCresting', () => {
    const W = 256, H = 128, tileW = 1.6, tileH = 0.8;
    const c = canvas(W, H), g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#f4f3ee';
    g.fillRect(0, H - 10, W, 10); // base rail
    g.fillRect(0, H - 34, W, 4); // mid rail
    for (let k = 0; k < 4; k++) {
      const cx = (k + 0.5) * (W / 4);
      // fleur-de-lis: central petal + two curls
      g.beginPath();
      g.moveTo(cx, 6); g.quadraticCurveTo(cx + 10, 30, cx + 3, H - 10); g.lineTo(cx - 3, H - 10); g.quadraticCurveTo(cx - 10, 30, cx, 6);
      g.fill();
      g.lineWidth = 5; g.strokeStyle = '#f4f3ee';
      g.beginPath(); g.moveTo(cx, H - 40); g.bezierCurveTo(cx + 26, H - 44, cx + 26, H - 76, cx + 12, H - 70); g.stroke();
      g.beginPath(); g.moveTo(cx, H - 40); g.bezierCurveTo(cx - 26, H - 44, cx - 26, H - 76, cx - 12, H - 70); g.stroke();
      g.fillRect(cx - 32, H - 30, 3, 20);
    }
    const t = tex(ctx, c, tileW, tileH);
    t.wrapT = THREE.ClampToEdgeWrapping;
    const m = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5 });
    m.name = 'phipps-cresting';
    return m;
  });
}

/** Planting beds inside the glasshouses (dark mulch with green patches). */
export function plantBed(ctx) {
  return cached(ctx, 'plantBed', () => {
    const W = 128, H = 128, tile = 4;
    const r = rng(3);
    const c = canvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#3d3526'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(${40 + r() * 50},${90 + r() * 70},${35 + r() * 30},${0.5 + r() * 0.5})`;
      const s = 3 + r() * 9;
      g.beginPath(); g.arc(r() * W, r() * H, s, 0, Math.PI * 2); g.fill();
    }
    const m = new THREE.MeshStandardMaterial({ map: tex(ctx, c, tile, tile), roughness: 1 });
    m.name = 'phipps-bed';
    return m;
  });
}

/** Foliage for interior plants (instanced, per-instance colour). */
export function foliage(ctx) {
  return cached(ctx, 'foliage', () => {
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, flatShading: true });
    m.name = 'phipps-foliage';
    return m;
  });
}

/** Paving for the Phipps entrance court: the shared paver texture, pulled towards the camera so it can be draped
 *  a few centimetres above the terrain without z-fighting. */
export function courtPaver(ctx) {
  return cached(ctx, 'courtPaver', () => {
    const m = ctx.materials.get('paver').clone();
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
    m.emissive = new THREE.Color('#4a3a28'); // lamp-lit café court at night
    m.emissiveMap = m.map;
    ctx.materials.registerNightMaterial(m, 0.45);
    m.name = 'phipps-court-paver';
    return m;
  });
}
