// College of Fine Arts (Henry Hornbostel, 1912–16) — the Beaux-Arts "textbook of architecture" that closes the
// east end of the Mall. Cream Kittanning brick with cream terracotta/limestone trim; pale grey-green standing-seam
// hipped roofs with green-copper eaves (as on Baker/Porter/Hamerschlag). The lawn front is a U: two taller end
// pavilions under their own low hips frame a one-storey arcade of five equal carved-limestone niches — Medieval,
// Greek, the Roman entrance niche in the middle (coffered vault, CREARE above), Renaissance and "World" — with no
// windows between them, under a frieze of cartouches and a modillioned cornice. Behind the arcade the centre steps
// back to a court over the skylit Great Hall; one row of square-headed windows looks over it from the east range.
// Refs: Commons "College of Fine Arts, Carnegie Mellon University, 2023-04-27, 01.jpg" and "…in sunset light,
// 2024-05-23.jpg" (front), "…2023-04-27, 03.jpg" (pavilion flank); Esri World Imagery (roof plan).
import * as THREE from 'three';
import { footprintFrame } from '../core/placement.js';
import {
  Bag, makeFrame, orientRing, ringWalls, profileRing, hipRoof, column, archPoints, outlinePanel,
  facadeMatrix, wallWithHoles, recess, groundAlong, latheGeo, wallQuad, flatPolygon, DEG, prng, settleMallEast,
} from './lib/mallEast-kit.js';
import { getKitMaterials, painters, HB } from './lib/mallEast-materials.js';
import posnerDefs from './lib/mallEast-posner.js';

const OSM_ID = 'w27591225';
const { canvas, tex, noise } = painters;
const TEX_CACHE = new WeakMap(); // ctx.materials → CFA canvases

// ---------------------------------------------------------------- CFA-specific canvases
function cfaTextures(ctx) {
  const M = ctx.materials;
  if (TEX_CACHE.has(M)) return TEX_CACHE.get(M);
  const aniso = Math.min(8, ctx.renderer?.capabilities?.getMaxAnisotropy?.() ?? 4);

  // Coffered vault: 1 m square coffers with stepped bevels and a gilt rosette.
  const cc = canvas(256, 256), g = cc.getContext('2d');
  g.fillStyle = HB.limestone; g.fillRect(0, 0, 256, 256);
  noise(g, 256, 256, prng(3), 0.05, 2);
  const steps = [[22, '#b9ae98'], [40, '#cfc5b0'], [58, '#a99e88']];
  for (const [inset, col] of steps) { g.fillStyle = col; g.fillRect(inset, inset, 256 - 2 * inset, 256 - 2 * inset); }
  g.fillStyle = '#c7bca6'; g.fillRect(70, 70, 116, 116);
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(22, 22, 212, 4); g.fillRect(22, 22, 4, 212);
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(22, 230, 212, 4); g.fillRect(230, 22, 4, 212);
  g.fillStyle = '#c9a24e';
  for (let k = 0; k < 8; k++) { g.beginPath(); const a = (k / 8) * Math.PI * 2; g.ellipse(128 + Math.cos(a) * 16, 128 + Math.sin(a) * 16, 11, 6, a, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#e2c572'; g.beginPath(); g.arc(128, 128, 10, 0, Math.PI * 2); g.fill();
  const coffer = tex(cc, { repeat: [1 / 1.05, 1 / 1.05], aniso });

  // Niche relief atlas: 4 panels (256 × 512 each) — Greek, Medieval, Renaissance, World. Drawn in 1024 × 512
  // units; quality 'low' paints it at half resolution (a quarter of the texture memory).
  const as = ctx.quality?.level === 'low' ? 0.5 : 1;
  const ac = canvas(1024 * as, 512 * as), a = ac.getContext('2d');
  const r = prng(77);
  a.fillStyle = HB.limestone; a.fillRect(0, 0, 1024 * as, 512 * as);
  noise(a, 1024 * as, 512 * as, r, 0.06, 2);
  a.scale(as, as);
  const emboss = (draw, light = '#ebe4d4', dark = 'rgba(70,58,40,0.55)') => {
    a.save(); a.translate(2.5, 3); a.fillStyle = dark; a.strokeStyle = dark; draw(true); a.restore();
    a.save(); a.fillStyle = light; a.strokeStyle = light; draw(false); a.restore();
  };
  const pediment = (x0, x1, y, h) => (/* */ a.beginPath(), a.moveTo(x0, y), a.lineTo((x0 + x1) / 2, y - h), a.lineTo(x1, y), a.closePath());
  // Greek: pediment, triglyph frieze, meander band, antefixes
  {
    const X = 0;
    emboss(() => { pediment(X + 20, X + 236, 150, 60); a.fill(); });
    a.fillStyle = '#cfc6b2'; pediment(X + 44, X + 212, 140, 42); a.fill();
    emboss(() => { a.fillRect(X + 18, 152, 220, 24); });
    for (let i = 0; i < 7; i++) emboss(() => { a.fillRect(X + 26 + i * 31, 180, 12, 34); });
    a.lineWidth = 4;
    emboss(() => { a.beginPath(); for (let i = 0; i < 9; i++) { const x = X + 20 + i * 24; a.moveTo(x, 470); a.lineTo(x, 446); a.lineTo(x + 18, 446); a.lineTo(x + 18, 462); a.lineTo(x + 8, 462); a.lineTo(x + 8, 454); } a.stroke(); }, '#efe8d8');
    for (let i = 0; i < 5; i++) emboss(() => { a.beginPath(); a.arc(X + 48 + i * 40, 90, 7, 0, Math.PI * 2); a.fill(); });
  }
  // Medieval: gothic tracery — twin lancets, rose window, crockets
  {
    const X = 256;
    a.lineWidth = 5;
    emboss(() => { a.beginPath(); a.arc(X + 128, 118, 62, 0, Math.PI * 2); a.stroke(); });
    for (let k = 0; k < 8; k++) emboss(() => { const t = (k / 8) * Math.PI * 2; a.beginPath(); a.arc(X + 128 + Math.cos(t) * 36, 118 + Math.sin(t) * 36, 18, 0, Math.PI * 2); a.stroke(); });
    emboss(() => { a.beginPath(); a.arc(X + 128, 118, 14, 0, Math.PI * 2); a.fill(); });
    for (const cx of [X + 74, X + 182]) {
      emboss(() => {
        a.beginPath(); a.moveTo(cx - 36, 470); a.lineTo(cx - 36, 280);
        a.arc(cx + 36, 280, 72, Math.PI, Math.PI * 4 / 3); a.arc(cx - 36, 280, 72, -Math.PI / 3, 0); a.lineTo(cx + 36, 470); a.stroke();
      });
      a.fillStyle = '#bfb49d'; a.fillRect(cx - 30, 290, 60, 176);
      emboss(() => { a.beginPath(); a.arc(cx, 250, 14, 0, Math.PI * 2); a.stroke(); });
    }
  }
  // Renaissance: shell niche, garlands, pilasters with panels, segmental pediment
  {
    const X = 512;
    emboss(() => { a.beginPath(); a.moveTo(X + 30, 120); a.quadraticCurveTo(X + 128, 40, X + 226, 120); a.lineTo(X + 226, 134); a.quadraticCurveTo(X + 128, 58, X + 30, 134); a.fill(); });
    a.lineWidth = 3;
    for (let k = 0; k < 11; k++) emboss(() => { const t = Math.PI + (k / 10) * Math.PI; a.beginPath(); a.moveTo(X + 128, 250); a.lineTo(X + 128 + Math.cos(t) * 58, 250 + Math.sin(t) * 58); a.stroke(); });
    emboss(() => { a.beginPath(); a.arc(X + 128, 250, 60, Math.PI, 0); a.stroke(); });
    for (const cx of [X + 28, X + 228]) emboss(() => { a.fillRect(cx - 12, 150, 24, 320); });
    a.lineWidth = 5;
    emboss(() => { a.beginPath(); a.moveTo(X + 50, 170); a.quadraticCurveTo(X + 90, 215, X + 128, 175); a.quadraticCurveTo(X + 166, 215, X + 206, 170); a.stroke(); });
    emboss(() => { a.beginPath(); a.ellipse(X + 128, 420, 44, 26, 0, 0, Math.PI * 2); a.fill(); });
  }
  // World: Egyptian winged disc, Islamic eight-point stars, Chinese fret, Mayan steps, lotus band
  {
    const X = 768;
    emboss(() => { a.beginPath(); a.arc(X + 128, 92, 20, 0, Math.PI * 2); a.fill(); a.beginPath(); a.moveTo(X + 104, 92); a.quadraticCurveTo(X + 60, 70, X + 22, 96); a.quadraticCurveTo(X + 60, 104, X + 104, 102); a.fill(); a.beginPath(); a.moveTo(X + 152, 92); a.quadraticCurveTo(X + 196, 70, X + 234, 96); a.quadraticCurveTo(X + 196, 104, X + 152, 102); a.fill(); });
    const star = (cx, cy, R) => { a.beginPath(); for (let k = 0; k < 16; k++) { const t = (k / 16) * Math.PI * 2, rr = k % 2 ? R * 0.62 : R; a.lineTo(cx + Math.cos(t) * rr, cy + Math.sin(t) * rr); } a.closePath(); a.fill(); };
    for (const [cx, cy] of [[X + 70, 190], [X + 186, 190], [X + 128, 250]]) emboss(() => star(cx, cy, 30));
    a.lineWidth = 4;
    emboss(() => { a.beginPath(); for (let i = 0; i < 6; i++) { const x = X + 22 + i * 36; a.moveTo(x, 330); a.lineTo(x + 28, 330); a.lineTo(x + 28, 350); a.lineTo(x + 8, 350); a.lineTo(x + 8, 340); a.lineTo(x + 18, 340); } a.stroke(); });
    emboss(() => { a.beginPath(); a.moveTo(X + 30, 470); for (let s = 0; s < 5; s++) { a.lineTo(X + 30 + s * 20, 470 - (s + 1) * 18); a.lineTo(X + 30 + (s + 1) * 20, 470 - (s + 1) * 18); } for (let s = 4; s >= 0; s--) { a.lineTo(X + 130 + (4 - s) * 20, 470 - (s + 1) * 18); a.lineTo(X + 130 + (5 - s) * 20, 470 - s * 18); } a.lineTo(X + 230, 470); a.closePath(); a.fill(); });
    for (let i = 0; i < 6; i++) emboss(() => { const x = X + 30 + i * 39; a.beginPath(); a.moveTo(x, 40); a.quadraticCurveTo(x + 12, 10, x + 24, 40); a.fill(); });
  }
  const atlas = tex(ac, { aniso });
  atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
  const out = { coffer, atlas };
  TEX_CACHE.set(M, out);
  return out;
}

// The arcade frieze: carved cartouches naming the arts over the four side niches, CREARE over the Roman entrance.
const FRIEZE_WORDS = [[-2, 'PAINTING'], [-1, 'ARCHITECTURE'], [1, 'MUSIC'], [2, 'DRAMA']];
function frieze(ctx, half, pitch) {
  const K = getKitMaterials(ctx);
  const L = 2 * half;
  const u = (x) => (x + half) / L;
  return K.text('cfa-frieze', {
    text: '', wM: L, hM: 1.1, ppm: 52, bg: HB.terracotta, ink: '#6b5a41', fill: 0.42,
    items: [
      ...FRIEZE_WORDS.map(([k, t]) => ({ text: t, u: u(k * pitch), size: 0.36 })),
      { text: 'CREARE', u: 0.5, size: 0.6 },
    ],
  });
}

// Paint cartouche frames onto the frieze texture once (after text): ovals around each word + mouldings
function decorateFrieze(mat, half, pitch) {
  if (mat.userData.decorated) return;
  const img = mat.map.image, g = img.getContext('2d');
  const W = img.width, H = img.height, L = 2 * half;
  g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, H - 4, W, 3); g.fillRect(0, 3, W, 2);
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, 0, W, 2);
  g.lineWidth = 2; g.strokeStyle = 'rgba(96,78,52,0.75)';
  const centres = FRIEZE_WORDS.map(([k, t]) => [k * pitch, t.length > 8 ? 4.6 : 3.4]);
  centres.push([0, 3.0]);
  for (const [x, wM] of centres) {
    const cx = ((x + half) / L) * W, w = (wM / L) * W;
    g.beginPath(); g.ellipse(cx - w / 2, H / 2, H * 0.3, H * 0.34, 0, Math.PI / 2, Math.PI * 1.5); g.lineTo(cx + w / 2, H / 2 - H * 0.34);
    g.ellipse(cx + w / 2, H / 2, H * 0.3, H * 0.34, 0, -Math.PI / 2, Math.PI / 2); g.closePath(); g.stroke();
  }
  // gilt rosettes between the cartouches
  g.fillStyle = HB.polyGold;
  for (let x = -half + 1; x < half; x += 1.65) {
    if (centres.some(([c, wM]) => Math.abs(c - x) < wM / 2 + 0.7)) continue;
    g.beginPath(); g.arc(((x + half) / L) * W, H / 2, H * 0.12, 0, Math.PI * 2); g.fill();
  }
  mat.map.needsUpdate = true;
  mat.userData.decorated = true;
}

// Glazed skylight: grey-green glass with copper glazing bars every 1.2 m (metre UVs).
const SKY_CACHE = new WeakMap();
function skylightMaterial(ctx) {
  const M = ctx.materials;
  if (SKY_CACHE.has(M)) return SKY_CACHE.get(M);
  const c = canvas(128, 128), g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 128, 128);
  grd.addColorStop(0, '#9fb5b4'); grd.addColorStop(1, '#58706f');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#4f7f6c'; g.fillRect(0, 0, 9, 128); g.fillRect(0, 0, 128, 5);
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(9, 5, 3, 123);
  const m = new THREE.MeshStandardMaterial({ map: tex(c, { repeat: [1 / 1.2, 1 / 1.2] }), roughness: 0.15, metalness: 0.45, envMapIntensity: 1.3, emissive: new THREE.Color('#ffd9a0'), emissiveMap: null });
  m.name = 'cfa-skylight';
  M.registerNightMaterial(m, 0.1);
  SKY_CACHE.set(M, m);
  return m;
}

// Outline of an arch surround of width fr around an opening (x centre, y0 base, w, h): the opening is a
// notch reaching down to y0, so the surround can be extruded as one simple polygon.
function horseshoe(x, y0, w, h, fr, segs = 12) {
  const inner = archPoints(x - w / 2, y0, w, h, 'round', { segs });
  const outer = archPoints(x - w / 2 - fr, y0, w + 2 * fr, h + fr, 'round', { segs });
  return [outer[0], inner[0], ...inner.slice(1).reverse().slice(0, -1), inner[1], ...outer.slice(1)];
}

// Simple draped statue (lathe robe + head) standing at (x, y, z) in bag-local space.
function statue(bag, mat, x, y, z, h = 1.7) {
  const s = h / 1.7;
  const g = latheGeo([[0.001, 0], [0.26 * s, 0], [0.27 * s, 0.1 * s], [0.23 * s, 0.7 * s], [0.19 * s, 1.2 * s], [0.22 * s, 1.36 * s], [0.16 * s, 1.46 * s], [0.07 * s, 1.5 * s], [0.001, 1.5 * s]], 10);
  bag.geo(mat, g, { matrix: new THREE.Matrix4().makeTranslation(x, y, z), uv: 'keep' });
  g.dispose();
  const hg = new THREE.SphereGeometry(0.12 * s, 10, 8);
  bag.geo(mat, hg, { matrix: new THREE.Matrix4().makeTranslation(x, y + 1.6 * s, z) });
  hg.dispose();
}

// Triangular pediment prism in panel space (u centre, v base, width, height, depth) placed with matrix.
function pedimentPrism(bag, mat, cu, v0, w, h, w0, w1, matrix) {
  const shape = new THREE.Shape([new THREE.Vector2(cu - w / 2, v0), new THREE.Vector2(cu + w / 2, v0), new THREE.Vector2(cu, v0 + h)]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: w0 - w1, bevelEnabled: false });
  g.translate(0, 0, w1);
  bag.geo(mat, g, { matrix, uv: 'keep' });
  g.dispose();
}

// Modillion blocks under a cornice corona along an (area2 < 0 oriented) path.
function modillions(bag, mat, path, y, closed = true, out = 0.55) {
  const n = path.length, m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const a = path[i], c = path[(i + 1) % n];
    const dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz);
    if (L < 1) continue;
    const ox = -dz / L, oz = dx / L, ang = Math.atan2(dz, dx);
    const cnt = Math.floor((L - 0.6) / 0.62);
    for (let k = 0; k <= cnt; k++) {
      const t = (0.3 + k * 0.62 + (L - 0.6 - cnt * 0.62) / 2) / L;
      bag.box(mat, a[0] + dx * t + ox * out, y, a[1] + dz * t + oz * out, 0.16, 0.2, 0.62, -ang);
    }
  }
}

async function buildCFA(ctx) {
  const b = ctx.data.buildings.find((x) => x.osmId === OSM_ID || x.id === OSM_ID);
  if (!b) { console.warn('[cfa] building not in data'); return null; }
  const K = getKitMaterials(ctx);
  const T = cfaTextures(ctx);
  const fp = footprintFrame(b.footprint);
  let frame = makeFrame(fp.center, fp.angle);
  // Front (+z local) must face the CFA lawn / the Mall (west).
  const lawn = ctx.data.areas.find((a) => a.name === 'CFA Lawn');
  let lawnPt = [-32, 129];
  if (lawn) { let sx = 0, sz = 0; for (const p of lawn.polygon) { sx += p[0]; sz += p[1]; } lawnPt = [sx / lawn.polygon.length, sz / lawn.polygon.length]; }
  if (frame.toLocal(...lawnPt)[1] < 0) frame = makeFrame(fp.center, fp.angle + Math.PI);

  // ------------------------------------------------ massing
  // (Commons photos 2023–24 + Esri imagery) The whole lawn front is one plane at ground level: a one-storey
  // arcade range with five equal niches runs between the two end pavilions. Above it the centre steps back
  // ~17–20 m to a lower east range, leaving a court over the skylit Great Hall, so from the lawn the building reads
  // as a U: taller end pavilions under their own low hips, the arcade and its frieze, and one row of square-headed
  // windows in the recessed centre.
  const hx = fp.length / 2, hz = fp.width / 2;
  const PAV = Math.min(20.5, hx * 0.52);           // end pavilion width along the front
  const xc = hx - PAV;                              // half width of the court between the pavilions
  const AD = 5.6, zA = hz - AD;                     // arcade range depth / its back wall
  const zR = Math.max(-hz + 12, hz - 17);           // court wall of the east range
  const TD = 4.0;                                   // paved terrace in front of the arcade
  const PITCH = Math.min(6.6, (2 * xc - 6) / 4.5);  // niche spacing (five equal niches, no windows between)
  const TX0 = -xc - 2, TX1 = xc + 2;                // terrace extent

  // Levels: the terrace follows the highest lawn in front of the arcade; the niche floors are one step up.
  let G = -Infinity;
  for (let x = TX0; x <= TX1 + 1e-6; x += 2) for (const z of [hz + 0.5, hz + TD / 2, hz + TD - 0.3]) { const [wx, wz] = frame.toWorld(x, z); G = Math.max(G, ctx.heightAt(wx, wz)); }
  const TT = G + 0.05;                              // terrace top
  const F = TT + 0.1;                               // floor datum
  const floorV = F + 0.15;                          // niche floors
  const outline = orientRing([[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]]);
  const g = groundAlong(ctx, frame, outline);
  const yBase = Math.min(g.min, TT) - 1.6;
  const AT = F + 8.0, ACOR = F + 9.1, AROOF = F + 10.0;  // arcade wall top (frieze) / cornice / roof eave
  const CROOF = F + 9.0;                                   // court roof over the Great Hall
  const EAVE = F + 16.4, PEAVE = F + 17.4;                 // east range / pavilion eaves
  const DAT = F - 4.2;                                     // facade datum: one basement storey below the floor
  const low = ctx.quality?.level === 'low';

  const bag = new Bag();
  const mBrick = K.brick(), mTrim = K.trim(), mLime = K.limestone(), mGran = K.granite();
  const mWin = K.window(false), mWinLit = K.window(true);
  const mRoof = K.roof(), mEave = K.eave(), mPaver = K.paver();
  const mCoffer = new THREE.MeshStandardMaterial({ map: T.coffer, roughness: 0.75, emissive: new THREE.Color('#ffb877'), emissiveMap: T.coffer });
  mCoffer.name = 'cfa-coffer';
  ctx.materials.registerNightMaterial(mCoffer, 0.35);
  const mNiche = new THREE.MeshStandardMaterial({ map: T.atlas, roughness: 0.8, emissive: new THREE.Color('#ffc890'), emissiveMap: T.atlas });
  mNiche.name = 'cfa-niche-relief';
  ctx.materials.registerNightMaterial(mNiche, 0.4);
  const mFrieze = frieze(ctx, xc, PITCH);
  decorateFrieze(mFrieze, xc, PITCH);
  // flat-on-the-wall detail: never worth a shadow draw call
  for (const m of [mWin, mWinLit, mFrieze, mNiche, mCoffer]) bag.setOptions(m, { castShadow: false });
  const rnd = prng(1916);
  const winMat = () => (rnd() < 0.45 ? mWinLit : mWin);

  // Painted facade for the pavilion ends, the back and the east range (v datum = one basement storey below the floor)
  const mSide = K.facade({
    key: 'cfa-side', bay: 4.0, bays: 4, height: PEAVE - DAT, seed: 16, lit: 0.4,
    bands: [
      { y0: 0, y1: 4.2, color: '#c9b287', rust: 0.45 },
      { y0: 4.2, y1: 4.8, color: '#8f8a84' },
      { y0: 11.0, y1: 11.4, color: HB.terracotta },
      { y0: 19.8, y1: 21.6, color: HB.terracotta },
    ],
    rows: [
      { sill: 1.9, w: 1.4, h: 1.4, shape: 'rect', lintel: HB.terracotta },
      { sill: 6.0, w: 1.8, h: 3.6, shape: 'rect', lintel: HB.terracotta },
      { sill: 11.8, w: 2.0, h: 4.0, shape: 'arch', surround: HB.terracotta },
      { sill: 16.6, w: 1.8, h: 2.6, shape: 'rect', lintel: HB.terracotta },
    ],
  });
  // Court walls: one tall storey of square-headed windows with carved spandrel panels (nine across the east range)
  const CB = (2 * xc) / 9;
  const mCourt = K.facade({
    key: 'cfa-court', bay: CB, bays: 3, height: PEAVE - DAT, seed: 17, lit: 0.55,
    bands: [{ y0: 19.8, y1: 21.6, color: HB.terracotta }],
    rows: [{ sill: 16.4, w: 2.1, h: 3.1, shape: 'rect', mullions: 3, transom: 0.7, panel: 0.8, lintel: HB.terracotta }],
  });

  // ------------------------------------------------ the arcade: five equal niches, the Roman entrance in the middle
  const NW = 4.0, NH = 6.2, NFR = 0.42, ND = 1.9, RD = 3.8;   // opening width/height, frame, depth (Roman: RD)
  const STYLES = [1, 0, -1, 2, 3];                              // Medieval, Greek, (Roman), Renaissance, World
  const niches = [-2, -1, 0, 1, 2].map((k, i) => ({ x: k * PITCH, w: NW, h: NH, fr: NFR, d: k === 0 ? RD : ND, roman: k === 0, style: STYLES[i] }));
  const slabDepth = 1.2;
  const M4 = facadeMatrix(0, hz);
  {
    const u0 = -xc, u1 = xc;
    const plTop = F + 0.6, plBot = F - 0.45;
    // granite plinth course, notched by the niche frames
    const plOutline = [[u0, plBot], [u1, plBot], [u1, plTop]];
    for (let i = niches.length - 1; i >= 0; i--) {
      const o = niches[i], half = o.w / 2 + o.fr;
      plOutline.push([o.x + half, plTop], [o.x + half, floorV - 0.02], [o.x - half, floorV - 0.02], [o.x - half, plTop]);
    }
    plOutline.push([u0, plTop]);
    wallWithHoles(bag, mGran, plOutline, [], slabDepth + 0.15, M4.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.15)));
    // brick wall up to the cornice, notched by the niche arches (no windows between the niches)
    const bottom = [[u0, plTop]];
    for (const o of niches) {
      const pts = archPoints(o.x - o.w / 2 - o.fr, plTop, o.w + 2 * o.fr, o.h + o.fr - (plTop - floorV), 'round', { segs: 16 });
      bottom.push(pts[0], ...pts.slice(1).reverse().slice(0, -1), pts[1]);
    }
    wallWithHoles(bag, mBrick, [...bottom, [u1, plTop], [u1, ACOR], [u0, ACOR]], [], slabDepth, M4);
    // carved frieze of cartouches under the cornice
    outlinePanel(bag, mFrieze, [[u0, AT], [u1, AT], [u1, ACOR], [u0, ACOR]], facadeMatrix(0, hz + 0.03), { uvMode: 'unit' });
    bag.box(mTrim, 0, AT - 0.1, hz + 0.08, 2 * xc, 0.2, 0.16);   // architrave fillet
  }
  for (const o of niches) {
    const w0 = -slabDepth;
    const pts = archPoints(o.x - o.w / 2, floorV, o.w, o.h, 'round', { segs: 16 });
    // limestone archivolt, slightly proud of the wall: outline with the opening as a notch
    const fg = new THREE.ExtrudeGeometry(new THREE.Shape(horseshoe(o.x, floorV, o.w, o.h, o.fr, 16).map(([u, v]) => new THREE.Vector2(u, v))), { depth: slabDepth + 0.14, bevelEnabled: false, curveSegments: 6 });
    fg.translate(0, 0, -slabDepth);
    bag.geo(mLime, fg, { matrix: M4, uv: 'keep' });
    fg.dispose();
    bag.box(mLime, o.x, floorV + o.h + o.fr * 0.55, hz + 0.2, 0.6, 0.9, 0.3);   // keystone
    const spring = floorV + o.h - o.w / 2;
    if (o.roman) {
      // Roman niche = the entrance: coffered half-dome vault, bronze doors, glazed lunette, the two busts
      recess(bag, mLime, pts, w0, -o.d, M4, {
        floorMat: mPaver,
        matFn: (a, b2) => (Math.min(a[1], b2[1]) >= spring - 0.01 ? mCoffer : mLime),
      });
      const back = M4.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, -o.d));
      outlinePanel(bag, mLime, pts, back);
      const dw = 2.2, dh = 3.2, zb = hz - o.d;
      bag.box(K.bronze(), o.x, floorV + 0.5 + dh / 2, zb + 0.08, dw, dh, 0.16);
      for (const sx of [-1, 1]) for (let k = 0; k < 2; k++) bag.box(K.bronze(), o.x + sx * dw / 4, floorV + 1.05 + k * 1.5, zb + 0.19, dw / 2 - 0.3, 1.2, 0.06);
      bag.box(mLime, o.x, floorV + 0.25, zb + 0.9, dw + 1.2, 0.5, 1.8);               // inner step
      bag.box(mLime, o.x, floorV + 0.5 + dh + 0.25, zb + 0.12, dw + 0.8, 0.5, 0.24);  // door head
      for (const sx of [-1, 1]) bag.box(mLime, o.x + sx * (dw / 2 + 0.25), floorV + 0.5 + dh / 2, zb + 0.14, 0.3, dh, 0.28); // door jambs
      const lun = archPoints(o.x - 1.6, spring, 3.2, 1.6, 'round', { segs: 14 });
      outlinePanel(bag, mWinLit, lun, back.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.03)), { uvMode: 'unit' });
      // busts on brackets (Hornbostel as Bacchus, Purnell as Mercury)
      for (const sx of [-1, 1]) {
        const bx = o.x + sx * (o.w / 2 - 0.45), bz = hz - o.d * 0.55;
        bag.box(mLime, bx, floorV + 3.1, bz, 0.5, 0.35, 0.5);
        const hg = new THREE.SphereGeometry(0.24, 12, 10);
        bag.geo(mLime, hg, { matrix: new THREE.Matrix4().makeTranslation(bx, floorV + 3.55, bz) }); hg.dispose();
        bag.box(mLime, bx, floorV + 3.3, bz, 0.34, 0.2, 0.26);
      }
    } else {
      const st = o.style;
      recess(bag, mLime, pts, w0, -o.d, M4, {
        floorMat: mPaver,
        backMat: mNiche, backUV: 'unit', backUvRect: [st * 0.25, 0, st * 0.25 + 0.25, 1],
      });
      bag.box(mLime, o.x, floorV + 0.23, hz - o.d + 0.28, o.w - 0.3, 0.46, 0.55);   // stone bench along the back
      const bz = hz - o.d + 0.62; // front plane for sculpture
      if (!low) {
        if (st === 0) { // Greek: three orders under an entablature and pediment
          const orders = ['doric', 'ionic', 'corinthian'];
          for (let k = 0; k < 3; k++) column(bag, mLime, o.x - 1.2 + k * 1.2, bz, floorV + 0.46, 3.2, 0.15, { order: orders[k], segs: 10 });
          bag.box(mLime, o.x, floorV + 3.9, bz, 3.1, 0.5, 0.5);
          pedimentPrism(bag, mLime, o.x, floorV + 4.15, 3.3, 0.7, hz - o.d + 0.9, hz - o.d + 0.3, new THREE.Matrix4());
        } else if (st === 1) { // Medieval: two saints under pointed canopies
          for (const sx of [-1, 1]) {
            const cx = o.x + sx * 1.05;
            bag.box(mLime, cx, floorV + 0.95, bz, 0.7, 1.0, 0.6);
            statue(bag, mLime, cx, floorV + 1.45, bz, 1.75);
            const cone = new THREE.ConeGeometry(0.42, 1.1, 8);
            bag.geo(mLime, cone, { matrix: new THREE.Matrix4().makeTranslation(cx, floorV + 3.9, bz) }); cone.dispose();
          }
        } else if (st === 2) { // Renaissance: statue on a pedestal between pilasters
          bag.box(mLime, o.x, floorV + 0.9, bz, 0.9, 0.9, 0.7);
          statue(bag, mLime, o.x, floorV + 1.35, bz, 1.95);
          for (const sx of [-1, 1]) bag.box(mLime, o.x + sx * 1.55, floorV + 2.3, hz - o.d + 0.12, 0.4, 3.7, 0.24);
        } else { // World: Egyptian lotus columns carrying a cavetto lintel
          for (const sx of [-1, 1]) column(bag, mLime, o.x + sx * 1.15, bz, floorV + 0.46, 3.4, 0.23, { order: 'egyptian', segs: 12, plinth: false });
          bag.box(mLime, o.x, floorV + 4.0, bz, 3.1, 0.4, 0.6);
          bag.box(mLime, o.x, floorV + 4.3, bz + 0.05, 3.5, 0.2, 0.75);
        }
      }
    }
  }

  // ------------------------------------------------ terrace along the arcade, with flights down to the lawn
  const walkQuads = [];   // [u0, u1, z0, z1, y]
  {
    const ring = orientRing([[TX0, hz], [TX1, hz], [TX1, hz + TD], [TX0, hz + TD]]);
    for (let i = 0; i < 4; i++) wallQuad(bag, mGran, ring[i], ring[(i + 1) % 4], yBase, TT, 0, 0);
    flatPolygon(bag, mPaver, ring, TT, true);
    bag.box(mGran, (TX0 + TX1) / 2, TT + 0.03, hz + TD - 0.2, TX1 - TX0 + 0.02, 0.1, 0.42);   // coping
    walkQuads.push([TX0, TX1, hz, hz + TD, TT]);
    for (const o of niches) {
      let zc = hz + TD, top = TT - 0.17;
      const wS = o.w + 2 * o.fr + 0.6;
      for (let k = 0; k < 14; k++) {
        const [tx, tz] = frame.toWorld(o.x, zc + 0.19);
        const gy = ctx.heightAt(tx, tz);
        if (gy >= top - 0.06) break;
        bag.box(mGran, o.x, (gy - 0.5 + top) / 2, zc + 0.18, wS + k * 0.3, top - gy + 0.5, 0.36);
        walkQuads.push([o.x - wS / 2, o.x + wS / 2, zc, zc + 0.36, top]);
        zc += 0.36; top -= 0.17;
      }
    }
  }

  // ------------------------------------------------ end pavilions
  const cornice = [[0, 0], [0.06, 0], [0.06, 0.08], [0.16, 0.14], [0.22, 0.26], [0.22, 0.3], [0.85, 0.33], [0.95, 0.38], [0.95, 0.58], [1.05, 0.64], [1.08, 0.8], [1.0, 0.9], [-0.4, 0.9]];
  const plinth = [[0, 0], [0.14, 0], [0.14, 0.85], [0.04, 1.0], [0, 1.0]];
  for (const sx of [-1, 1]) {
    const xo = sx * hx, xi = sx * xc;                 // outer end / inner (court) side
    const ring = orientRing([[Math.min(xo, xi), -hz], [Math.max(xo, xi), -hz], [Math.max(xo, xi), hz], [Math.min(xo, xi), hz]]);
    // end + back walls (painted Hornbostel facade)
    const endBack = sx < 0 ? [[xi, -hz], [xo, -hz], [xo, hz]] : [[xo, hz], [xo, -hz], [xi, -hz]];
    ringWalls(bag, mSide, endBack, yBase, PEAVE, { datum: DAT, bay: 4.0, closed: false });
    profileRing(bag, mGran, endBack, F - 0.4, plinth, { closed: false });
    // court side: rises above the arcade and the east range roofs
    const inner = sx < 0 ? [[xi, hz], [xi, -hz]] : [[xi, -hz], [xi, hz]];
    wallQuad(bag, mCourt, inner[0], inner[1], CROOF - 0.2, PEAVE, 0, DAT);
    // lawn front: cream brick with framed blind panels below and small carved-surround windows above
    const front = sx < 0 ? [[xo, hz], [xi, hz]] : [[xi, hz], [xo, hz]];
    wallQuad(bag, mBrick, front[0], front[1], yBase, PEAVE, front[0][0], 0);
    profileRing(bag, mGran, front, F - 0.4, plinth, { closed: false });
    const xm = sx * (xc + PAV / 2);
    for (const k of [-1, 0, 1]) {
      const px = xm + k * PAV / 3;
      for (const [y0, y1, pw] of [[F + 1.3, F + 7.4, 3.6], [F + 10.9, F + 12.5, 3.6]]) {
        const fz = hz + 0.06;
        bag.box(mTrim, px, y0, fz, pw + 0.24, 0.2, 0.12);
        bag.box(mTrim, px, y1, fz, pw + 0.24, 0.2, 0.12);
        for (const e of [-1, 1]) bag.box(mTrim, px + e * pw / 2, (y0 + y1) / 2, fz, 0.2, y1 - y0, 0.12);
      }
      const ww = 1.3, wy = F + 13.1, wh = 1.9;
      outlinePanel(bag, winMat(), [[px - ww / 2, wy], [px + ww / 2, wy], [px + ww / 2, wy + wh], [px - ww / 2, wy + wh]], facadeMatrix(0, hz + 0.02), { uvMode: 'unit' });
      bag.box(mTrim, px, wy - 0.1, hz + 0.1, ww + 0.5, 0.2, 0.2);
      bag.box(mTrim, px, wy + wh + 0.18, hz + 0.08, ww + 0.7, 0.36, 0.16);
      for (const e of [-1, 1]) bag.box(mTrim, px + e * (ww / 2 + 0.12), wy + wh / 2, hz + 0.06, 0.24, wh, 0.12);
    }
    bag.box(mTrim, xm, F + 15.95, hz + 0.05, PAV, 0.9, 0.1);   // pavilion frieze band
    profileRing(bag, mTrim, ring, PEAVE - 0.9, cornice);
    if (!low) modillions(bag, mTrim, ring, PEAVE - 0.7);
    hipRoof(bag, mRoof, ring, PEAVE, { overhang: 0.35, inset: Math.min(8, PAV / 2 - 1.5), pitch: 17 * DEG, topMat: mRoof, fasciaMat: mEave, fascia: 0.22 });
  }

  // rusticated quoins at the pavilion corners
  {
    const qTop = F + 15.3, qH = 0.5;
    const nQ = Math.floor((qTop - (F + 0.6)) / qH);
    for (let k = 0; k < nQ; k++) {
      const y = F + 0.6 + k * qH + qH / 2 - 0.02, long = k % 2 === 0;
      const a = long ? 1.0 : 0.6, bq = long ? 0.6 : 1.0;
      for (const sx of [-1, 1]) {
        bag.box(mTrim, sx * (hx - a / 2 + 0.04), y, hz - bq / 2 + 0.04, a + 0.08, qH - 0.05, bq + 0.08);    // front corners
        bag.box(mTrim, sx * (hx - a / 2 + 0.04), y, -hz + bq / 2 - 0.04, a + 0.08, qH - 0.05, bq + 0.08);   // back corners
        bag.box(mTrim, sx * (xc + a / 2 - 0.04), y, hz - 0.09, a, qH - 0.05, 0.3);                          // inner front edge
      }
    }
  }

  // ------------------------------------------------ arcade range: cornice, low roof, back wall over the court
  {
    const front = [[-hx, hz - 1.0], [-hx, hz], [hx, hz], [hx, hz - 1.0]];   // runs across the pavilion fronts too
    profileRing(bag, mTrim, front, ACOR, cornice, { closed: false });
    if (!low) modillions(bag, mTrim, [[-hx, hz], [hx, hz]], ACOR + 0.2, false);
    hipRoof(bag, mRoof, orientRing([[-xc, zA], [xc, zA], [xc, hz], [-xc, hz]]), AROOF, { overhang: 0, inset: AD / 2 - 0.4, pitch: 5 * DEG, topMat: mRoof });
    wallQuad(bag, mBrick, [xc, zA], [-xc, zA], CROOF - 0.2, AROOF, 0, 0);
  }

  // ------------------------------------------------ court over the Great Hall, with its glazed skylight
  {
    flatPolygon(bag, K.flatRoof(), orientRing([[-xc, zR], [xc, zR], [xc, zA], [-xc, zA]]), CROOF, true);
    const zc = (zR + zA) / 2, sw = Math.min(6, xc - 4), sd = Math.max(2, Math.min(4.2, (zA - zR) / 2 - 1.5));
    bag.box(mEave, 0, CROOF + 0.3, zc, 2 * sw + 0.6, 0.6, 2 * sd + 0.6);
    hipRoof(bag, skylightMaterial(ctx), orientRing([[-sw, zc - sd], [sw, zc - sd], [sw, zc + sd], [-sw, zc + sd]]), CROOF + 0.6, { overhang: 0, inset: sd - 0.4, pitch: 28 * DEG, topMat: mEave });
  }

  // ------------------------------------------------ east range: court wall, back wall, cornices, hip roof
  {
    wallQuad(bag, mCourt, [-xc, zR], [xc, zR], CROOF - 0.2, EAVE, 0, DAT);
    const backPath = [[xc, -hz], [-xc, -hz]];
    ringWalls(bag, mSide, backPath, yBase, EAVE, { datum: DAT, bay: 4.0, closed: false });
    profileRing(bag, mGran, backPath, F - 0.4, plinth, { closed: false });
    for (const p of [[[-xc, zR], [xc, zR]], backPath]) {
      profileRing(bag, mTrim, p, EAVE - 0.9, cornice, { closed: false });
      if (!low) modillions(bag, mTrim, p, EAVE - 0.7, false);
    }
    hipRoof(bag, mRoof, orientRing([[-xc, -hz], [xc, -hz], [xc, zR], [-xc, zR]]), EAVE, { overhang: 0.35, inset: Math.min(7, (zR + hz) / 2 - 1.5), pitch: 18 * DEG, topMat: mRoof, fasciaMat: mEave, fascia: 0.22 });
  }

  const [cx, cz] = frame.toWorld(0, 0);
  const entry = { key: 'cfa', kind: 'landmark', name: 'College of Fine Arts', nameZh: '美术学院大楼', osmId: OSM_ID, infoKey: OSM_ID, position: [cx, EAVE, cz], radius: hx + 4 };
  const group = bag.build('cfa', { share: { ctx, entry, frame, materials: K.shared } });
  frame.place(group);

  // ------------------------------------------------ colliders / walkables / pick / label
  const tag = 'cfa';
  const toW = (ring) => frame.ringToWorld(ring);
  const zBack = hz - RD - 0.05;
  ctx.colliders.addPolygon(toW([[-hx, -hz], [hx, -hz], [hx, zBack], [-hx, zBack]]), yBase, PEAVE + 4, tag);
  // front strip: solid between the niche openings and behind the shallow side niches
  let cur = -hx;
  for (const o of [...niches, null]) {
    const a0 = o ? o.x - o.w / 2 : hx, a1 = o ? o.x + o.w / 2 : hx;
    if (a0 - cur > 0.05) ctx.colliders.addPolygon(toW([[cur, zBack], [a0, zBack], [a0, hz], [cur, hz]]), yBase, PEAVE + 4, tag);
    if (o && !o.roman) ctx.colliders.addPolygon(toW([[a0, zBack], [a1, zBack], [a1, hz - o.d], [a0, hz - o.d]]), yBase, PEAVE + 4, tag);
    cur = Math.max(cur, a1);
  }
  // walkable niche floors, terrace and steps
  for (const o of niches) walkQuads.push([o.x - o.w / 2 - o.fr, o.x + o.w / 2 + o.fr, hz - o.d, hz + 0.05, floorV]);
  const wp = [];
  for (const [u0, u1, z0, z1, y] of walkQuads) {
    const c = [[u0, z0], [u1, z0], [u1, z1], [u0, z1]].map(([u, v]) => frame.toWorld(u, v));
    wp.push(c[0][0], y, c[0][1], c[2][0], y, c[2][1], c[1][0], y, c[1][1], c[0][0], y, c[0][1], c[3][0], y, c[3][1], c[2][0], y, c[2][1]);
  }
  const walkG = new THREE.BufferGeometry();
  walkG.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
  walkG.computeVertexNormals();
  const walk = new THREE.Mesh(walkG, K.walkHidden());
  walk.name = 'cfa-walkable';
  walk.updateMatrixWorld(true);
  ctx.walkables.add(walk);

  ctx.pick.add(group, entry);
  const [lx, lz] = frame.toWorld(0, zA - 4);
  ctx.labels.add({ key: 'cfa', text: 'College of Fine Arts', textZh: '美术学院 (CFA)', kind: 'landmark', priority: 9, position: { x: lx, y: PEAVE + 6, z: lz } });
  group.userData.triangles = 0;
  return group;
}

export default [
  {
    key: 'cfa',
    name: 'College of Fine Arts',
    nameZh: '美术学院大楼',
    osmIds: [OSM_ID],
    async build(ctx) { try { return await buildCFA(ctx); } finally { settleMallEast(ctx, 'cfa'); } },
  },
  ...posnerDefs,
];
