// Shared material + procedural texture library. Everything is generated at runtime on <canvas>,
// so the project has no binary texture assets.
//
// UV CONVENTION: every textured material here expects geometry UVs in METRES
// (u = horizontal metres along the surface, v = metres upward / along the second axis).
// Use applyWorldUV(geometry) to convert any geometry to metre UVs (box projection).
import * as THREE from 'three';

export const PALETTE = {
  // Masonry
  brickYellow: '#d2b886', // Hornbostel buff brick (Baker, Porter, Hamerschlag, Doherty, CFA)
  brickBuff: '#c7a673',
  brickRed: '#9a4b37',
  brickBrown: '#76503c',
  brickDark: '#5a3a2c',
  limestone: '#dcd4c2',
  sandstone: '#c9b690',
  granite: '#9c9790',
  concrete: '#bdb8ad',
  concreteDark: '#8f8a82',
  terracotta: '#c7764f',
  stucco: '#e3dccd',
  white: '#eeeae1',
  // Roofs & metal
  copperGreen: '#6b9d88',
  tileRoof: '#8e4b33',
  slate: '#4a4e55',
  zinc: '#858b93',
  aluminium: '#b8bdc3',
  darkMetal: '#35383c',
  bronze: '#6e5537',
  gold: '#c9a04a',
  // Glass
  glass: '#4f6d80',
  glassDark: '#26323b',
  glassGreen: '#5b7f78',
  // Ground
  asphalt: '#3e4043',
  asphaltLight: '#55585b',
  sidewalk: '#b9b3a7',
  paver: '#a99a88',
  grass: '#5c8a3c',
  grassDry: '#8a9a4f',
  dirt: '#7c6a4f',
  water: '#3c6c84',
  trackRed: '#a4473b',
  // Accents
  cmuRed: '#c41230',
  tartanGreen: '#1f5a3a',
  wood: '#8a623f',
  windowWarm: '#ffcf8a',
};

const rand = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function shade(hex, f) {
  const c = new THREE.Color(hex);
  const hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * f)));
  return `#${c.getHexString()}`;
}
function jitterColor(hex, r, amount = 0.08) {
  return shade(hex, 1 + (r() - 0.5) * 2 * amount);
}

// ---------------------------------------------------------------- UV helpers
// Rewrites a geometry's UVs so textures tile in metres. Box projection by dominant normal axis.
// Pass a Matrix4 if the geometry will be transformed afterwards and you want world-consistent UVs.
export function applyWorldUV(geometry, matrix = null) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = g.attributes.position;
  if (!g.attributes.normal) g.computeVertexNormals();
  const nor = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  const nm = matrix ? new THREE.Matrix3().getNormalMatrix(matrix) : null;
  for (let i = 0; i < pos.count; i += 3) {
    // face normal = average of the triangle's vertex normals
    n.set(0, 0, 0);
    for (let k = 0; k < 3; k++) n.x += nor.getX(i + k), n.y += nor.getY(i + k), n.z += nor.getZ(i + k);
    if (nm) n.applyMatrix3(nm);
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(pos, i + k);
      if (matrix) v.applyMatrix4(matrix);
      let u, w;
      if (ay >= ax && ay >= az) { u = v.x; w = v.z; }
      else if (ax >= az) { u = n.x > 0 ? -v.z : v.z; w = v.y; }
      else { u = n.z > 0 ? v.x : -v.x; w = v.y; }
      uv[(i + k) * 2] = u; uv[(i + k) * 2 + 1] = w;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// ---------------------------------------------------------------- texture painters
// Light/dark speckle. A 256² tile is generated once per (alpha, size) with ImageData and then laid down as a
// pattern with a random phase — thousands of times cheaper than one fillRect per speck.
const speckles = new Map();
function speckleTile(alpha, size) {
  const key = `${alpha}:${size}`;
  if (speckles.has(key)) return speckles.get(key);
  const S = 256;
  const c = makeCanvas(S, S), g = c.getContext('2d');
  const img = g.createImageData(S, S), d = img.data;
  const r = rand(9001 + Math.round(alpha * 1000) * 7 + size);
  for (let by = 0; by < S; by += size) for (let bx = 0; bx < S; bx += size) {
    if (r() > 0.4) continue;
    const v = r() > 0.5 ? 255 : 0, a = Math.round(255 * alpha * r());
    for (let y = by; y < Math.min(S, by + size); y++) for (let x = bx; x < Math.min(S, bx + size); x++) {
      const k = (y * S + x) * 4;
      d[k] = d[k + 1] = d[k + 2] = v; d[k + 3] = a;
    }
  }
  g.putImageData(img, 0, 0);
  speckles.set(key, c);
  return c;
}
function paintNoise(ctx2d, w, h, r, alpha = 0.06, size = 2) {
  const pat = ctx2d.createPattern(speckleTile(alpha, size), 'repeat');
  pat.setTransform?.(new DOMMatrix().translateSelf(Math.floor(r() * 256), Math.floor(r() * 256)));
  ctx2d.save();
  ctx2d.fillStyle = pat;
  ctx2d.fillRect(0, 0, w, h);
  ctx2d.restore();
}

// Brick running bond. pxPerM px per metre. Returns painter drawing into region.
function paintBrick(g, x0, y0, w, h, color, pxPerM, r, { mortar = null, brickW = 0.215, brickH = 0.0675, joint = 0.01 } = {}) {
  const mortarColor = mortar || shade(color, 1.18);
  g.fillStyle = mortarColor;
  g.fillRect(x0, y0, w, h);
  const bw = brickW * pxPerM, bh = brickH * pxPerM, j = Math.max(1, joint * pxPerM);
  const rows = Math.ceil(h / (bh + j)) + 1;
  for (let row = 0; row < rows; row++) {
    const y = y0 + row * (bh + j);
    const off = (row % 2) * (bw + j) / 2;
    for (let x = x0 - off; x < x0 + w; x += bw + j) {
      g.fillStyle = jitterColor(color, r, 0.07);
      g.fillRect(Math.max(x0, x), y, Math.min(bw, x0 + w - x), Math.min(bh, y0 + h - y));
    }
  }
}

function paintStone(g, x0, y0, w, h, color, pxPerM, r, { courseH = 0.6, blockW = 1.2 } = {}) {
  g.fillStyle = color; g.fillRect(x0, y0, w, h);
  const ch = courseH * pxPerM, bw = blockW * pxPerM;
  for (let y = y0, row = 0; y < y0 + h; y += ch, row++) {
    for (let x = x0 - (row % 2) * bw / 2; x < x0 + w; x += bw) {
      g.fillStyle = jitterColor(color, r, 0.035);
      g.fillRect(Math.max(x0, x) + 1, y + 1, Math.min(bw, x0 + w - x) - 1, Math.min(ch, y0 + h - y) - 1);
    }
    g.fillStyle = shade(color, 0.86);
    g.fillRect(x0, y, w, 1);
  }
}

function paintConcrete(g, x0, y0, w, h, color, pxPerM, r, { panel = 3 } = {}) {
  g.fillStyle = color; g.fillRect(x0, y0, w, h);
  paintNoise(g, w, h, r, 0.05, 2);
  const p = panel * pxPerM;
  g.strokeStyle = shade(color, 0.85); g.lineWidth = 1;
  for (let x = x0; x < x0 + w; x += p) { g.beginPath(); g.moveTo(x + 0.5, y0); g.lineTo(x + 0.5, y0 + h); g.stroke(); }
}

function paintWall(g, x0, y0, w, h, wall, color, pxPerM, r) {
  if (wall === 'brick') paintBrick(g, x0, y0, w, h, color, pxPerM, r);
  else if (wall === 'stone') paintStone(g, x0, y0, w, h, color, pxPerM, r);
  else if (wall === 'concrete') paintConcrete(g, x0, y0, w, h, color, pxPerM, r);
  else if (wall === 'panel') paintConcrete(g, x0, y0, w, h, color, pxPerM, r, { panel: 1.5 });
  else { g.fillStyle = color; g.fillRect(x0, y0, w, h); paintNoise(g, w, h, r, 0.04, 2); }
}

function glassGradient(g, x, y, w, h, glass, r) {
  const grd = g.createLinearGradient(x, y, x + w * 0.3, y + h);
  grd.addColorStop(0, shade(glass, 1.45));
  grd.addColorStop(0.45, glass);
  grd.addColorStop(1, shade(glass, 0.7));
  g.fillStyle = grd;
  g.fillRect(x, y, w, h);
  // interior hints: blinds / ceiling line
  if (r() < 0.35) { g.fillStyle = 'rgba(235,228,210,0.35)'; g.fillRect(x, y, w, h * (0.15 + r() * 0.5)); }
}

// ---------------------------------------------------------------- relief (normal maps)
// Height fields in metres of relief, painted analytically with the same layout as the colour painters above, then
// turned into tangent-space normal maps (OpenGL convention: +v = up = towards the canvas top, as CanvasTexture flips
// Y). Mortar joints, stone courses, panel joints, roof tiles and seams then catch the sun and the sky like relief.
function sobelNormals(H, w, h, pxPerM, out = makeCanvas(w, h)) {
  const g = out.getContext('2d');
  const img = g.createImageData(w, h), d = img.data;
  const k = pxPerM / 8;                            // Sobel kernel sum → slope per metre
  for (let y = 0; y < h; y++) {
    const ym = ((y - 1 + h) % h) * w, y0 = y * w, yp = ((y + 1) % h) * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w, xp = (x + 1) % w;
      const tl = H[ym + xm], t = H[ym + x], tr = H[ym + xp], l = H[y0 + xm], r = H[y0 + xp], bl = H[yp + xm], b = H[yp + x], br = H[yp + xp];
      const sx = ((tr + 2 * r + br) - (tl + 2 * l + bl)) * k;   // dh/du (m/m)
      const sy = ((bl + 2 * b + br) - (tl + 2 * t + tr)) * k;   // dh/d(canvas y) = -dh/dv
      const inv = 1 / Math.sqrt(sx * sx + sy * sy + 1);
      const i = (y0 + x) * 4;
      d[i] = (-sx * inv * 0.5 + 0.5) * 255; d[i + 1] = (sy * inv * 0.5 + 0.5) * 255; d[i + 2] = (inv * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return out;
}

// Relief height (m) of a tiling surface texture of `kind`, px × px pixels covering tileM metres (same layouts as the
// painters in surfaceTexture / paintWall). Returns null for kinds without relief.
function surfaceRelief(kind, px, tileM, r) {
  const pxPerM = px / tileM, H = new Float32Array(px * px);
  const grain = (a) => { for (let i = 0; i < H.length; i++) H[i] += (r() - 0.5) * a; };
  if (kind === 'brick') {
    const bw = 0.215 * pxPerM, bh = 0.0675 * pxPerM, j = Math.max(1, 0.01 * pxPerM), ph = bh + j, pw = bw + j;
    const face = new Float32Array(64).map(() => (r() - 0.5) * 0.0025);
    for (let y = 0; y < px; y++) {
      const row = Math.floor(y / ph), fy = y - row * ph;
      const off = (row % 2) * pw / 2;
      for (let x = 0; x < px; x++) {
        const u = x + off, col = Math.floor(u / pw), fx = u - col * pw;
        H[y * px + x] = fx < bw && fy < bh ? 0.009 + face[(row * 7 + col) & 63] : 0;
      }
    }
    grain(0.0012);
  } else if (kind === 'stone' || kind === 'paver') {
    const ch = (kind === 'stone' ? 0.6 : 0.15) * pxPerM, bw = (kind === 'stone' ? 1.2 : 0.3) * pxPerM;
    const depth = kind === 'stone' ? 0.02 : 0.008;
    const face = new Float32Array(64).map(() => (r() - 0.5) * depth * 0.4);
    for (let y = 0; y < px; y++) {
      const row = Math.floor(y / ch), fy = y - row * ch;
      const off = (row % 2) * bw / 2;
      for (let x = 0; x < px; x++) {
        const u = x + off, col = Math.floor(u / bw), fx = u - col * bw;
        H[y * px + x] = fx >= 1 && fy >= 1 ? depth + face[(row * 5 + col) & 63] : 0;
      }
    }
    grain(0.0018);
  } else if (kind === 'concrete' || kind === 'panel') {
    const p = (kind === 'panel' ? 1.5 : 3) * pxPerM;
    for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) H[y * px + x] = (x % p) < 1 ? 0 : 0.01;
    grain(0.0015);
  } else if (kind === 'tile') {
    // overlapping tiles: each course rises towards its lower (exposed) edge; gaps between tiles
    const rowH = 0.28 * pxPerM, tw = 0.25 * pxPerM;
    for (let y = 0; y < px; y++) {
      const row = Math.floor(y / rowH), fy = (y - row * rowH) / rowH;
      const off = (row % 2) * tw / 2;
      for (let x = 0; x < px; x++) {
        const fx = (x + off) % tw;
        H[y * px + x] = fx < 1 ? 0 : 0.004 + 0.018 * fy;
      }
    }
  } else if (kind === 'seam' || kind === 'copper') {
    const s = (kind === 'seam' ? 0.5 : 0.45) * pxPerM, sw = kind === 'seam' ? 2 : 1.5;
    for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
      const fx = x % s;
      H[y * px + x] = fx < sw ? 0.025 : fx < sw + 1 ? 0.008 : 0;
    }
    grain(0.0008);
  } else if (kind === 'plain') {
    grain(0.0015);
  } else return null;
  return { H, pxPerM };
}

// ---------------------------------------------------------------- library
export function createMaterials(ctx) {
  const cache = new Map();
  const nightMaterials = new Set();
  const maxAniso = ctx.renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;
  // Relief normal maps: not on 'low' (no extra textures, no extra shader work there).
  const reliefOn = (ctx.quality?.level ?? 'high') !== 'low';
  const normalOf = new WeakMap();   // colour map (surfaceTexture / facade) → { normalMap, scale }

  // release: drop the canvas backing store once three has uploaded it (the GPU keeps its own copy). Only for
  // textures this module never repaints; after a WebGL context restore the page reloads (see main.js).
  function tex(canvas, { repeatW = 1, repeatH = 1, color = true, release = false } = {}) {
    const t = new THREE.CanvasTexture(canvas);
    if (release) t.onUpdate = () => { t.onUpdate = null; canvas.width = canvas.height = 1; };
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / repeatW, 1 / repeatH);
    t.anisotropy = Math.min(8, maxAniso);
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }

  function registerNightMaterial(mat, intensity = 1) {
    mat.userData.nightIntensity = intensity;
    nightMaterials.add(mat);
    mat.emissiveIntensity = (ctx.env?.state?.nightFactor ?? 0) * intensity;
    return mat;
  }

  // Tiling surface texture (brick/stone/concrete/roof) covering tileM x tileM metres.
  function surfaceTexture(kind, color, tileM = 2, seed = 7) {
    const key = `surf:${kind}:${color}:${tileM}:${seed}`;
    if (cache.has(key)) return cache.get(key);
    const px = kind === 'brick' ? 256 : 128;
    const pxPerM = px / tileM;
    const c = makeCanvas(px, px), g = c.getContext('2d'), r = rand(seed * 7919 + 1);
    if (kind === 'tile') {
      g.fillStyle = color; g.fillRect(0, 0, px, px);
      const rowH = 0.28 * pxPerM, tw = 0.25 * pxPerM;
      for (let y = 0, row = 0; y < px; y += rowH, row++) {
        for (let x = -(row % 2) * tw / 2; x < px; x += tw) {
          g.fillStyle = jitterColor(color, r, 0.1);
          g.fillRect(x + 1, y, tw - 2, rowH - 2);
          g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 1, y + rowH - 3, tw - 2, 2);
        }
      }
    } else if (kind === 'seam') { // standing-seam metal roof
      g.fillStyle = color; g.fillRect(0, 0, px, px);
      paintNoise(g, px, px, r, 0.05, 2);
      const s = 0.5 * pxPerM;
      for (let x = 0; x < px; x += s) { g.fillStyle = shade(color, 1.18); g.fillRect(x, 0, 2, px); g.fillStyle = shade(color, 0.8); g.fillRect(x + 2, 0, 1, px); }
    } else if (kind === 'copper') { // patinated copper with streaks
      g.fillStyle = color; g.fillRect(0, 0, px, px);
      for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(${r() > 0.5 ? '40,70,60' : '160,210,190'},${0.08 * r()})`; g.fillRect(r() * px, 0, 1 + r() * 3, px); }
      const s = 0.45 * pxPerM;
      for (let x = 0; x < px; x += s) { g.fillStyle = shade(color, 0.78); g.fillRect(x, 0, 1.5, px); }
    } else if (kind === 'paver') {
      g.fillStyle = shade(color, 0.85); g.fillRect(0, 0, px, px);
      const s = 0.3 * pxPerM;
      for (let y = 0, row = 0; y < px; y += s / 2, row++) for (let x = -(row % 2) * s / 2; x < px; x += s) {
        g.fillStyle = jitterColor(color, r, 0.08); g.fillRect(x + 1, y + 1, s - 2, s / 2 - 2);
      }
    } else {
      paintWall(g, 0, 0, px, px, kind, color, pxPerM, r);
    }
    const t = tex(c, { repeatW: tileM, repeatH: tileM, release: true });
    cache.set(key, t);
    if (reliefOn) {
      // one normal map per (kind, tile size): the relief does not depend on the colour
      const nkey = `relief:${kind}:${tileM}:${seed}`;
      let nt = cache.get(nkey);
      if (nt === undefined) {
        const rel = surfaceRelief(kind, px, tileM, rand(seed * 6271 + 5));
        nt = rel ? tex(sobelNormals(rel.H, px, px, rel.pxPerM), { repeatW: tileM, repeatH: tileM, color: false, release: true }) : null;
        cache.set(nkey, nt);
      }
      if (nt) normalOf.set(t, { normalMap: nt, scale: 1.3 });
    }
    return t;
  }

  // Give standard materials whose colour map came from surfaceTexture() / facade() the matching relief normal map
  // (materials built by other modules from these maps included). Skipped: materials that already have a normal /
  // bump map or patch their shader, meshes without UVs / normals. Idempotent; call before compiling (engine.warm /
  // precompile do). Returns the number of materials upgraded.
  // Also, where the frame is multisampled: alpha-tested cut-outs (chain-link and picket fences, lattices, signs) use
  // alpha-to-coverage — their edges get the MSAA samples instead of a hard, shimmering 1-bit cut.
  const msaa = !!ctx.quality?.antialias;
  function enhance(root) {
    if (!root) return 0;
    let n = 0;
    const seen = new Set();
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (msaa) {
        for (const m of mats) {
          if (m && m.alphaTest > 0 && !m.transparent && !m.alphaToCoverage && m.userData.cmuA2C === undefined) {
            m.userData.cmuA2C = true; m.alphaToCoverage = true; m.needsUpdate = true;
          }
        }
      }
      if (!reliefOn || !o.geometry?.attributes?.uv || !o.geometry.attributes.normal) return;
      for (const m of mats) {
        if (!m || seen.has(m)) continue;
        seen.add(m);
        if (!m.isMeshStandardMaterial || m.normalMap || m.bumpMap || m.userData.cmuRelief !== undefined) continue;
        const e = m.map && normalOf.get(m.map);
        const custom = Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile') || Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey');
        m.userData.cmuRelief = !!(e && !custom);
        if (!m.userData.cmuRelief) continue;
        m.normalMap = e.normalMap;
        m.normalScale.set(e.scale, e.scale);
        m.needsUpdate = true;
        n++;
      }
    });
    return n;
  }

  const PRESETS = {
    brickYellow: () => ({ color: '#ffffff', map: surfaceTexture('brick', PALETTE.brickYellow, 2), roughness: 0.92 }),
    brickBuff: () => ({ color: '#ffffff', map: surfaceTexture('brick', PALETTE.brickBuff, 2), roughness: 0.92 }),
    brickRed: () => ({ color: '#ffffff', map: surfaceTexture('brick', PALETTE.brickRed, 2), roughness: 0.92 }),
    brickBrown: () => ({ color: '#ffffff', map: surfaceTexture('brick', PALETTE.brickBrown, 2), roughness: 0.92 }),
    limestone: () => ({ color: '#ffffff', map: surfaceTexture('stone', PALETTE.limestone, 4), roughness: 0.85 }),
    sandstone: () => ({ color: '#ffffff', map: surfaceTexture('stone', PALETTE.sandstone, 4), roughness: 0.88 }),
    granite: () => ({ color: '#ffffff', map: surfaceTexture('stone', PALETTE.granite, 4), roughness: 0.8 }),
    concrete: () => ({ color: '#ffffff', map: surfaceTexture('concrete', PALETTE.concrete, 6), roughness: 0.9 }),
    concreteDark: () => ({ color: '#ffffff', map: surfaceTexture('concrete', PALETTE.concreteDark, 6), roughness: 0.9 }),
    stucco: () => ({ color: '#ffffff', map: surfaceTexture('plain', PALETTE.stucco, 4), roughness: 0.95 }),
    terracotta: () => ({ color: '#ffffff', map: surfaceTexture('panel', PALETTE.terracotta, 3), roughness: 0.8 }),
    white: () => ({ color: PALETTE.white, roughness: 0.7 }),
    copperRoof: () => ({ color: '#ffffff', map: surfaceTexture('copper', PALETTE.copperGreen, 4), roughness: 0.6, metalness: 0.25 }),
    tileRoof: () => ({ color: '#ffffff', map: surfaceTexture('tile', PALETTE.tileRoof, 2), roughness: 0.85 }),
    slateRoof: () => ({ color: '#ffffff', map: surfaceTexture('tile', PALETTE.slate, 2), roughness: 0.8 }),
    metalRoof: () => ({ color: '#ffffff', map: surfaceTexture('seam', PALETTE.zinc, 4), roughness: 0.45, metalness: 0.6 }),
    flatRoof: () => ({ color: '#ffffff', map: surfaceTexture('concrete', '#8d8a85', 8), roughness: 0.95 }),
    zinc: () => ({ color: PALETTE.zinc, roughness: 0.4, metalness: 0.7 }),
    aluminium: () => ({ color: PALETTE.aluminium, roughness: 0.35, metalness: 0.8 }),
    darkMetal: () => ({ color: PALETTE.darkMetal, roughness: 0.45, metalness: 0.7 }),
    bronze: () => ({ color: PALETTE.bronze, roughness: 0.4, metalness: 0.85 }),
    gold: () => ({ color: PALETTE.gold, roughness: 0.3, metalness: 1 }),
    glass: () => ({ color: PALETTE.glass, roughness: 0.06, metalness: 0.35, envMapIntensity: 1.4 }),
    glassDark: () => ({ color: PALETTE.glassDark, roughness: 0.05, metalness: 0.5, envMapIntensity: 1.5 }),
    glassGreen: () => ({ color: PALETTE.glassGreen, roughness: 0.06, metalness: 0.35, envMapIntensity: 1.4 }),
    glassClear: () => ({ color: '#cfe3ea', roughness: 0.02, metalness: 0.1, transparent: true, opacity: 0.35, depthWrite: false }),
    wood: () => ({ color: PALETTE.wood, roughness: 0.8 }),
    asphalt: () => ({ color: '#ffffff', map: surfaceTexture('concrete', PALETTE.asphalt, 4, 3), roughness: 0.95 }),
    sidewalk: () => ({ color: '#ffffff', map: surfaceTexture('concrete', PALETTE.sidewalk, 1.5, 5), roughness: 0.9 }),
    paver: () => ({ color: '#ffffff', map: surfaceTexture('paver', PALETTE.paver, 2), roughness: 0.88 }),
    grass: () => ({ color: PALETTE.grass, roughness: 1 }),
    water: () => ({ color: PALETTE.water, roughness: 0.08, metalness: 0.1 }),
    cmuRed: () => ({ color: PALETTE.cmuRed, roughness: 0.6 }),
    windowLit: () => ({ color: '#222', emissive: PALETTE.windowWarm, emissiveIntensity: 0, roughness: 0.3, _night: 1.6 }),
  };

  // Named preset material (shared instance). Unknown names fall back to a plain color material.
  function get(name) {
    const key = `preset:${name}`;
    if (cache.has(key)) return cache.get(key);
    const def = PRESETS[name] ? PRESETS[name]() : { color: PALETTE[name] || name, roughness: 0.85 };
    const night = def._night; delete def._night;
    const rel = def.map && normalOf.get(def.map);
    if (rel) { def.normalMap = rel.normalMap; def.normalScale = new THREE.Vector2(rel.scale, rel.scale); }
    const m = new THREE.MeshStandardMaterial(def);
    m.name = name;
    m.userData.cmuRelief = !!rel;
    if (night) registerNightMaterial(m, night);
    cache.set(key, m);
    return m;
  }

  // Plain coloured material (cached by params)
  function color(hex, { roughness = 0.85, metalness = 0, emissive = null, side = THREE.FrontSide } = {}) {
    const key = `color:${hex}:${roughness}:${metalness}:${emissive}:${side}`;
    if (cache.has(key)) return cache.get(key);
    const m = new THREE.MeshStandardMaterial({ color: hex, roughness, metalness, side });
    if (emissive) m.emissive = new THREE.Color(emissive);
    cache.set(key, m);
    return m;
  }

  /**
   * Facade material: wall surface + window grid, tiling in metres.
   * opts: {
   *   wall: 'brick'|'stone'|'concrete'|'panel'|'plain', wallColor: '#hex',
   *   style: 'punched'|'arched'|'ribbon'|'curtain'|'none',
   *   bay: metres per window bay (default 3.6), floor: metres per storey (default 3.8),
   *   winW: window width in metres, winH: window height in metres, sill: metres from floor to sill,
   *   frame: '#hex', glass: '#hex', trim: '#hex' (stone band at each floor, optional),
   *   lit: fraction of windows lit at night (0..1), seed
   * }
   * Map one texture tile = 4 bays x 3 floors; UVs in metres (u along wall, v up from ground).
   */
  function facade(opts = {}) {
    const o = {
      wall: 'brick', wallColor: PALETTE.brickYellow, style: 'punched', bay: 3.6, floor: 3.8,
      winW: 1.6, winH: 2.1, sill: 0.9, frame: '#e8e2d4', glass: PALETTE.glass, trim: null, lit: 0.4, seed: 1,
      ...opts,
    };
    const key = `facade:${JSON.stringify(o)}`;
    if (cache.has(key)) return cache.get(key);
    const BAYS = 4, FLOORS = 3;
    const tileW = o.bay * BAYS, tileH = o.floor * FLOORS;
    const pxPerM = Math.min(40, 1024 / tileW, 1024 / tileH);
    const W = Math.round(tileW * pxPerM), H = Math.round(tileH * pxPerM);
    const r = rand(o.seed * 104729 + 17);
    const cMap = makeCanvas(W, H), gm = cMap.getContext('2d');
    // emissive + roughness masks at half resolution (same drawing code, scaled) — they are only masks
    const cEm = makeCanvas(Math.ceil(W / 2), Math.ceil(H / 2)), ge = cEm.getContext('2d');
    const cRough = makeCanvas(Math.ceil(W / 2), Math.ceil(H / 2)), gr = cRough.getContext('2d');
    ge.scale(0.5, 0.5); gr.scale(0.5, 0.5);
    ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
    gr.fillStyle = '#e6e6e6'; gr.fillRect(0, 0, W, H);
    // relief (half resolution, CPU-backed: read back once): grey level = depth in front of the glass, 255 = RELIEF m
    const RELIEF = 0.25;
    const cH = reliefOn ? makeCanvas(Math.ceil(W / 2), Math.ceil(H / 2)) : null;
    const gh = cH ? cH.getContext('2d', { willReadFrequently: true }) : null;
    const relief = (m, x, y, w, h) => {
      if (!gh) return;
      const v = Math.round((m / RELIEF) * 255);
      gh.fillStyle = `rgb(${v},${v},${v})`;
      gh.fillRect(x, y, w, h);
    };
    if (gh) {
      gh.scale(0.5, 0.5);
      relief(o.style === 'curtain' ? 0.1 : 0.2, 0, 0, W, H);
      if (o.style !== 'curtain' && o.wall === 'stone') for (let y = H; y > 0; y -= 0.6 * pxPerM) relief(0.185, 0, y - 2, W, 2);
      if (o.style !== 'curtain' && (o.wall === 'concrete' || o.wall === 'panel')) {
        const pw = (o.wall === 'panel' ? 1.5 : 3) * pxPerM;
        for (let x = 0; x < W; x += pw) relief(0.19, x, 0, 2, H);
      }
    }
    if (o.style === 'curtain') {
      // full-height glazing with mullions
      glassGradient(gm, 0, 0, W, H, o.glass, r);
      gm.fillStyle = o.frame;
      const mw = Math.max(2, 0.08 * pxPerM);
      for (let b = 0; b <= BAYS * 2; b++) { gm.fillRect((b * W) / (BAYS * 2) - mw / 2, 0, mw, H); relief(0.16, (b * W) / (BAYS * 2) - mw / 2, 0, mw, H); }
      for (let f = 0; f <= FLOORS; f++) { gm.fillRect(0, (f * H) / FLOORS - mw, W, mw * 2); relief(0.16, 0, (f * H) / FLOORS - mw, W, mw * 2); }
      gr.fillStyle = '#1a1a1a'; gr.fillRect(0, 0, W, H);
      for (let f = 0; f < FLOORS; f++) for (let b = 0; b < BAYS * 2; b++) {
        if (r() < o.lit) { ge.fillStyle = `rgba(255,${200 + (r() * 40) | 0},${130 + (r() * 60) | 0},${0.6 + r() * 0.4})`; ge.fillRect((b * W) / (BAYS * 2) + mw, (f * H) / FLOORS + mw, W / (BAYS * 2) - mw * 2, H / FLOORS - mw * 2); }
      }
    } else {
      paintWall(gm, 0, 0, W, H, o.wall, o.wallColor, pxPerM, r);
      for (let f = 0; f < FLOORS; f++) {
        const floorTop = H - (f + 1) * o.floor * pxPerM; // canvas y of this storey's top (v up = canvas up)
        if (o.trim) {
          gm.fillStyle = o.trim; gm.fillRect(0, floorTop + o.floor * pxPerM - 0.25 * pxPerM, W, 0.25 * pxPerM);
          relief(0.225, 0, floorTop + o.floor * pxPerM - 0.25 * pxPerM, W, 0.25 * pxPerM);
        }
        if (o.style === 'none') continue;
        if (o.style === 'ribbon') {
          const y = floorTop + (o.floor - o.sill - o.winH) * pxPerM;
          glassGradient(gm, 0, y, W, o.winH * pxPerM, o.glass, r);
          gm.fillStyle = o.frame;
          for (let b = 0; b <= BAYS * 3; b++) gm.fillRect((b * W) / (BAYS * 3) - 1, y, 2, o.winH * pxPerM);
          relief(0.1, 0, y, W, o.winH * pxPerM);
          for (let b = 0; b <= BAYS * 3; b++) relief(0.13, (b * W) / (BAYS * 3) - 2, y, 4, o.winH * pxPerM);
          gr.fillStyle = '#222'; gr.fillRect(0, y, W, o.winH * pxPerM);
          for (let b = 0; b < BAYS * 3; b++) if (r() < o.lit) { ge.fillStyle = `rgba(255,${205 + (r() * 40) | 0},140,${0.55 + r() * 0.45})`; ge.fillRect((b * W) / (BAYS * 3) + 2, y + 2, W / (BAYS * 3) - 4, o.winH * pxPerM - 4); }
          continue;
        }
        for (let b = 0; b < BAYS; b++) {
          const cx = (b + 0.5) * o.bay * pxPerM;
          const ww = o.winW * pxPerM, wh = o.winH * pxPerM;
          const x = cx - ww / 2;
          const y = floorTop + (o.floor - o.sill - o.winH) * pxPerM;
          const fr = Math.max(2, 0.07 * pxPerM);
          // reveal shadow
          gm.fillStyle = 'rgba(0,0,0,0.35)';
          gm.fillRect(x - fr, y - fr, ww + fr * 2, wh + fr * 2);
          gm.save();
          if (o.style === 'arched') {
            gm.beginPath();
            gm.moveTo(x, y + wh); gm.lineTo(x, y + ww / 2);
            gm.arc(cx, y + ww / 2, ww / 2, Math.PI, 0);
            gm.lineTo(x + ww, y + wh); gm.closePath();
            gm.clip();
          }
          gm.fillStyle = o.frame; gm.fillRect(x, y, ww, wh);
          glassGradient(gm, x + fr, y + fr, ww - fr * 2, wh - fr * 2, o.glass, r);
          // mullions: vertical + transom
          gm.fillStyle = o.frame;
          gm.fillRect(cx - fr / 2, y, fr, wh);
          gm.fillRect(x, y + wh * 0.3, ww, fr);
          gm.restore();
          if (gh) {
            // the opening is recessed: frame 6 cm, glass 4 cm in front of the back plane (wall face at 20 cm)
            gh.save();
            if (o.style === 'arched') {
              gh.beginPath();
              gh.moveTo(x, y + wh); gh.lineTo(x, y + ww / 2);
              gh.arc(cx, y + ww / 2, ww / 2, Math.PI, 0);
              gh.lineTo(x + ww, y + wh); gh.closePath();
              gh.clip();
            }
            relief(0.06, x, y, ww, wh);
            relief(0.04, x + fr, y + fr, ww - fr * 2, wh - fr * 2);
            relief(0.07, cx - fr / 2, y, fr, wh);
            relief(0.07, x, y + wh * 0.3, ww, fr);
            gh.restore();
          }
          // sill
          gm.fillStyle = shade(o.wallColor, 1.15); gm.fillRect(x - fr * 1.5, y + wh, ww + fr * 3, Math.max(2, 0.08 * pxPerM));
          relief(0.235, x - fr * 1.5, y + wh, ww + fr * 3, Math.max(2, 0.08 * pxPerM));
          gr.fillStyle = '#262626'; gr.fillRect(x, y, ww, wh);
          if (r() < o.lit) {
            const warm = 180 + ((r() * 60) | 0);
            ge.fillStyle = `rgba(255,${warm + 20},${warm - 40},${0.55 + r() * 0.45})`;
            ge.fillRect(x + fr, y + fr, ww - fr * 2, wh - fr * 2);
          }
        }
      }
    }
    const map = tex(cMap, { repeatW: tileW, repeatH: tileH, release: true });
    const emissiveMap = tex(cEm, { repeatW: tileW, repeatH: tileH, release: true });
    const roughnessMap = tex(cRough, { repeatW: tileW, repeatH: tileH, color: false, release: true });
    const m = new THREE.MeshStandardMaterial({
      map, emissiveMap, roughnessMap, roughness: 1, metalness: o.style === 'curtain' ? 0.3 : 0.05,
      emissive: new THREE.Color(PALETTE.windowWarm), emissiveIntensity: 0,
    });
    if (gh) {
      const hw = cH.width, hh = cH.height, px = gh.getImageData(0, 0, hw, hh).data, Hm = new Float32Array(hw * hh);
      for (let i = 0; i < Hm.length; i++) Hm[i] = (px[i * 4] / 255) * RELIEF;
      cH.width = cH.height = 1;
      m.normalMap = tex(sobelNormals(Hm, hw, hh, pxPerM / 2), { repeatW: tileW, repeatH: tileH, color: false, release: true });
      normalOf.set(map, { normalMap: m.normalMap, scale: 1 });
    }
    m.userData.cmuRelief = !!gh;
    m.name = `facade-${o.style}-${o.wall}`;
    m.userData.facade = o;
    registerNightMaterial(m, 1.4);
    cache.set(key, m);
    return m;
  }

  // Night lighting driver: env module updates ctx.env.state.nightFactor (0 = day, 1 = full night)
  let lastNight = -1;
  ctx.onUpdate?.(() => {
    const nf = ctx.env?.state?.nightFactor ?? 0;
    if (Math.abs(nf - lastNight) < 0.002) return;
    lastNight = nf;
    for (const m of nightMaterials) m.emissiveIntensity = nf * (m.userData.nightIntensity ?? 1);
  }, 50);

  return {
    palette: PALETTE,
    get,
    color,
    facade,
    surfaceTexture,
    enhance,
    registerNightMaterial,
    applyWorldUV,
    shade,
    makeCanvas,
    canvasTexture: tex,
    rand,
  };
}
