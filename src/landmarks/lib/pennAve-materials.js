// Canvas-painted materials for the East Liberty / Penn Avenue landmarks. No image files: every texture below is drawn
// at runtime. Colours were matched by eye against reference photographs of the buildings (light grey-buff Indiana-type
// limestone of East Liberty Presbyterian, the buff brick and verdigris dome of Motor Square Garden, the cream
// terracotta of the Highland Building, ...). Materials are created once per ctx.materials and shared by all Penn
// Avenue landmarks, so the whole district adds only a few programs / textures.
import * as THREE from 'three';

const CACHE = new WeakMap();

const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
function hexRgb(hex) { const c = new THREE.Color(hex); return [c.r * 255, c.g * 255, c.b * 255]; }
const rgba = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
function tint([r, g, b], f, a = 1) { return rgba(clamp(r * f, 0, 255), clamp(g * f, 0, 255), clamp(b * f, 0, 255), a); }

// Tangent-space normal map from a height field (metres), OpenGL convention (+v = canvas up).
function sobelNormals(H, w, h, pxPerM, canvas) {
  const g = canvas.getContext('2d');
  const img = g.createImageData(w, h), d = img.data;
  const k = pxPerM / 8;
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w, y0 = y * w, yp = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w, xp = (x + 1) % w;
      const sx = ((H[ym + xp] + 2 * H[y0 + xp] + H[yp + xp]) - (H[ym + xm] + 2 * H[y0 + xm] + H[yp + xm])) * k;
      const sy = ((H[yp + xm] + 2 * H[yp + x] + H[yp + xp]) - (H[ym + xm] + 2 * H[ym + x] + H[ym + xp])) * k;
      const inv = 1 / Math.sqrt(sx * sx + sy * sy + 1), i = (y0 + x) * 4;
      d[i] = (-sx * inv * 0.5 + 0.5) * 255; d[i + 1] = (sy * inv * 0.5 + 0.5) * 255; d[i + 2] = (inv * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

export function getPennMaterials(ctx) {
  const M = ctx.materials;
  if (CACHE.has(M)) return CACHE.get(M);
  const low = ctx.quality?.level === 'low';
  const relief = !low;
  const maxAniso = ctx.renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;

  // texture from a canvas; release the backing store after upload (never repainted)
  function tex(c, repW = 1, repH = 1, { color = true, wrap = true } = {}) {
    const t = new THREE.CanvasTexture(c);
    t.onUpdate = () => { t.onUpdate = null; c.width = c.height = 1; };
    t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    t.repeat.set(1 / repW, 1 / repH);
    t.anisotropy = Math.min(8, maxAniso);
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  }
  const canvas = (w, h) => M.makeCanvas(w, h);
  const T0 = performance.now(), timing = [];
  const mark = (name) => timing.push([name, Math.round(performance.now() - T0)]);

  // ------------------------------------------------------------------ ashlar stone
  // Random-coursed ashlar: courses of two heights, blocks of mixed length, fine tooling grain, soft weathering.
  // The relief height field (joints recessed 1 cm, block faces slightly pillowed) becomes a normal map.
  function ashlar(color, tileM, px, seed, { course = [0.36, 0.56], block = [0.55, 1.5], weather = 0.18 } = {}) {
    const base = hexRgb(color), r = rng(seed);
    const pxPerM = px / tileM;
    const c = canvas(px, px), g = c.getContext('2d');
    const H = relief ? new Float32Array(px * px) : null;
    g.fillStyle = tint(base, 1.1); g.fillRect(0, 0, px, px);
    let y = 0;
    const joint = Math.max(1, Math.round(0.012 * pxPerM));
    // courses must tile vertically: scale the chosen heights so they sum to px exactly
    const hs = []; let sum = 0;
    while (sum < tileM - 0.2) { const h = r() < 0.5 ? course[0] : course[1]; hs.push(h); sum += h; }
    const fy = tileM / sum;
    for (let ci = 0; ci < hs.length; ci++) {
      const ch = Math.round(hs[ci] * fy * pxPerM), y1 = ci === hs.length - 1 ? px : y + ch;
      // blocks along the course; lengths scaled to tile horizontally
      const ls = []; let s2 = 0;
      while (s2 < tileM - 0.3) { const l = block[0] + r() * (block[1] - block[0]); ls.push(l); s2 += l; }
      const fx = tileM / s2;
      let x = Math.round(r() * px);
      for (let bi = 0; bi < ls.length; bi++) {
        const bw = Math.round(ls[bi] * fx * pxPerM);
        const f = 0.94 + r() * 0.1, warm = (r() - 0.5) * 6;
        const col = rgba(clamp(base[0] * f + warm, 0, 255), clamp(base[1] * f + warm * 0.6, 0, 255), clamp(base[2] * f - warm * 0.3, 0, 255));
        for (const off of [0, -px]) {
          const bx = x + off;
          if (bx + bw < 0 || bx > px) continue;
          g.fillStyle = col;
          g.fillRect(bx + joint, y + joint, bw - joint, y1 - y - joint);
          // tooled face: a faint darker lower edge and lighter upper edge
          g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(bx + joint, y + joint, bw - joint, Math.max(1, joint));
          g.fillStyle = 'rgba(0,0,0,0.07)'; g.fillRect(bx + joint, y1 - joint * 2, bw - joint, joint);
          if (H) {
            // block face 7 mm proud of the joints (row fills - no per-pixel maths)
            const xa = Math.max(0, bx + joint), xb = Math.min(px, bx + bw);
            if (xb > xa) for (let yy = Math.max(0, y + joint); yy < Math.min(px, y1); yy++) H.fill(0.007, yy * px + xa, yy * px + xb);
          }
        }
        x = (x + bw) % px;
      }
      y = y1;
    }
    // grain (a 128² speckle tile laid as a pattern) + weathering streaks (rain run-off darkens below ledges)
    {
      const T = 128, tc = canvas(T, T), tg = tc.getContext('2d'), img = tg.createImageData(T, T), d = img.data;
      for (let i = 0; i < d.length; i += 4) { const v = r() > 0.5 ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = (r() * 22) | 0; }
      tg.putImageData(img, 0, 0);
      g.fillStyle = g.createPattern(tc, 'repeat'); g.fillRect(0, 0, px, px);
    }
    if (H) for (let i = 0; i < H.length; i += 1) H[i] += (r() - 0.5) * 0.0012;
    for (let k = 0; k < 26 * weather * 10; k++) {
      const sx = r() * px, sw = 2 + r() * 10, sh = px * (0.15 + r() * 0.5), sy = r() * px;
      const grd = g.createLinearGradient(0, sy, 0, sy + sh);
      grd.addColorStop(0, 'rgba(60,52,44,0.10)'); grd.addColorStop(1, 'rgba(60,52,44,0)');
      g.fillStyle = grd; g.fillRect(sx, sy, sw, sh);
    }
    const map = tex(c, tileM, tileM);
    let normalMap = null;
    if (H) normalMap = tex(sobelNormals(H, px, px, pxPerM, canvas(px, px)), tileM, tileM, { color: false });
    return { map, normalMap };
  }

  const STONE = '#ddd6c5';          // East Liberty Presbyterian: light grey-buff limestone
  const stoneT = ashlar(STONE, 4, low ? 256 : 512, 11, { weather: 0.1 });
  mark('ashlar');
  const stoneMat = (name, { glow = 0, rough = 0.88 } = {}) => {
    const m = new THREE.MeshStandardMaterial({ map: stoneT.map, color: '#ffffff', roughness: rough, metalness: 0 });
    if (stoneT.normalMap) { m.normalMap = stoneT.normalMap; m.normalScale = new THREE.Vector2(1.1, 1.1); }
    if (glow > 0) {
      // floodlit at night: the stone map itself becomes the emissive map (warm sodium-white wash)
      m.emissive = new THREE.Color('#ffd9a8'); m.emissiveMap = stoneT.map; m.emissiveIntensity = 0;
      M.registerNightMaterial(m, glow);
    }
    m.userData.cmuRelief = true;
    m.name = `pennAve-${name}`;
    return m;
  };

  // ------------------------------------------------------------------ window / door atlas
  // One 1024² sheet (512² on low) with every opening design used on Penn Avenue; panels map a cell with 0..1 UVs.
  const AW = low ? 512 : 1024, S = AW / 1024;
  const cA = canvas(AW, AW), gA = cA.getContext('2d');
  const cE = canvas(AW, AW), gE = cE.getContext('2d');
  gA.scale(S, S); gE.scale(S, S);
  gA.fillStyle = '#2a2f33'; gA.fillRect(0, 0, 1024, 1024);
  gE.fillStyle = '#000'; gE.fillRect(0, 0, 1024, 1024);
  const cells = {};
  const cell = (name, x0, y0, x1, y1) => { cells[name] = [x0 / 1024, 1 - y1 / 1024, x1 / 1024, 1 - y0 / 1024]; return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }; };
  const ra = rng(4242);
  const stoneCss = '#c9bfab', stoneDark = '#9f9685', lead = '#2b2a2c';
  // pointed-arch path inside box (x, y, w, h) with springing at y + h - hs (canvas y down); k = radius/span
  function archPath(g, x, y, w, h, k = 1, begin = true) {
    const R = k * w, apex = Math.sqrt(Math.max(0, R * R - (R - w / 2) ** 2));
    const ys = y + apex;
    if (begin) g.beginPath();
    g.moveTo(x, y + h); g.lineTo(x, ys);
    const cxR = x + R, cxL = x + w - R;
    const aR = Math.atan2(apex, R - w / 2);
    g.arc(cxR, ys, R, Math.PI, Math.PI + aR, false);
    g.arc(cxL, ys, R, -aR, 0, false);
    g.lineTo(x + w, y + h); g.closePath();
    return apex;
  }
  // stained glass: small quarries in jewel colours behind lead lines; darker by day, glowing by night
  function stainedGlass(x, y, w, h, clipFn, { hue = 0, glow = 1 } = {}) {
    gA.save(); gE.save();
    clipFn(gA); gA.clip(); clipFn(gE); gE.clip();
    const q = 7;
    const pal = [[46, 62, 104], [96, 40, 44], [42, 78, 70], [112, 92, 44], [70, 52, 96], [38, 52, 70]];
    for (let yy = y; yy < y + h; yy += q) for (let xx = x; xx < x + w; xx += q) {
      const p = pal[(Math.floor(ra() * pal.length) + hue) % pal.length], f = 0.55 + ra() * 0.35;
      gA.fillStyle = rgba(p[0] * f, p[1] * f, p[2] * f); gA.fillRect(xx, yy, q, q);
      const e = 0.35 + ra() * 0.6;
      gE.fillStyle = rgba(clamp(p[0] * 3.1 * e, 0, 255), clamp(p[1] * 2.9 * e, 0, 255), clamp(p[2] * 2.6 * e, 0, 255), glow);
      gE.fillRect(xx, yy, q, q);
    }
    // sky reflection sheen on the upper glass
    const grd = gA.createLinearGradient(x, y, x + w * 0.5, y + h);
    grd.addColorStop(0, 'rgba(190,205,220,0.22)'); grd.addColorStop(0.5, 'rgba(190,205,220,0.05)'); grd.addColorStop(1, 'rgba(0,0,0,0.1)');
    gA.fillStyle = grd; gA.fillRect(x, y, w, h);
    gA.strokeStyle = lead; gA.lineWidth = 1.2;
    for (let yy = y; yy < y + h; yy += q * 3) { gA.beginPath(); gA.moveTo(x, yy); gA.lineTo(x + w, yy); gA.stroke(); }
    gA.restore(); gE.restore();
  }
  // stone tracery bar (drawn in both sheets: stone by day, black in the emissive sheet)
  function bar(x, y, w, h) { gA.fillStyle = stoneCss; gA.fillRect(x, y, w, h); gA.fillStyle = 'rgba(0,0,0,0.25)'; gA.fillRect(x + w - Math.max(1, w * 0.3), y, Math.max(1, w * 0.3), h); gE.fillStyle = '#000'; gE.fillRect(x, y, w, h); }
  function strokeArch(x, y, w, h, k, lw) {
    for (const [g, col] of [[gA, stoneCss], [gE, '#000']]) { g.strokeStyle = col; g.lineWidth = lw; archPath(g, x, y, w, h, k); g.stroke(); }
  }
  function ringStroke(cx, cy, r, lw) {
    for (const [g, col] of [[gA, stoneCss], [gE, '#000']]) { g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke(); }
  }
  // fill the arch spandrels of a cell with stone so the rectangular UV cell edges never show glass
  function stoneSurround(c0, k) {
    gA.save(); gA.fillStyle = stoneDark; gA.beginPath(); gA.rect(c0.x0, c0.y0, c0.w, c0.h);
    archPath(gA, c0.x0, c0.y0, c0.w, c0.h, k, false); gA.fill('evenodd'); gA.restore();
  }

  // (a) two-light lancet with a quatrefoil in the head (aisle & clerestory windows)
  {
    const c0 = cell('lancet2', 0, 0, 128, 384), k = 1;
    stainedGlass(c0.x0, c0.y0, c0.w, c0.h, (g) => archPath(g, c0.x0, c0.y0, c0.w, c0.h, k), { hue: 0 });
    const lw = (c0.w - 18) / 2, apex = archPath(gA, c0.x0, c0.y0, c0.w, c0.h, k);
    bar(c0.x0 + c0.w / 2 - 4, c0.y0 + apex * 0.9, 8, c0.h);
    for (const lx of [c0.x0 + 5, c0.x0 + c0.w / 2 + 4]) strokeArch(lx, c0.y0 + apex * 0.95, lw, c0.h * 0.7, 1, 4);
    ringStroke(c0.x0 + c0.w / 2, c0.y0 + apex * 0.62, c0.w * 0.17, 4);
    for (let t = 1; t < 4; t++) bar(c0.x0, c0.y0 + apex + (c0.h - apex) * t / 4, c0.w, 3);
    stoneSurround(c0, k);
  }
  // (b) single lancet
  {
    const c0 = cell('lancet1', 128, 0, 192, 384), k = 1;
    stainedGlass(c0.x0, c0.y0, c0.w, c0.h, (g) => archPath(g, c0.x0, c0.y0, c0.w, c0.h, k), { hue: 2 });
    for (let t = 1; t < 5; t++) bar(c0.x0, c0.y0 + c0.h * t / 5, c0.w, 3);
    stoneSurround(c0, k);
  }
  // (c) belfry opening: two tall lights with stone transoms, dark louvres behind (not lit at night)
  {
    const c0 = cell('belfry', 192, 0, 320, 512), k = 0.9;
    gA.save(); archPath(gA, c0.x0, c0.y0, c0.w, c0.h, k); gA.clip();
    gA.fillStyle = '#1d1b1a'; gA.fillRect(c0.x0, c0.y0, c0.w, c0.h);
    for (let yy = c0.y0 + 40; yy < c0.y1; yy += 9) { gA.fillStyle = 'rgba(120,112,100,0.35)'; gA.fillRect(c0.x0, yy, c0.w, 3); }
    gA.restore();
    const apex = archApexPx(c0.w, k);
    bar(c0.x0 + c0.w / 2 - 5, c0.y0 + apex * 0.8, 10, c0.h);
    for (const lx of [c0.x0 + 6, c0.x0 + c0.w / 2 + 5]) strokeArch(lx, c0.y0 + apex * 0.85, (c0.w - 22) / 2, c0.h * 0.5, 1, 5);
    ringStroke(c0.x0 + c0.w / 2, c0.y0 + apex * 0.55, c0.w * 0.16, 5);
    for (let t = 1; t < 4; t++) bar(c0.x0, c0.y0 + apex + (c0.h - apex) * t / 4, c0.w, 6);
    stoneSurround(c0, k);
  }
  // (d) the great window: five lights under a web of roundels (the Penn Avenue front and the transept ends)
  {
    const c0 = cell('great', 320, 0, 640, 448), k = 0.85;
    stainedGlass(c0.x0, c0.y0, c0.w, c0.h, (g) => archPath(g, c0.x0, c0.y0, c0.w, c0.h, k), { hue: 1 });
    const apex = archApexPx(c0.w, k), L = 5, mw = 7, lw = (c0.w - mw * (L + 1)) / L, headY = c0.y0 + apex * 1.05;
    for (let i = 0; i <= L; i++) bar(c0.x0 + i * (lw + mw), headY, mw, c0.h);
    for (let i = 0; i < L; i++) strokeArch(c0.x0 + mw + i * (lw + mw), headY - lw * 0.55, lw, lw * 1.2, 1, 4);
    ringStroke(c0.x0 + c0.w / 2, c0.y0 + apex * 0.5, c0.w * 0.17, 6);
    for (const s of [-1, 1]) ringStroke(c0.x0 + c0.w / 2 + s * c0.w * 0.25, c0.y0 + apex * 0.86, c0.w * 0.1, 5);
    for (let t = 1; t < 5; t++) bar(c0.x0, headY + (c0.h - (headY - c0.y0)) * t / 5, c0.w, 4);
    stoneSurround(c0, k);
  }
  // (e) rose window
  {
    const c0 = cell('rose', 640, 0, 896, 256), cx = c0.x0 + 128, cy = c0.y0 + 128;
    gA.fillStyle = stoneDark; gA.fillRect(c0.x0, c0.y0, 256, 256);
    stainedGlass(c0.x0, c0.y0, 256, 256, (g) => { g.beginPath(); g.arc(cx, cy, 124, 0, Math.PI * 2); }, { hue: 3 });
    ringStroke(cx, cy, 36, 7); ringStroke(cx, cy, 122, 8);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      for (const [g, col] of [[gA, stoneCss], [gE, '#000']]) { g.strokeStyle = col; g.lineWidth = 6; g.beginPath(); g.moveTo(cx + Math.cos(a) * 36, cy + Math.sin(a) * 36); g.lineTo(cx + Math.cos(a) * 120, cy + Math.sin(a) * 120); g.stroke(); }
      ringStroke(cx + Math.cos(a + Math.PI / 12) * 88, cy + Math.sin(a + Math.PI / 12) * 88, 17, 4);
    }
  }
  // (f) Tudor mullioned-transomed window (church house): three lights x two tiers, leaded quarries
  {
    const c0 = cell('tudor', 640, 256, 832, 384);
    gA.fillStyle = '#26292b'; gA.fillRect(c0.x0, c0.y0, c0.w, c0.h);
    const grd = gA.createLinearGradient(c0.x0, c0.y0, c0.x0 + 60, c0.y1);
    grd.addColorStop(0, 'rgba(170,190,205,0.45)'); grd.addColorStop(0.6, 'rgba(60,70,80,0.2)'); grd.addColorStop(1, 'rgba(120,135,150,0.3)');
    gA.fillStyle = grd; gA.fillRect(c0.x0, c0.y0, c0.w, c0.h);
    gA.strokeStyle = 'rgba(20,20,20,0.6)'; gA.lineWidth = 1;
    for (let x = c0.x0; x < c0.x1; x += 8) { gA.beginPath(); gA.moveTo(x, c0.y0); gA.lineTo(x, c0.y1); gA.stroke(); }
    for (let y = c0.y0; y < c0.y1; y += 10) { gA.beginPath(); gA.moveTo(c0.x0, y); gA.lineTo(c0.x1, y); gA.stroke(); }
    // lamplight behind some panes
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const lx = c0.x0 + 10 + i * 60, ly = c0.y0 + 10 + j * 58;
      gE.fillStyle = ra() < 0.7 ? rgba(255, 214 + ra() * 30, 150 + ra() * 40, 0.85) : '#000'; gE.fillRect(lx, ly, 54, 50);
    }
    for (let i = 0; i <= 3; i++) bar(c0.x0 + i * (c0.w - 10) / 3, c0.y0, 10, c0.h);
    bar(c0.x0, c0.y0, c0.w, 8); bar(c0.x0, c0.y1 - 8, c0.w, 8); bar(c0.x0, c0.y0 + c0.h * 0.45, c0.w, 8);
  }
  // (g) Gothic portal: oak double doors with iron straps under a carved tympanum
  {
    const c0 = cell('door', 832, 256, 1024, 512), k = 0.8;
    gA.fillStyle = stoneDark; gA.fillRect(c0.x0, c0.y0, c0.w, c0.h);
    gA.save(); archPath(gA, c0.x0, c0.y0, c0.w, c0.h, k); gA.clip();
    const apex = archApexPx(c0.w, k), lintel = c0.y0 + apex + (c0.h - apex) * 0.18;
    gA.fillStyle = '#b9ae98'; gA.fillRect(c0.x0, c0.y0, c0.w, lintel - c0.y0);            // tympanum
    gA.fillStyle = 'rgba(80,70,58,0.55)';
    for (let i = 0; i < 9; i++) { const fx = c0.x0 + 18 + i * 18; gA.fillRect(fx, lintel - 36 - (i % 3) * 8, 9, 30 + (i % 3) * 8); }
    gA.beginPath(); gA.arc(c0.x0 + c0.w / 2, lintel - 70, 20, 0, Math.PI * 2); gA.fill();
    gA.fillStyle = '#b3a892'; gA.fillRect(c0.x0, lintel, c0.w, 14);
    gA.fillStyle = '#4a3222'; gA.fillRect(c0.x0, lintel + 14, c0.w, c0.y1 - lintel - 14);  // oak
    gA.fillStyle = 'rgba(0,0,0,0.35)';
    for (let x = c0.x0 + 10; x < c0.x1; x += 16) gA.fillRect(x, lintel + 14, 3, c0.y1 - lintel);
    gA.fillStyle = '#222'; for (let y = lintel + 40; y < c0.y1; y += 46) gA.fillRect(c0.x0, y, c0.w, 5);
    gA.fillStyle = '#b3a892'; gA.fillRect(c0.x0 + c0.w / 2 - 7, lintel, 14, c0.h);         // trumeau
    gE.fillStyle = 'rgba(255,200,130,0.35)'; gE.fillRect(c0.x0, lintel + 14, c0.w, c0.y1 - lintel);
    gA.restore();
  }
  // (h) Motor Square Garden: tall round-arched window - fan light over three-by-three sashes, oxblood frames
  {
    const c0 = cell('msgArch', 0, 512, 256, 768), k = 0.5;
    gA.fillStyle = '#c9ad76'; gA.fillRect(c0.x0, c0.y0, c0.w, c0.h);
    gA.save(); archPath(gA, c0.x0, c0.y0, c0.w, c0.h, k); gA.clip();
    const grd = gA.createLinearGradient(c0.x0, c0.y0, c0.x0 + 90, c0.y1);
    grd.addColorStop(0, '#6f8494'); grd.addColorStop(0.5, '#27313a'); grd.addColorStop(1, '#3d4a55');
    gA.fillStyle = grd; gA.fillRect(c0.x0, c0.y0, c0.w, c0.h);
    gA.restore();
    gE.save(); archPath(gE, c0.x0, c0.y0, c0.w, c0.h, k); gE.clip();
    for (let yy = c0.y0; yy < c0.y1; yy += 32) for (let xx = c0.x0; xx < c0.x1; xx += 43) { gE.fillStyle = ra() < 0.7 ? rgba(255, 205 + ra() * 30, 140 + ra() * 40, 0.45 + ra() * 0.3) : 'rgba(40,30,20,1)'; gE.fillRect(xx, yy, 43, 32); }
    gE.restore();
    const red = '#7d2a20', spring = c0.y0 + 128;
    const fr = (x, y, w, h) => { gA.fillStyle = red; gA.fillRect(x, y, w, h); gE.fillStyle = '#000'; gE.fillRect(x, y, w, h); };
    for (const [g, col] of [[gA, red], [gE, '#000']]) {
      g.strokeStyle = col; g.lineWidth = 8; g.beginPath(); g.arc(c0.x0 + 128, spring, 122, Math.PI, 0); g.stroke();
      g.lineWidth = 6; for (let i = 1; i < 6; i++) { const a = Math.PI + (i / 6) * Math.PI; g.beginPath(); g.moveTo(c0.x0 + 128, spring); g.lineTo(c0.x0 + 128 + Math.cos(a) * 124, spring + Math.sin(a) * 124); g.stroke(); }
      g.beginPath(); g.arc(c0.x0 + 128, spring, 40, Math.PI, 0); g.stroke();
    }
    fr(c0.x0, spring - 4, c0.w, 10);
    for (let i = 0; i <= 3; i++) fr(c0.x0 + i * (c0.w - 8) / 3, spring, 8, c0.h - 128);
    for (let j = 1; j < 3; j++) fr(c0.x0, spring + j * (c0.h - 128) / 3, c0.w, 6);
    fr(c0.x0, c0.y1 - 8, c0.w, 8);
  }
  // (i) shop front: plate glass in dark bronze mullions, warm interior at night
  {
    const c0 = cell('shop', 256, 512, 512, 640);
    const grd = gA.createLinearGradient(c0.x0, c0.y0, c0.x0 + 120, c0.y1);
    grd.addColorStop(0, '#8fa3b1'); grd.addColorStop(0.45, '#2e3a42'); grd.addColorStop(1, '#4b5a63');
    gA.fillStyle = grd; gA.fillRect(c0.x0, c0.y0, c0.w, c0.h);
    gA.fillStyle = 'rgba(230,220,200,0.18)'; for (let i = 0; i < 6; i++) gA.fillRect(c0.x0 + 10 + ra() * 220, c0.y0 + 60 + ra() * 40, 20 + ra() * 30, 30);
    gE.fillStyle = 'rgba(255,225,170,0.95)'; gE.fillRect(c0.x0, c0.y0 + 20, c0.w, c0.h - 20);
    for (let i = 0; i <= 4; i++) { gA.fillStyle = '#2c2723'; gA.fillRect(c0.x0 + i * (c0.w - 6) / 4, c0.y0, 6, c0.h); gE.fillStyle = '#000'; gE.fillRect(c0.x0 + i * (c0.w - 6) / 4, c0.y0, 6, c0.h); }
    gA.fillStyle = '#2c2723'; gA.fillRect(c0.x0, c0.y0 + 18, c0.w, 5); gA.fillRect(c0.x0, c0.y1 - 8, c0.w, 8);
  }
  // (j) round red bullseye sign on white (Target, Penn Avenue)
  {
    const c0 = cell('bullseye', 512, 512, 640, 640), cx = c0.x0 + 64, cy = c0.y0 + 64;
    for (const g of [gA, gE]) {
      g.fillStyle = '#f4f4f2'; g.fillRect(c0.x0, c0.y0, 128, 128);
      g.fillStyle = '#cc0000'; g.beginPath(); g.arc(cx, cy, 60, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#f4f4f2'; g.beginPath(); g.arc(cx, cy, 40, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#cc0000'; g.beginPath(); g.arc(cx, cy, 20, 0, Math.PI * 2); g.fill();
    }
  }
  // (k) office sash window (Highland Building) - one-over-one sash, bronze frame
  {
    const c0 = cell('sash', 640, 512, 704, 640);
    gA.fillStyle = '#4a4036'; gA.fillRect(c0.x0, c0.y0, c0.w, c0.h);
    for (const [y0, y1] of [[c0.y0 + 5, c0.y0 + 62], [c0.y0 + 68, c0.y1 - 5]]) {
      const grd = gA.createLinearGradient(c0.x0, y0, c0.x1, y1);
      grd.addColorStop(0, '#7e93a3'); grd.addColorStop(0.6, '#2b353d'); grd.addColorStop(1, '#46535c');
      gA.fillStyle = grd; gA.fillRect(c0.x0 + 5, y0, c0.w - 10, y1 - y0);
      if (ra() < 0.6) { gE.fillStyle = rgba(255, 210 + ra() * 30, 150, 0.8); gE.fillRect(c0.x0 + 5, y0, c0.w - 10, y1 - y0); }
    }
  }
  // (l) curtain-wall glass (library ground floor)
  {
    const c0 = cell('glass', 704, 512, 1024, 640);
    const grd = gA.createLinearGradient(c0.x0, c0.y0, c0.x0 + 160, c0.y1);
    grd.addColorStop(0, '#9fb3c0'); grd.addColorStop(0.5, '#34444e'); grd.addColorStop(1, '#56666f');
    gA.fillStyle = grd; gA.fillRect(c0.x0, c0.y0, c0.w, c0.h);
    gE.fillStyle = 'rgba(235,240,255,0.9)'; gE.fillRect(c0.x0, c0.y0, c0.w, c0.h);
    for (let i = 0; i <= 8; i++) { const x = c0.x0 + i * (c0.w - 4) / 8; gA.fillStyle = '#c8ccce'; gA.fillRect(x, c0.y0, 4, c0.h); gE.fillStyle = '#000'; gE.fillRect(x, c0.y0, 4, c0.h); }
    gA.fillStyle = '#c8ccce'; gA.fillRect(c0.x0, c0.y0, c0.w, 4); gA.fillRect(c0.x0, c0.y1 - 4, c0.w, 4); gA.fillRect(c0.x0, c0.y0 + 84, c0.w, 3);
  }
  function archApexPx(w, k) { const R = k * w; return Math.sqrt(Math.max(0, R * R - (R - w / 2) ** 2)); }
  // roughness: glass smooth, stone/frames rough - derived from the emissive sheet (glass cells glow)
  mark('atlas');
  const atlasMap = tex(cA, 1, 1, { wrap: false });
  const atlasEm = tex(cE, 1, 1, { wrap: false });
  const winMat = new THREE.MeshStandardMaterial({
    map: atlasMap, emissiveMap: atlasEm, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0,
    roughness: 0.28, metalness: 0.15, envMapIntensity: 1.1,
  });
  winMat.name = 'pennAve-windows';
  M.registerNightMaterial(winMat, 1.25);

  // ------------------------------------------------------------------ roofs, metals, misc
  const leadRoof = new THREE.MeshStandardMaterial({ map: M.surfaceTexture('seam', '#7a7e82', 4, 5), color: '#ffffff', roughness: 0.55, metalness: 0.35 });
  leadRoof.name = 'pennAve-leadRoof';
  const slate = new THREE.MeshStandardMaterial({ map: M.surfaceTexture('tile', '#54575c', 2, 9), color: '#ffffff', roughness: 0.78 });
  slate.name = 'pennAve-slate';
  const clayTile = new THREE.MeshStandardMaterial({ map: M.surfaceTexture('tile', '#6f5646', 2, 13), color: '#ffffff', roughness: 0.82 });
  clayTile.name = 'pennAve-tile';
  const shingle = new THREE.MeshStandardMaterial({ map: M.surfaceTexture('tile', '#5b5d61', 1.6, 17), color: '#ffffff', roughness: 0.92 });
  shingle.name = 'pennAve-shingle';
  const copper = new THREE.MeshStandardMaterial({ map: M.surfaceTexture('copper', '#6f9f8c', 3, 21), color: '#ffffff', roughness: 0.55, metalness: 0.3 });
  copper.name = 'pennAve-copper';
  const dark = new THREE.MeshStandardMaterial({ color: '#2b2927', roughness: 0.9 });
  dark.name = 'pennAve-dark';
  const flatRoof = M.get('flatRoof');
  const metal = new THREE.MeshStandardMaterial({ color: '#3a3d40', roughness: 0.45, metalness: 0.6 });
  metal.name = 'pennAve-metal';

  // Motor Square Garden dome: verdigris ribs over glazed gores; interior light shows through the glass at night.
  const dome = (() => {
    const W = low ? 256 : 512, Hh = low ? 128 : 256;
    const c = canvas(W, Hh), g = c.getContext('2d'), ce = canvas(W, Hh), ge = ce.getContext('2d');
    const r = rng(77);
    g.fillStyle = '#7fae98'; g.fillRect(0, 0, W, Hh);
    ge.fillStyle = '#000'; ge.fillRect(0, 0, W, Hh);
    const gores = 16, gw = W / gores;
    for (let i = 0; i < gores; i++) {
      const x = i * gw;
      const grd = g.createLinearGradient(x, 0, x + gw, Hh);
      grd.addColorStop(0, '#8ea3ad'); grd.addColorStop(0.5, '#2f3c42'); grd.addColorStop(1, '#55666d');
      g.fillStyle = grd; g.fillRect(x + gw * 0.2, 0, gw * 0.6, Hh);
      g.strokeStyle = 'rgba(40,60,55,0.8)'; g.lineWidth = 1;
      for (let y = 0; y < Hh; y += Hh / 10) { g.beginPath(); g.moveTo(x + gw * 0.2, y); g.lineTo(x + gw * 0.8, y); g.stroke(); }
      g.beginPath(); g.moveTo(x + gw / 2, 0); g.lineTo(x + gw / 2, Hh); g.stroke();
      ge.fillStyle = rgba(255, 220, 160, 0.55 + r() * 0.3); ge.fillRect(x + gw * 0.2, 0, gw * 0.6, Hh);
      // ribs: light verdigris with dark streaks
      g.fillStyle = '#86b59e'; g.fillRect(x - gw * 0.2, 0, gw * 0.4, Hh);
      g.fillStyle = 'rgba(40,70,60,0.35)'; g.fillRect(x + gw * 0.12, 0, 2, Hh);
    }
    const map = tex(c, 1, 1), em = tex(ce, 1, 1);
    const m = new THREE.MeshStandardMaterial({ map, emissiveMap: em, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0, roughness: 0.4, metalness: 0.25 });
    m.name = 'pennAve-dome';
    M.registerNightMaterial(m, 1.0);
    return m;
  })();
  const verdigris = new THREE.MeshStandardMaterial({ map: M.surfaceTexture('copper', '#7fb09a', 2.5, 23), color: '#ffffff', roughness: 0.6, metalness: 0.2 });
  verdigris.name = 'pennAve-verdigris';

  // ------------------------------------------------------------------ facade sheets for the commercial blocks
  // Highland Building (D. H. Burnham & Co., 1910): cream glazed terracotta piers and spandrels, paired sashes per bay.
  function officeFacade(name, { bay, floor, wall, pier, spandrel, pair = 2, winW, winH, sill, lit = 0.45, seed = 1, brick = false }) {
    const BAYS = 2, FLOORS = 4, tileW = bay * BAYS, tileH = floor * FLOORS;
    const ppm = low ? 20 : brick ? 32 : 44, W = Math.round(tileW * ppm), H = Math.round(tileH * ppm);
    const c = canvas(W, H), g = c.getContext('2d'), ce = canvas(W, H), ge = ce.getContext('2d');
    const r = rng(seed), base = hexRgb(wall);
    g.fillStyle = wall; g.fillRect(0, 0, W, H);
    ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
    if (brick) {
      const bh = 0.075 * ppm, bw = 0.23 * ppm;
      for (let y = 0, row = 0; y < H; y += bh, row++) for (let x = -(row % 2) * bw / 2; x < W; x += bw) {
        g.fillStyle = tint(base, 0.9 + r() * 0.18); g.fillRect(x + 1, y + 1, bw - 1, bh - 1);
      }
    } else {
      // terracotta block joints
      g.strokeStyle = tint(base, 0.85, 0.6); g.lineWidth = 1;
      for (let y = 0; y < H; y += 0.45 * ppm) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      for (let i = 0; i < W * H / 900; i++) { g.fillStyle = tint(base, 0.94 + r() * 0.1, 0.5); g.fillRect(r() * W, r() * H, 3, 3); }
    }
    for (let b = 0; b < BAYS; b++) {
      if (pier) { g.fillStyle = pier; g.fillRect(b * bay * ppm, 0, 0.55 * ppm, H); g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(b * bay * ppm + 0.5 * ppm, 0, 0.05 * ppm, H); }
      for (let f = 0; f < FLOORS; f++) {
        const yTop = H - (f + 1) * floor * ppm;
        if (spandrel) { g.fillStyle = spandrel; g.fillRect(b * bay * ppm + 0.55 * ppm, yTop + (floor - sill) * ppm, (bay - 0.55) * ppm, 0.12 * ppm); }
        for (let p = 0; p < pair; p++) {
          const span = (bay - 0.55) / pair, cx = (b * bay + 0.55 + span * (p + 0.5)) * ppm;
          const x = cx - winW * ppm / 2, y = yTop + (floor - sill - winH) * ppm, w = winW * ppm, h = winH * ppm;
          g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x - 2, y - 2, w + 4, h + 4);
          g.fillStyle = '#5c4f42'; g.fillRect(x, y, w, h);
          for (const [a, bb] of [[y + 3, y + h / 2 - 2], [y + h / 2 + 2, y + h - 3]]) {
            const grd = g.createLinearGradient(x, a, x + w, bb);
            grd.addColorStop(0, '#8195a4'); grd.addColorStop(0.55, '#27313a'); grd.addColorStop(1, '#46545e');
            g.fillStyle = grd; g.fillRect(x + 3, a, w - 6, bb - a);
          }
          g.fillStyle = tint(base, 1.08); g.fillRect(x - 3, y + h, w + 6, 0.08 * ppm);
          if (r() < lit) { ge.fillStyle = rgba(255, 205 + r() * 40, 140 + r() * 40, 0.7 + r() * 0.3); ge.fillRect(x + 3, y + 3, w - 6, h - 6); }
        }
      }
    }
    const m = new THREE.MeshStandardMaterial({ map: tex(c, tileW, tileH), emissiveMap: tex(ce, tileW, tileH), emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0, roughness: 0.8 });
    m.name = `pennAve-${name}`;
    M.registerNightMaterial(m, 1.3);
    return m;
  }
  mark('dome');
  const hbFront = officeFacade('hbTerracotta', { bay: 4.4, floor: 3.55, wall: '#e6dcc6', pier: '#efe7d4', spandrel: '#d8ccb2', winW: 1.15, winH: 2.0, sill: 0.85, seed: 3 });
  const hbSide = officeFacade('hbBrick', { bay: 4.4, floor: 3.55, wall: '#c4b49c', brick: true, winW: 1.1, winH: 1.9, sill: 0.9, seed: 5, lit: 0.4 });
  const wallaceFacade = officeFacade('wallace', { bay: 4.8, floor: 4.3, wall: '#8c5d44', brick: true, pier: '#7c4f39', winW: 1.6, winH: 2.4, sill: 0.8, seed: 9, lit: 0.5 });

  // Motor Square Garden plain walls: buff brick
  const msgBrick = M.get('brickYellow');
  // Library (2016 remodel): charcoal standing-seam metal cladding
  const libClad = new THREE.MeshStandardMaterial({ map: M.surfaceTexture('seam', '#34373a', 3, 29), color: '#ffffff', roughness: 0.5, metalness: 0.45 });
  libClad.name = 'pennAve-libClad';
  const white = M.color('#e9e8e3', { roughness: 0.55 });
  const concrete = M.get('concrete');
  const precast = M.color('#cfc8ba', { roughness: 0.85 });
  const redBand = M.color('#b3121c', { roughness: 0.5 });
  const brickRed = M.get('brickRed');

  const mats = {
    stone: stoneMat('stone', { glow: 0.04 }), stoneLit: stoneMat('stoneLit', { glow: 0.55 }), win: winMat, dark, leadRoof, slate, clayTile,
    shingle, copper, flatRoof, metal, dome, verdigris, msgBrick, hbFront, hbSide, wallaceFacade, libClad, white,
    concrete, precast, redBand, brickRed,
  };
  mark('facades');
  const out = { mats, cells, timing };
  CACHE.set(M, out);
  return out;
}
