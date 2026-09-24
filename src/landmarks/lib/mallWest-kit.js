// Hornbostel kit — shared geometry + material toolkit for the Beaux-Arts buildings on the west half of the Mall
// (Hamerschlag, Porter, Baker, Doherty). Owner: lm-mall-west.
//
// Everything is modelled in a LOCAL campus-grid frame: the original Palmer & Hornbostel campus is laid out on a
// grid rotated ~15.5° from true east. Local axes: u (= three local x) runs along the Mall towards CFA (ESE),
// v (= three local z) points across the Mall towards Frew Street (SSW), y is up (same as world y).
// A group with rotation.y = -GRID_ANGLE placed at FRAME_ORIGIN maps local → world.
//
// Geometry is accumulated per material in "Meshers" (Float32Array position/normal/uv chunks). At low quality
// (Kit.low) the helpers build a lighter variant: half the arc / cylinder segments and no eave brackets, keystones,
// dentils or carved inscriptions (≈ 65k instead of ≈ 115k triangles for the group). Kit.commit() hands a landmark's
// meshers to a shared batch that builds ONE mesh per material for all four Mall West buildings together (they share
// the same ~20 materials), with a pick resolver that maps a hit triangle back to its building.
// UVs are in metres (box projection in the local frame) unless stated otherwise.
import * as THREE from 'three';

export const GRID_ANGLE = (15.5 * Math.PI) / 180;
export const FRAME_ORIGIN = [-285.5, 78.2]; // centre of Hamerschlag Hall's Mall front

// ------------------------------------------------------------------------------------------------ frame
export function createFrame(ctx, origin = FRAME_ORIGIN, angle = GRID_ANGLE) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const toWorld = (u, v) => [origin[0] + u * c - v * s, origin[1] + u * s + v * c];
  const toLocal = (x, z) => {
    const dx = x - origin[0], dz = z - origin[1];
    return [dx * c + dz * s, -dx * s + dz * c];
  };
  return {
    angle, origin, toWorld, toLocal,
    ground: (u, v) => ctx.heightAt(...toWorld(u, v)),
    ringToWorld: (ring) => ring.map(([u, v]) => toWorld(u, v)),
    group(name) {
      const g = new THREE.Group();
      g.name = name;
      g.rotation.y = -angle;
      g.position.set(origin[0], 0, origin[1]);
      g.updateMatrixWorld(true);
      return g;
    },
  };
}

// Min / max terrain height sampled along a local segment (optionally pushed `out` metres along a normal)
export function groundAlong(frame, a, b, n = null, out = 0, step = 2) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const k = Math.max(1, Math.ceil(L / step));
  let min = Infinity, max = -Infinity;
  for (let i = 0; i <= k; i++) {
    const t = i / k;
    const u = a[0] + (b[0] - a[0]) * t + (n ? n[0] * out : 0);
    const v = a[1] + (b[1] - a[1]) * t + (n ? n[1] * out : 0);
    const h = frame.ground(u, v);
    if (h < min) min = h;
    if (h > max) max = h;
  }
  return { min, max };
}

// ------------------------------------------------------------------------------------------------ materials
const MAT_CACHE = new WeakMap();

// Multi-pane "copper-framed" industrial sash. Atlas of V variants side by side; each window maps its own
// 0..1 UV rectangle into one variant cell, so lit/unlit rooms vary window by window at night.
export const WINDOW_VARIANTS = 8;
function windowTextures(ctx) {
  const V = WINDOW_VARIANTS, CW = 64, CH = 256, W = V * CW, H = CH;
  const M = ctx.materials;
  const cm = M.makeCanvas(W, H), gm = cm.getContext('2d');
  const ce = M.makeCanvas(W, H), ge = ce.getContext('2d');
  const cr = M.makeCanvas(W, H), gr = cr.getContext('2d');
  const r = M.rand(9127);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  const frame = '#3b3329', frameHi = '#5a4d3c';
  for (let k = 0; k < V; k++) {
    const x0 = k * CW;
    const lit = k >= V - 3;
    // glass with a sky-reflection gradient
    const grd = gm.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#c6d3db'); grd.addColorStop(0.3, '#8fa3b0'); grd.addColorStop(0.75, '#5a6c79'); grd.addColorStop(1, '#43505a');
    gm.fillStyle = grd; gm.fillRect(x0, 0, CW, H);
    // interior hints: blinds / curtains / ceiling lights
    const blind = r();
    const bh = H * (0.12 + 0.55 * r());
    if (blind > 0.3) { gm.fillStyle = `rgba(222,214,192,${0.28 + 0.3 * r()})`; gm.fillRect(x0, 0, CW, bh); }
    if (r() > 0.6) { gm.fillStyle = 'rgba(20,24,28,0.35)'; gm.fillRect(x0, H * 0.55, CW, H * 0.45); }
    gr.fillStyle = '#1d1d1d'; gr.fillRect(x0, 0, CW, H);
    if (lit) {
      const eg = ge.createLinearGradient(0, 0, 0, H);
      const warm = r() > 0.3;
      eg.addColorStop(0, warm ? '#fff3d8' : '#e8f0ff'); eg.addColorStop(1, warm ? '#f7b86a' : '#b9c8e0');
      ge.fillStyle = eg; ge.fillRect(x0, 0, CW, H);
      if (blind > 0.3) { ge.fillStyle = 'rgba(0,0,0,0.45)'; ge.fillRect(x0, 0, CW, bh); }
    }
    // frame + muntins (3 x 6 panes, heavier transom at 30%)
    const drawBars = (g, col) => {
      g.fillStyle = col;
      g.fillRect(x0, 0, 5, H); g.fillRect(x0 + CW - 5, 0, 5, H);
      g.fillRect(x0, 0, CW, 5); g.fillRect(x0, H - 6, CW, 6);
      for (let i = 1; i < 3; i++) g.fillRect(x0 + (i * CW) / 3 - 1.5, 0, 3, H);
      for (let j = 1; j < 7; j++) g.fillRect(x0, (j * H) / 7 - 1, CW, 2.5);
      g.fillRect(x0, H * 0.3 - 3, CW, 6);
    };
    drawBars(gm, frame);
    gm.fillStyle = frameHi; gm.fillRect(x0 + 1, 1, 1, H - 2);
    drawBars(ge, '#000');
    drawBars(gr, '#b4b4b4');
  }
  const map = M.canvasTexture(cm, { repeatW: 1, repeatH: 1 });
  const emissiveMap = M.canvasTexture(ce, { repeatW: 1, repeatH: 1 });
  const roughnessMap = M.canvasTexture(cr, { repeatW: 1, repeatH: 1, color: false });
  for (const t of [map, emissiveMap, roughnessMap]) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true; }
  return { map, emissiveMap, roughnessMap };
}

// Guastavino tile vaulting: thin terracotta tiles in a basket-weave, 1.6 m tile (warm orange-red, as in the
// Hamerschlag entrance arch)
function guastavinoTexture(ctx) {
  const M = ctx.materials;
  const px = 256, tile = 1.6, s = px / 8;
  const c = M.makeCanvas(px, px), g = c.getContext('2d'), r = M.rand(311);
  g.fillStyle = '#a8765a'; g.fillRect(0, 0, px, px);
  const tileCol = () => M.shade('#c98a62', 0.88 + r() * 0.24);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    const x = i * 2 * s, y = j * 2 * s;
    if ((i + j) % 2 === 0) {
      for (let k = 0; k < 2; k++) { g.fillStyle = tileCol(); g.fillRect(x + 1, y + k * s + 1, 2 * s - 2, s - 2); }
    } else {
      for (let k = 0; k < 2; k++) { g.fillStyle = tileCol(); g.fillRect(x + k * s + 1, y + 1, s - 2, 2 * s - 2); }
    }
  }
  return M.canvasTexture(c, { repeatW: tile, repeatH: tile });
}

// Carved name bands (one atlas row per building): incised Roman capitals on cream cast stone
export const INSCRIPTIONS = ['HAMERSCHLAG HALL', 'BAKER HALL', 'PORTER HALL', 'DOHERTY HALL'];
function inscriptionTexture(ctx) {
  const M = ctx.materials;
  const W = 1024, RH = 128, c = M.makeCanvas(W, RH * INSCRIPTIONS.length), g = c.getContext('2d');
  const r = M.rand(77);
  g.fillStyle = '#d9ccad'; g.fillRect(0, 0, W, c.height);
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(${r() > 0.5 ? '255,255,255' : '90,80,60'},${0.05 * r()})`; g.fillRect(r() * W, r() * c.height, 2, 2); }
  INSCRIPTIONS.forEach((txt, row) => {
    const y = row * RH + RH * 0.5;
    g.fillStyle = '#c9bb99'; g.fillRect(8, row * RH + 8, W - 16, 3); g.fillRect(8, row * RH + RH - 11, W - 16, 3);
    g.font = `600 ${Math.round(RH * 0.56)}px "Times New Roman", Georgia, serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const spaced = txt.split('').join(String.fromCharCode(8202)); // hair spaces for Roman letter-spacing
    g.fillStyle = 'rgba(255,250,235,0.9)'; g.fillText(spaced, W / 2 + 2, y + 3); // lit lower lip of the cut
    g.fillStyle = '#6f6149'; g.fillText(spaced, W / 2, y);                      // shadowed cut
  });
  const t = M.canvasTexture(c, { repeatW: 1, repeatH: 1 });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
// Flat carved name band on a wall: [s0,s1] x [y0,y1] at depth d, atlas row `row`
export function inscription(K, W, s0, s1, y0, y1, d, row) {
  if (K.low) return; // the plain stone name panel stays (saves a draw call and the 1024x512 lettering texture)
  const n = INSCRIPTIONS.length, v0 = 1 - (row + 1) / n, v1 = 1 - row / n;
  // (+s runs to the viewer's left when facing the wall from outside, so u is flipped)
  K.m('inscription').quadN(W.P(s0, y0, d), W.P(s1, y0, d), W.P(s1, y1, d), W.P(s0, y1, d), W.n, [1, v0], [0, v0], [0, v1], [1, v1]);
}

export function hornbostelMaterials(ctx) {
  const M = ctx.materials;
  if (MAT_CACHE.has(M)) return MAT_CACHE.get(M);
  const std = (o, name) => { const m = new THREE.MeshStandardMaterial(o); m.name = name; return m; };
  const win = windowTextures(ctx);
  const glass = std({ ...win, roughness: 1, metalness: 0.25, emissive: new THREE.Color('#ffd49a'), emissiveIntensity: 0, envMapIntensity: 1.3 }, 'hb-window');
  M.registerNightMaterial(glass, 1.5);
  const brickMap = M.surfaceTexture('brick', M.palette.brickYellow, 2);
  // brick that glows warm at night (inside of Hamerschlag's crown, floodlit)
  const glow = std({ map: brickMap, roughness: 0.9, emissive: new THREE.Color('#ffc983'), emissiveMap: brickMap, emissiveIntensity: 0 }, 'hb-glowBrick');
  M.registerNightMaterial(glow, 0.9);
  const lamp = std({ color: '#2a2622', emissive: new THREE.Color('#ffe2a8'), emissiveIntensity: 0, roughness: 0.4 }, 'hb-lamp');
  M.registerNightMaterial(lamp, 3);
  // floodlit cast stone (crown columns): same look by day, warm wash at night
  const stoneMap = M.surfaceTexture('stone', '#d8cbab', 4, 17);
  const glowStone = std({ map: stoneMap, roughness: 0.85, emissive: new THREE.Color('#ffd8a0'), emissiveMap: stoneMap, emissiveIntensity: 0 }, 'hb-glowStone');
  M.registerNightMaterial(glowStone, 0.55);
  // facade floodlighting (Hamerschlag's cast-stone Mall pavilion): a gentle warm wash at night only
  const floodStone = std({ map: stoneMap, roughness: 0.85, emissive: new THREE.Color('#ffd8a8'), emissiveMap: stoneMap, emissiveIntensity: 0 }, 'hb-floodStone');
  M.registerNightMaterial(floodStone, 0.34);
  const mats = {
    brick: M.get('brickYellow'),
    brickDark: std({ map: M.surfaceTexture('brick', '#b3956a', 2, 3), roughness: 0.92 }, 'hb-brickDark'),
    trim: std({ map: M.surfaceTexture('plain', '#e3d6b8', 3, 13), roughness: 0.8 }, 'hb-terracotta'),
    stone: std({ map: stoneMap, roughness: 0.85 }, 'hb-caststone'),
    glowStone,
    floodStone,
    granite: M.get('granite'),
    glass,
    glow,
    lamp,
    // Hornbostel roofs as they are today: pale grey-green standing-seam metal with green-copper eaves, hips and
    // ridges. Same hex/texture as lm-mall-east (CFA / MMCH), so the whole Mall reads as one family.
    roofTile: std({ map: M.surfaceTexture('seam', '#9aa89e', 2, 31), roughness: 0.6, metalness: 0.2, envMapIntensity: 0.9 }, 'hb-roof'),
    verdigris: std({ map: M.surfaceTexture('copper', '#5f8a76', 2, 32), roughness: 0.5, metalness: 0.35 }, 'hb-verdigris'),
    roofFlat: M.get('flatRoof'),
    metal: M.get('darkMetal'),
    lead: std({ color: '#7d8185', roughness: 0.55, metalness: 0.5 }, 'hb-lead'),
    door: std({ color: '#3d2b1f', roughness: 0.55, metalness: 0.1 }, 'hb-door'),
    paver: M.get('paver'),
    step: std({ map: M.surfaceTexture('stone', '#bab3a3', 2, 23), roughness: 0.9 }, 'hb-steps'),
    guastavino: std({ map: guastavinoTexture(ctx), roughness: 0.7 }, 'hb-guastavino'),
  };
  // lettering texture only painted when a name band is actually built (never at low quality); non-enumerable so
  // iterating the material set doesn't paint it either
  let inscriptionMat = null;
  Object.defineProperty(mats, 'inscription', {
    get:() => inscriptionMat || (inscriptionMat = std({ map: inscriptionTexture(ctx), roughness: 0.85 }, 'hb-inscription')),
  });
  MAT_CACHE.set(M, mats);
  return mats;
}

// ------------------------------------------------------------------------------------------------ mesher
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m3 = new THREE.Matrix3();

// Box-projected metre UV of point p on a face with unit normal (nx, ny, nz), written to T[o], T[o+1]
function boxUV(T, o, nx, ny, nz, x, y, z) {
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  if (ay >= ax && ay >= az) { T[o] = x; T[o + 1] = z; }
  else if (ax >= az) { T[o] = nx > 0 ? -z : z; T[o + 1] = y; }
  else { T[o] = nz > 0 ? x : -x; T[o + 1] = y; }
}

// Segment count for curved work: `n` at medium/high quality, about half (never below `min`) at low quality
export function segs(m, n, min = 4) { return m.low ? Math.max(min, Math.ceil(n / 2)) : n; }

// Raw triangle soup for one material, written straight into Float32Array chunks (no per-vertex allocation and no
// regrowth copies: a full chunk is kept and a bigger one started). Points are [x, y, z] arrays in the local frame.
// `low`: build the reduced-detail variant (ctx.quality.level 'low').
const CHUNK_MAX = 16384; // triangles
export class Mesher {
  constructor(low = false) {
    this.low = low;
    this.n = 0;          // triangles written (all chunks)
    this.chunks = [];    // finished chunks { pos, nor, uv, n }
    this.pos = this.nor = this.uv = null;
    this.k = 0;          // triangles in the current chunk
    this.cap = 0;        // capacity of the current chunk
    this.bounds = null;  // set by Kit.commit()
  }
  get triangles() { return this.n; }
  _chunk(size) {
    if (this.k) this.chunks.push({ pos: this.pos, nor: this.nor, uv: this.uv, n: this.k });
    this.pos = new Float32Array(size * 9); this.nor = new Float32Array(size * 9); this.uv = new Float32Array(size * 6);
    this.k = 0; this.cap = size;
  }
  _reserve(k) { if (this.k + k > this.cap) this._chunk(Math.max(k, Math.min(CHUNK_MAX, Math.max(64, this.cap * 2)))); }
  // Every block of written triangles, in order: fn(pos, nor, uv, count)
  each(fn) {
    for (const c of this.chunks) fn(c.pos, c.nor, c.uv, c.n);
    if (this.k) fn(this.pos, this.nor, this.uv, this.k);
  }
  // Write one flat triangle with unit normal (nx, ny, nz); uvs optional per vertex (box-projected metres if omitted)
  _put(a, b, c, nx, ny, nz, ta, tb, tc) {
    if (this.k === this.cap) this._reserve(1);
    const i = this.k++;
    this.n++;
    const P = this.pos, N = this.nor, T = this.uv;
    const o = i * 9;
    P[o] = a[0]; P[o + 1] = a[1]; P[o + 2] = a[2];
    P[o + 3] = b[0]; P[o + 4] = b[1]; P[o + 5] = b[2];
    P[o + 6] = c[0]; P[o + 7] = c[1]; P[o + 8] = c[2];
    N[o] = N[o + 3] = N[o + 6] = nx;
    N[o + 1] = N[o + 4] = N[o + 7] = ny;
    N[o + 2] = N[o + 5] = N[o + 8] = nz;
    const u = i * 6;
    if (ta) { T[u] = ta[0]; T[u + 1] = ta[1]; } else boxUV(T, u, nx, ny, nz, a[0], a[1], a[2]);
    if (tb) { T[u + 2] = tb[0]; T[u + 3] = tb[1]; } else boxUV(T, u + 2, nx, ny, nz, b[0], b[1], b[2]);
    if (tc) { T[u + 4] = tc[0]; T[u + 5] = tc[1]; } else boxUV(T, u + 4, nx, ny, nz, c[0], c[1], c[2]);
  }

  // Flat-shaded triangle; uvs optional (box-projected metres if omitted)
  tri(a, b, c, ta, tb, tc) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l < 1e-10) return;
    this._put(a, b, c, nx / l, ny / l, nz / l, ta, tb, tc);
  }
  // Triangle whose winding is fixed so its normal faces `n`
  triN(a, b, c, n, ta, tb, tc) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l < 1e-10) return;
    if (nx * n[0] + ny * n[1] + nz * n[2] < 0) this._put(a, c, b, -nx / l, -ny / l, -nz / l, ta, tc, tb);
    else this._put(a, b, c, nx / l, ny / l, nz / l, ta, tb, tc);
  }
  quad(a, b, c, d, ta, tb, tc, td) { this.tri(a, b, c, ta, tb, tc); this.tri(a, c, d, ta, tc, td); }
  quadN(a, b, c, d, n, ta, tb, tc, td) { this.triN(a, b, c, n, ta, tb, tc); this.triN(a, c, d, n, ta, tc, td); }

  // Planar polygon (any simple polygon) given as 3D points; faces normal n. uvFn(p) optional.
  poly(pts, n, uvFn = null) {
    if (pts.length < 3) return;
    // 2D basis in the plane
    const N = new THREE.Vector3(...n).normalize();
    const ref = Math.abs(N.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const e1 = new THREE.Vector3().crossVectors(ref, N).normalize();
    const e2 = new THREE.Vector3().crossVectors(N, e1);
    const c2 = pts.map((p) => new THREE.Vector2(p[0] * e1.x + p[1] * e1.y + p[2] * e1.z, p[0] * e2.x + p[1] * e2.y + p[2] * e2.z));
    const tris = THREE.ShapeUtils.triangulateShape(c2, []);
    for (const [i, j, k] of tris) {
      const a = pts[i], b = pts[j], c = pts[k];
      this.triN(a, b, c, n, uvFn && uvFn(a), uvFn && uvFn(b), uvFn && uvFn(c));
    }
  }

  // Parallelepiped: corner o, edge vectors ex, ey, ez. skip: set of face names to omit
  // ('-x','+x','-y','+y','-z','+z' relative to ex/ey/ez).
  para(o, ex, ey, ez, skip = null) {
    const P = (a, b, c) => [o[0] + ex[0] * a + ey[0] * b + ez[0] * c, o[1] + ex[1] * a + ey[1] * b + ez[1] * c, o[2] + ex[2] * a + ey[2] * b + ez[2] * c];
    const c000 = P(0, 0, 0), c100 = P(1, 0, 0), c010 = P(0, 1, 0), c001 = P(0, 0, 1);
    const c110 = P(1, 1, 0), c101 = P(1, 0, 1), c011 = P(0, 1, 1), c111 = P(1, 1, 1);
    const has = (name) => !(skip && skip.includes(name));
    // each face's outward hint is its edge vector (± relative to the box centre)
    if (has('-x')) this.quadN(c000, c010, c011, c001, [-ex[0], -ex[1], -ex[2]]);
    if (has('+x')) this.quadN(c100, c101, c111, c110, ex);
    if (has('-y')) this.quadN(c000, c001, c101, c100, [-ey[0], -ey[1], -ey[2]]);
    if (has('+y')) this.quadN(c010, c110, c111, c011, ey);
    if (has('-z')) this.quadN(c000, c100, c110, c010, [-ez[0], -ez[1], -ez[2]]);
    if (has('+z')) this.quadN(c001, c011, c111, c101, ez);
  }
  box(x0, y0, z0, x1, y1, z1, skip = null) {
    this.para([x0, y0, z0], [x1 - x0, 0, 0], [0, y1 - y0, 0], [0, 0, z1 - z0], skip);
  }

  // Append a THREE geometry transformed by `matrix`. opts.uv: 'box' (metres, default) | 'keep' (scaled by uvScale)
  geometry(geom, matrix, opts = {}) {
    const g = geom.index ? geom.toNonIndexed() : geom;
    const p = g.attributes.position, nrm = g.attributes.normal, t = g.attributes.uv;
    const flat = opts.flat === true || !nrm;
    _m3.getNormalMatrix(matrix);
    const su = opts.uvScale ? opts.uvScale[0] : 1, sv = opts.uvScale ? opts.uvScale[1] : 1;
    const keepUV = opts.uv === 'keep' && t;
    this._reserve(p.count / 3);
    const P = this.pos, N = this.nor, T = this.uv;
    const tp = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < p.count; i += 3) {
      for (let k = 0; k < 3; k++) {
        _v.fromBufferAttribute(p, i + k).applyMatrix4(matrix);
        tp[3 * k] = _v.x; tp[3 * k + 1] = _v.y; tp[3 * k + 2] = _v.z;
      }
      // face normal (for box UVs / flat shading)
      const ux = tp[3] - tp[0], uy = tp[4] - tp[1], uz = tp[5] - tp[2];
      const vx = tp[6] - tp[0], vy = tp[7] - tp[1], vz = tp[8] - tp[2];
      let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      const fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
      if (fl < 1e-12) continue;
      fx /= fl; fy /= fl; fz /= fl;
      const tri = this.k++, o = tri * 9, u = tri * 6;
      this.n++;
      for (let k = 0; k < 3; k++) {
        const q = o + 3 * k;
        P[q] = tp[3 * k]; P[q + 1] = tp[3 * k + 1]; P[q + 2] = tp[3 * k + 2];
        if (flat) { N[q] = fx; N[q + 1] = fy; N[q + 2] = fz; }
        else { _n.fromBufferAttribute(nrm, i + k).applyMatrix3(_m3).normalize(); N[q] = _n.x; N[q + 1] = _n.y; N[q + 2] = _n.z; }
        if (keepUV) { T[u + 2 * k] = t.getX(i + k) * su; T[u + 2 * k + 1] = t.getY(i + k) * sv; }
        else boxUV(T, u + 2 * k, fx, fy, fz, tp[3 * k], tp[3 * k + 1], tp[3 * k + 2]);
      }
    }
    if (g !== geom) g.dispose();
  }

  toGeometry() { return mergedGeometry([this]); }
}

// Axis-aligned bounds [minX, minY, minZ, maxX, maxY, maxZ] of a mesher's vertices (tight scalar loop)
function mesherBounds(m) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  m.each((P, N, T, count) => {
    for (let i = 0, e = count * 9; i < e; i += 3) {
      const x = P[i], y = P[i + 1], z = P[i + 2];
      if (x < b[0]) b[0] = x; if (x > b[3]) b[3] = x;
      if (y < b[1]) b[1] = y; if (y > b[4]) b[4] = y;
      if (z < b[2]) b[2] = z; if (z > b[5]) b[5] = z;
    }
  });
  return b;
}

// One non-indexed BufferGeometry from several meshers (in order). Bounding box / sphere are computed here with
// plain loops (same result as three's computeBoundingBox/Sphere: sphere centred on the box centre).
function mergedGeometry(list) {
  let nTri = 0;
  for (const m of list) nTri += m.n;
  const pos = new Float32Array(nTri * 9), nor = new Float32Array(nTri * 9), uv = new Float32Array(nTri * 6);
  const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  let t = 0;
  for (const m of list) {
    m.each((P, N, T, count) => {
      pos.set(P.subarray(0, count * 9), t * 9);
      nor.set(N.subarray(0, count * 9), t * 9);
      uv.set(T.subarray(0, count * 6), t * 6);
      t += count;
    });
    const b = m.bounds || mesherBounds(m);
    for (let k = 0; k < 3; k++) { bb[k] = Math.min(bb[k], b[k]); bb[k + 3] = Math.max(bb[k + 3], b[k + 3]); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (nTri) {
    g.boundingBox = new THREE.Box3(new THREE.Vector3(bb[0], bb[1], bb[2]), new THREE.Vector3(bb[3], bb[4], bb[5]));
    const cx = (bb[0] + bb[3]) / 2, cy = (bb[1] + bb[4]) / 2, cz = (bb[2] + bb[5]) / 2;
    let r2 = 0;
    for (let i = 0, e = nTri * 9; i < e; i += 3) {
      const dx = pos[i] - cx, dy = pos[i + 1] - cy, dz = pos[i + 2] - cz, d = dx * dx + dy * dy + dz * dz;
      if (d > r2) r2 = d;
    }
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), Math.sqrt(r2));
  } else {
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
  return g;
}

// A set of meshers keyed by material name
export class Kit {
  constructor(ctx, frame) {
    this.ctx = ctx;
    this.frame = frame;
    this.mats = hornbostelMaterials(ctx);
    this.meshers = new Map();
    // Reduced-detail build at low quality: half the arc segments, no eave brackets / keystones / carved
    // inscriptions / small crown ornament (see segs() and the `low` checks in the builders)
    this.low = ctx.quality?.level === 'low';
  }
  m(key) {
    let m = this.meshers.get(key);
    if (!m) { m = new Mesher(this.low); this.meshers.set(key, m); }
    return m;
  }
  get triangles() { let n = 0; for (const m of this.meshers.values()) n += m.triangles; return n; }
  material(key) { return this.mats[key] || this.ctx.materials.get(key); }
  // Build one mesh per material into `group` (stand-alone use; the Mall West landmarks use commit() instead).
  // Window glass DOES cast shadows: the openings are real holes in the wall shell, so non-casting glass lets the
  // sun shine straight through the building onto the lawn behind it.
  finish(group, { noCast = NO_CAST, walkKeys = [] } = {}) {
    const byKey = {};
    for (const [key, m] of this.meshers) {
      if (!m.triangles) continue;
      const mesh = new THREE.Mesh(m.toGeometry(), this.material(key));
      mesh.name = `${group.name}:${key}`;
      mesh.castShadow = !noCast.includes(key);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      byKey[key] = mesh;
      if (walkKeys.includes(key)) this.ctx.walkables?.add(mesh);
    }
    group.updateMatrixWorld(true);
    return byKey;
  }

  // Hand this landmark's geometry to the shared Mall West batch: Hamerschlag, Baker, Porter and Doherty use the
  // same ~20 materials, so their geometry is merged into ONE mesh per material across all four buildings
  // (≈ 20 draw calls instead of ≈ 60). `group` stays the landmark's own object (pick entry, UI bounds proxy);
  // the merged meshes live in a shared 'landmarks:mallWest' group whose pick resolver maps a hit triangle back
  // to the building it came from.
  commit(group, entry, { walkKeys = [] } = {}) {
    const b = batchFor(this.ctx);
    const box = new THREE.Box3();
    for (const m of this.meshers.values()) {
      if (!m.triangles) continue;
      m.bounds = mesherBounds(m);
      box.expandByPoint(new THREE.Vector3(m.bounds[0], m.bounds[1], m.bounds[2]));
      box.expandByPoint(new THREE.Vector3(m.bounds[3], m.bounds[4], m.bounds[5]));
    }
    b.parts.push({ kit: this, entry, walkKeys });
    // Invisible bounds proxy so code that measures `landmark.object` (Box3.setFromObject) still gets the building's
    // extent. Layer 31 keeps it out of raycasts; invisible objects are never drawn.
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(Math.max(size.x, 0.1), Math.max(size.y, 0.1), Math.max(size.z, 0.1)), proxyMaterial());
      proxy.position.copy(c);
      proxy.visible = false;
      proxy.layers.set(31);
      proxy.name = `${group.name}:bounds`;
      group.add(proxy);
    }
    group.userData.stats = { triangles: this.triangles };
    group.updateMatrixWorld(true);
  }
}

// Keys that never cast shadows (flat on a wall, recessed in an opening, emissive, enclosed, or walked on)
const NO_CAST = ['lamp', 'inscription', 'door', 'step', 'paver', 'glow'];
let PROXY_MAT = null;
function proxyMaterial() {
  if (!PROXY_MAT) { PROXY_MAT = new THREE.MeshBasicMaterial({ visible: false }); PROXY_MAT.name = 'hb-boundsProxy'; }
  return PROXY_MAT;
}

// ------------------------------------------------------------------------------------------------ Mall West batch
export const MALL_WEST_KEYS = ['hamerschlag', 'baker', 'porter', 'doherty'];
const BATCHES = new WeakMap();
function batchFor(ctx) {
  let b = BATCHES.get(ctx);
  if (!b) {
    b = { parts: [], settled: new Set(), flushed: false, group: null };
    BATCHES.set(ctx, b);
    // Safety net: if a Mall West landmark is missing from the registry, flush on the first frame instead.
    if (ctx.onUpdate) {
      const off = ctx.onUpdate(() => { off(); if (!b.flushed) flushBatch(ctx, b); }, -100);
    }
  }
  return b;
}

// Call in a `finally` at the end of every Mall West build (also when it threw): once all four have reported,
// the merged meshes are built.
export function settleMallWest(ctx, key) {
  const b = batchFor(ctx);
  b.settled.add(key);
  if (!b.flushed && MALL_WEST_KEYS.every((k) => b.settled.has(k))) flushBatch(ctx, b);
}

function flushBatch(ctx, b) {
  b.flushed = true;
  if (!b.parts.length) return;
  const F = b.parts[0].kit.frame;
  const group = F.group('landmarks:mallWest');
  // gather meshers per material key, in building order
  const byKey = new Map();
  for (const part of b.parts) {
    for (const [key, m] of part.kit.meshers) {
      if (!m.triangles) continue;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push({ m, part });
    }
  }
  const walk = new Set(b.parts.flatMap((p) => p.walkKeys));
  for (const [key, list] of byKey) {
    const ranges = [];
    let t = 0;
    for (const { m, part } of list) {
      ranges.push({ start: t, end: t + m.triangles, entry: part.entry });
      t += m.triangles;
    }
    const g = mergedGeometry(list.map((it) => it.m));
    const mesh = new THREE.Mesh(g, list[0].part.kit.material(key));
    mesh.name = `mallWest:${key}`;
    mesh.castShadow = !NO_CAST.includes(key);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.userData.ranges = ranges;
    group.add(mesh);
    if (walk.has(key)) ctx.walkables?.add(mesh);
  }
  for (const part of b.parts) part.kit.meshers = new Map(); // free the raw arrays
  group.updateMatrixWorld(true);
  ctx.scene?.add(group);
  // hit triangle → the building it belongs to
  ctx.pick?.add(group, (hit) => {
    const r = hit.object?.userData?.ranges, f = hit.faceIndex;
    if (!r || f === undefined || f === null) return null;
    let lo = 0, hi = r.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (f < r[mid].start) hi = mid - 1; else if (f >= r[mid].end) lo = mid + 1; else return r[mid].entry;
    }
    return null;
  });
  b.group = group;
}

// ------------------------------------------------------------------------------------------------ walls
// A straight wall between plan points a → b (local u,v). For a CCW ring the outward normal is on the right.
// P(s, y, d): s along the wall from a, y up, d outward from the wall face (negative = into the building).
export function wallFrame(a, b, flip = false) {
  const du = b[0] - a[0], dv = b[1] - a[1], L = Math.hypot(du, dv);
  const tu = du / L, tv = dv / L;
  let nu = tv, nv = -tu;
  if (flip) { nu = -nu; nv = -nv; }
  return {
    a, b, L, t: [tu, 0, tv], n: [nu, 0, nv],
    P: (s, y, d) => [a[0] + tu * s + nu * d, y, a[1] + tv * s + nv * d],
    plan: (s, d = 0) => [a[0] + tu * s + nu * d, a[1] + tv * s + nv * d],
  };
}

// Axis-aligned (in wall space) box: s0..s1, y0..y1, d0..d1. skip: faces to omit, '-z' = the face at d0 (for a
// box set into the wall, d0 <= 0, that face points into the building and can never be seen: pass BACK).
export const BACK = ['-z'], BACK_BOTTOM = ['-z', '-y'];
export function wbox(m, W, s0, s1, y0, y1, d0, d1, skip = null) {
  const o = W.P(s0, y0, d0);
  const ex = [W.t[0] * (s1 - s0), 0, W.t[2] * (s1 - s0)];
  const ez = [W.n[0] * (d1 - d0), 0, W.n[2] * (d1 - d0)];
  m.para(o, ex, [0, y1 - y0, 0], ez, skip);
}

// Flat rectangle in the wall plane (facing outward) at depth d
export function wrect(m, W, s0, s1, y0, y1, d = 0) {
  if (s1 - s0 < 1e-3 || y1 - y0 < 1e-3) return;
  m.quadN(W.P(s0, y0, d), W.P(s1, y0, d), W.P(s1, y1, d), W.P(s0, y1, d), W.n);
}

// Arc segment counts (seg arguments below) are halved at low quality by segs(); panel, reveal and glass of one
// opening are always given the same count, so they still meet exactly.

// Wall panel above a semicircular arch: region [sL,sR] x [spring, top] minus the half disc of radius (sR-sL)/2
export function warchPanel(m, W, sL, sR, spring, top, d = 0, seg = 10) {
  seg = segs(m, seg);
  const r = (sR - sL) / 2, sc = (sL + sR) / 2;
  const pts = [W.P(sL, spring, d)];
  pts.push(W.P(sL, top, d), W.P(sR, top, d), W.P(sR, spring, d));
  for (let i = 1; i < seg; i++) {
    const a = (i / seg) * Math.PI; // from right (0) to left (π)
    pts.push(W.P(sc + Math.cos(a) * r, spring + Math.sin(a) * r, d));
  }
  m.poly(pts, W.n);
}

// Flat half-ring (archivolt) on the wall face: radii r0..r1 around (sc, spring), thickness d0..d1
export function warchRing(m, W, sc, spring, r0, r1, d0, d1, seg = 12, a0 = 0, a1 = Math.PI) {
  seg = segs(m, seg);
  const pt = (a, r, d) => W.P(sc + Math.cos(a) * r, spring + Math.sin(a) * r, d);
  // the inner edge of a thin window archivolt is a few cm of stone seen edge-on: dropped at low quality
  const inner = !(m.low && d1 - d0 < 0.15);
  for (let i = 0; i < seg; i++) {
    const aa = a0 + ((a1 - a0) * i) / seg, ab = a0 + ((a1 - a0) * (i + 1)) / seg;
    m.quadN(pt(aa, r0, d1), pt(ab, r0, d1), pt(ab, r1, d1), pt(aa, r1, d1), W.n); // front
    const am = (aa + ab) / 2;
    const out = [W.t[0] * Math.cos(am), Math.sin(am), W.t[2] * Math.cos(am)];
    m.quadN(pt(aa, r1, d0), pt(ab, r1, d0), pt(ab, r1, d1), pt(aa, r1, d1), out); // outer edge
    if (inner) m.quadN(pt(aa, r0, d0), pt(ab, r0, d0), pt(ab, r0, d1), pt(aa, r0, d1), [-out[0], -out[1], -out[2]]); // inner edge
  }
  // feet of the ring
  if (a0 === 0 && a1 === Math.PI) {
    m.quadN(pt(0, r0, d0), pt(0, r1, d0), pt(0, r1, d1), pt(0, r0, d1), [0, -1, 0]);
    m.quadN(pt(Math.PI, r0, d0), pt(Math.PI, r1, d0), pt(Math.PI, r1, d1), pt(Math.PI, r0, d1), [0, -1, 0]);
  }
}

let WIN_SEQ = 0;
function variantFor(seed) {
  // deterministic hash → variant index
  let h = (seed * 2654435761) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  return (h >>> 0) % WINDOW_VARIANTS;
}

// Window glass inside an opening (rectangular, optionally arched head), at depth d.
export function wglass(m, W, sL, sR, yb, yt, arch, d, variant = null, seg = 10) {
  seg = segs(m, seg);
  const k = variant ?? variantFor(++WIN_SEQ);
  const u0 = k / WINDOW_VARIANTS, du = 1 / WINDOW_VARIANTS;
  const w = sR - sL, h = yt - yb;
  const uvOf = (s, y) => [u0 + (0.03 + 0.94 * ((s - sL) / w)) * du, (y - yb) / h];
  const r = w / 2, sc = (sL + sR) / 2;
  const spring = arch ? yt - r : yt;
  const a = W.P(sL, yb, d), b = W.P(sR, yb, d), c = W.P(sR, spring, d), e = W.P(sL, spring, d);
  m.quadN(a, b, c, e, W.n, uvOf(sL, yb), uvOf(sR, yb), uvOf(sR, spring), uvOf(sL, spring));
  if (arch) {
    const ctr = W.P(sc, spring, d), tc = uvOf(sc, spring);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI, a1 = ((i + 1) / seg) * Math.PI;
      const s0 = sc + Math.cos(a0) * r, y0 = spring + Math.sin(a0) * r, s1 = sc + Math.cos(a1) * r, y1 = spring + Math.sin(a1) * r;
      m.triN(ctr, W.P(s0, y0, d), W.P(s1, y1, d), W.n, tc, uvOf(s0, y0), uvOf(s1, y1));
    }
  }
}

// Reveals (jambs, sill, head / arch soffit) of an opening cut `depth` deep into the wall.
export function wreveal(m, W, sL, sR, yb, yt, arch, depth, seg = 10) {
  seg = segs(m, seg);
  const r = (sR - sL) / 2, sc = (sL + sR) / 2;
  const spring = arch ? yt - r : yt;
  const t = W.t, nt = [-t[0], 0, -t[2]];
  m.quadN(W.P(sL, yb, 0), W.P(sL, yb, -depth), W.P(sL, spring, -depth), W.P(sL, spring, 0), t);
  m.quadN(W.P(sR, yb, 0), W.P(sR, spring, 0), W.P(sR, spring, -depth), W.P(sR, yb, -depth), nt);
  m.quadN(W.P(sL, yb, 0), W.P(sR, yb, 0), W.P(sR, yb, -depth), W.P(sL, yb, -depth), [0, 1, 0]);
  if (!arch) {
    m.quadN(W.P(sL, yt, 0), W.P(sL, yt, -depth), W.P(sR, yt, -depth), W.P(sR, yt, 0), [0, -1, 0]);
  } else {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI, a1 = ((i + 1) / seg) * Math.PI, am = (a0 + a1) / 2;
      const p = (a, d) => W.P(sc + Math.cos(a) * r, spring + Math.sin(a) * r, d);
      const inward = [-t[0] * Math.cos(am), -Math.sin(am), -t[2] * Math.cos(am)];
      m.quadN(p(a0, 0), p(a1, 0), p(a1, -depth), p(a0, -depth), inward);
    }
  }
}

/**
 * Tiered facade on a wall segment [s0, s1] with real window openings.
 * spec: {
 *   bottom, top,                 wall face extent (y)
 *   tiers: [{ y0, y1, kind:'rect'|'arch'|'double'|'blank', w, sill, head, mid, trim:'full'|'simple'|'none' }]
 *   bay: target bay width, end: min end-pier width, bays: explicit bay count,
 *   depth: reveal depth, ground: (u,v)=>y for burying windows below grade, skipBelow: y (no openings under it)
 *   override(i, tier, sc) → kind | {kind,w,...} | null       per-bay overrides (doors, blanks)
 *   pilasters: { y0, y1, w, proj, cap, ends } , belts: [{ y, h, proj, mat }], cornice: { y, layers:[[h, proj]], mat }
 *   plinth: { h, proj, mat }  (follows the terrain in steps per bay), mats: { wall, reveal, sill, arch }
 * }
 * Returns the list of openings built (for callers adding extra detail).
 */
export function facade(K, W, spec) {
  const s0 = spec.s0 ?? 0, s1 = spec.s1 ?? W.L;
  const L = s1 - s0;
  const mats = { wall: 'brick', reveal: 'brick', sill: 'trim', arch: 'trim', glass: 'glass', ...(spec.mats || {}) };
  const wall = K.m(mats.wall), rev = K.m(mats.reveal), trim = K.m(mats.sill), archM = K.m(mats.arch), glass = K.m(mats.glass);
  // wall faces (skipped with noWall when a caller builds the face itself, e.g. around a tall opening)
  const face = spec.noWall ? () => {} : (a, b, c, d) => wrect(wall, W, a, b, c, d);
  const depth = spec.depth ?? 0.32;
  const end = spec.end ?? 1.1;
  const usable = L - 2 * end;
  let nb = spec.bays ?? Math.max(0, Math.round(usable / (spec.bay ?? 3.8)));
  if (usable < 1.4) nb = 0;
  const bw = nb ? usable / nb : 0;
  const tiers = (spec.tiers || []).slice().sort((a, b) => a.y0 - b.y0);
  const openings = [];
  const groundAt = (s) => (spec.ground ? spec.ground(...W.plan(s, 1.6)) : -Infinity);

  // bands outside the tiers
  const first = tiers.length ? tiers[0].y0 : spec.top, last = tiers.length ? tiers[tiers.length - 1].y1 : spec.top;
  if (spec.bottom < first) face(s0, s1, spec.bottom, first);
  // (tiers entirely below `bottom` are skipped; a straddling tier is clipped)
  if (last < spec.top) face(s0, s1, last, spec.top);

  for (let ti = 0; ti < tiers.length; ti++) {
    const T0 = tiers[ti];
    if (T0.y1 <= spec.bottom) continue;
    const T = T0.y0 < spec.bottom ? { ...T0, y0c: spec.bottom } : T0;
    const ty0 = T.y0c ?? T.y0; // clipped bottom of this band (tiers may start below the wall bottom)
    const ops = [];
    for (let i = 0; i < nb && T.kind !== 'blank'; i++) {
      const sc = s0 + end + (i + 0.5) * bw;
      let o = { kind: T.kind, w: T.w ?? 1.8, sill: T.sill ?? 0.9, head: T.head ?? 0.6, arch: T.kind === 'arch' || !!T.arch, mid: T.mid, trim: T.trim ?? 'full' };
      if (spec.override) {
        const ov = spec.override(i, T, sc, nb);
        if (ov === 'blank' || ov === null) continue;
        if (typeof ov === 'string') o.kind = ov;
        else if (ov) Object.assign(o, ov);
        if (o.kind === 'arch') o.arch = true;
      }
      if (o.kind === 'blank') continue;
      const w = Math.min(o.w, bw - 0.6);
      if (w < 0.5) continue;
      const yb = T.y0 + (o.kind === 'door' ? 0 : o.sill);
      const yt = T.y1 - o.head;
      if (spec.skipBelow !== undefined && yb < spec.skipBelow) continue;
      if (yb < ty0) continue;
      if (groundAt(sc) > yb - 0.25) continue; // buried by the slope → plain wall
      if (yt - yb < 0.6) continue;
      ops.push({ ...o, sL: sc - w / 2, sR: sc + w / 2, sc, yb, yt, i, tier: ti, y0: T.y0, y1: T.y1 });
    }
    // wall face around openings
    let s = s0;
    for (const o of ops) {
      face(s, o.sL, ty0, T.y1);
      if (o.yb > ty0) face(o.sL, o.sR, ty0, o.yb);
      if (o.arch) warchPanel(wall, W, o.sL, o.sR, o.yt - (o.sR - o.sL) / 2, T.y1);
      else face(o.sL, o.sR, o.yt, T.y1);
      s = o.sR;
    }
    face(s, s1, ty0, T.y1);
    // openings
    for (const o of ops) {
      const w = o.sR - o.sL, r = w / 2, spring = o.yt - r;
      if (depth > 0.01) wreveal(rev, W, o.sL, o.sR, o.yb, o.yt, o.arch, depth);
      if (spec.noGlass) {
        // open arcade (no glazing, no door)
      } else if (o.kind === 'door') {
        const dh = Math.min(o.yt - o.yb - 0.4, 2.8);
        wglass(glass, W, o.sL, o.sR, o.yb + dh, o.yt, o.arch, -depth + 0.02);
        // door leaves + frame
        wbox(K.m('door'), W, o.sL, o.sR, o.yb, o.yb + dh, -depth, -depth + 0.08, BACK);
        wbox(K.m('door'), W, o.sL, o.sR, o.yb + dh, o.yb + dh + 0.18, -depth, -depth + 0.12, BACK);
      } else {
        wglass(glass, W, o.sL, o.sR, o.yb, o.yt, o.arch, -depth + 0.04);
      }
      if (o.kind === 'double' && o.mid) {
        // terracotta spandrel panel between the two storeys of a double-height opening
        wbox(archM, W, o.sL, o.sR, o.mid - 0.45, o.mid + 0.55, -depth + 0.04, -depth + 0.16, BACK);
      }
      if (o.trim === 'none') continue;
      if (o.kind !== 'door') wbox(trim, W, o.sL - 0.1, o.sR + 0.1, o.yb - 0.14, o.yb, -0.04, 0.11, BACK); // sill
      if (o.arch) {
        warchRing(archM, W, o.sc, spring, r, r + (o.trim === 'full' ? 0.3 : 0.18), -0.02, 0.06);
        if (o.trim === 'full' && !K.low) wbox(archM, W, o.sc - 0.2, o.sc + 0.2, spring + r - 0.1, spring + r + 0.5, -0.02, 0.12, BACK); // keystone
      } else if (o.trim === 'full') {
        wbox(archM, W, o.sL - 0.16, o.sR + 0.16, o.yt, o.yt + 0.3, -0.02, 0.06, BACK); // flat lintel
        if (!K.low) wbox(archM, W, o.sc - 0.18, o.sc + 0.18, o.yt - 0.04, o.yt + 0.42, -0.02, 0.1, BACK); // keystone
      }
    }
    openings.push(...ops);
  }

  // pilasters between bays
  if (spec.pilasters && nb > 0) {
    const pz = spec.pilasters, pm = K.m(pz.mat || 'brick'), cm = K.m(pz.capMat || 'trim');
    const w = pz.w ?? 0.7, pr = pz.proj ?? 0.14;
    const from = pz.ends ? 0 : 1, to = pz.ends ? nb : nb - 1;
    for (let i = from; i <= to; i++) {
      const s = s0 + end + i * bw;
      if (spec.pilasterSkip && spec.pilasterSkip(i, nb)) continue;
      wbox(pm, W, s - w / 2, s + w / 2, pz.y0, pz.y1, -0.02, pr, BACK_BOTTOM);
      if (pz.cap !== false) {
        wbox(cm, W, s - w / 2 - 0.1, s + w / 2 + 0.1, pz.y1 - 0.35, pz.y1, -0.02, pr + 0.08, BACK);
        wbox(cm, W, s - w / 2 - 0.08, s + w / 2 + 0.08, pz.y0, pz.y0 + 0.25, -0.02, pr + 0.06, BACK_BOTTOM);
      }
    }
  }
  // horizontal courses, extended past the ends so convex corners wrap
  for (const b of spec.belts || []) {
    const pr = b.proj ?? 0.1;
    wbox(K.m(b.mat || 'trim'), W, s0 - pr, s1 + pr, b.y, b.y + (b.h ?? 0.3), -0.03, pr, BACK);
  }
  if (spec.cornice) {
    const c = spec.cornice;
    let y = c.y;
    for (const [h, pr] of c.layers) {
      wbox(K.m(c.mat || 'trim'), W, s0 - pr, s1 + pr, y, y + h, -0.03, pr, BACK);
      y += h;
    }
    if (c.dentils) {
      // small blocks under the top layer
      const dm = K.m(c.mat || 'trim');
      const dy = c.dentils.y, sp = c.dentils.spacing ?? 0.55, dw = c.dentils.w ?? 0.2, dp = c.dentils.proj ?? 0.35;
      if (!K.low) for (let s = s0 + sp / 2; s < s1 - 0.1; s += sp) wbox(dm, W, s - dw / 2, s + dw / 2, dy, dy + (c.dentils.h ?? 0.22), 0, dp, ['+y', '-z']);
    }
  }
  if (spec.plinth && spec.ground) {
    const pl = spec.plinth, pm = K.m(pl.mat || 'granite'), pr = pl.proj ?? 0.08;
    const ns = Math.max(1, Math.round(L / 4));
    for (let i = 0; i < ns; i++) {
      const a = s0 + (L * i) / ns, b = s0 + (L * (i + 1)) / ns;
      const g = Math.min(groundAt(a), groundAt(b), groundAt((a + b) / 2));
      const top = pl.top !== undefined ? Math.max(pl.top, g + 0.3) : g + (pl.h ?? 0.8);
      wbox(pm, W, a - (i === 0 ? pr : 0), b + (i === ns - 1 ? pr : 0), spec.bottom, top, -0.03, pr, BACK_BOTTOM);
    }
  }
  return openings;
}

// Parapet inner face + coping along a wall (for flat roofs). roofY: roof deck, top: parapet top.
export function parapet(K, W, roofY, top, { thick = 0.4, coping = 'trim', s0 = 0, s1 = null } = {}) {
  const e = s1 ?? W.L;
  const m = K.m('brick');
  const inN = [-W.n[0], 0, -W.n[2]];
  m.quadN(W.P(s0, roofY, -thick), W.P(e, roofY, -thick), W.P(e, top, -thick), W.P(s0, top, -thick), inN);
  wbox(K.m(coping), W, s0 - 0.08, e + 0.08, top, top + 0.16, -thick - 0.06, 0.1);
}

// Signed area (CCW positive in u,v math sense)
export function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
export function ccw(ring) { return ringArea(ring) < 0 ? ring.slice().reverse() : ring; }

// Rectangle with its four corners cut off (CCW ring), e.g. the chamfered-square base of Hamerschlag's tower
export function chamferRect(u0, u1, v0, v1, c) {
  return [[u0 + c, v0], [u1 - c, v0], [u1, v0 + c], [u1, v1 - c], [u1 - c, v1], [u0 + c, v1], [u0, v1 - c], [u0, v0 + c]];
}

// Flat roof deck over a ring at height y
export function roofDeck(K, ring, y, mat = 'roofFlat') {
  K.m(mat).poly(ring.map(([u, v]) => [u, y, v]), [0, 1, 0]);
}

// Rolled copper cap along a sloping/level roof line p0 → p1 (hip or ridge): a shallow tent of two strips
function capLine(m, p0, p1, w = 0.16, rise = 0.09) {
  const dx = p1[0] - p0[0], dz = p1[2] - p0[2], L = Math.hypot(dx, dz) || 1;
  const sx = (-dz / L) * w, sz = (dx / L) * w; // plan-perpendicular offset
  const A0 = [p0[0] + sx, p0[1] - 0.02, p0[2] + sz], A1 = [p1[0] + sx, p1[1] - 0.02, p1[2] + sz];
  const B0 = [p0[0] - sx, p0[1] - 0.02, p0[2] - sz], B1 = [p1[0] - sx, p1[1] - 0.02, p1[2] - sz];
  const C0 = [p0[0], p0[1] + rise, p0[2]], C1 = [p1[0], p1[1] + rise, p1[2]];
  m.quadN(A0, A1, C1, C0, [0, 1, 0]);
  m.quadN(B0, C0, C1, B1, [0, 1, 0]);
}

/**
 * Hipped (or gabled) roof over an axis-aligned local rectangle.
 * { u0,u1,v0,v1, y (wall top / eave line), pitch (rise per run), over (eave overhang), axis:'u'|'v' (ridge direction),
 *   ends: [end0, end1] each 'hip'|'gable'|'none' ('none' = buried end, no gable wall), brackets: spacing | 0,
 *   sides: [side0, side1] overhang on/off, mat, soffit,
 *   fasciaMat (default green copper eave), capMat (default green copper hips + ridge) }
 */
export function hipRoof(K, o) {
  const pitch = o.pitch ?? 0.4, over = o.over ?? 0.7;
  const axis = o.axis || ((o.u1 - o.u0) >= (o.v1 - o.v0) ? 'u' : 'v');
  // (a, b) = (along ridge, across)
  const a0 = axis === 'u' ? o.u0 : o.v0, a1 = axis === 'u' ? o.u1 : o.v1;
  const b0 = axis === 'u' ? o.v0 : o.u0, b1 = axis === 'u' ? o.v1 : o.u1;
  const P = (a, y, b) => (axis === 'u' ? [a, y, b] : [b, y, a]);
  const ends = o.ends || ['hip', 'hip'];
  const half = (b1 - b0) / 2, bm = (b0 + b1) / 2;
  const yR = o.y + half * pitch;
  const yE = o.y - over * pitch;
  const A0 = ends[0] === 'hip' ? a0 - over : a0, A1 = ends[1] === 'hip' ? a1 + over : a1;
  const B0 = b0 - over, B1 = b1 + over;
  const r0 = ends[0] === 'hip' ? Math.min(a0 + half, (a0 + a1) / 2) : a0;
  const r1 = ends[1] === 'hip' ? Math.max(a1 - half, (a0 + a1) / 2) : a1;
  const roof = K.m(o.mat || 'roofTile');
  const slopeLen = Math.sqrt(1 + pitch * pitch);
  // UVs: u along the eave, v along the slope (metres)
  const sideUV = (a, b, bEave) => [a, Math.abs(b - bEave) * slopeLen];
  const endUV = (a, b, aEave) => [b, Math.abs(a - aEave) * slopeLen];
  const up = [0, 1, 0];
  // long sides
  roof.quadN(P(A0, yE, B0), P(A1, yE, B0), P(r1, yR, bm), P(r0, yR, bm), up,
    sideUV(A0, B0, B0), sideUV(A1, B0, B0), sideUV(r1, bm, B0), sideUV(r0, bm, B0));
  roof.quadN(P(A0, yE, B1), P(r0, yR, bm), P(r1, yR, bm), P(A1, yE, B1), up,
    sideUV(A0, B1, B1), sideUV(r0, bm, B1), sideUV(r1, bm, B1), sideUV(A1, B1, B1));
  // ends
  const endFace = (which) => {
    const A = which === 0 ? A0 : A1, r = which === 0 ? r0 : r1, a = which === 0 ? a0 : a1, kind = ends[which];
    if (kind === 'hip') {
      roof.triN(P(A, yE, B0), P(A, yE, B1), P(r, yR, bm), up, endUV(A, B0, A), endUV(A, B1, A), endUV(r, bm, A));
    } else if (kind === 'gable') {
      const out = axis === 'u' ? [which === 0 ? -1 : 1, 0, 0] : [0, 0, which === 0 ? -1 : 1];
      K.m(o.gableMat || 'brick').triN(P(a, o.y - 0.01, b0), P(a, o.y - 0.01, b1), P(a, yR, bm), out);
      // slanted overhang faces of the gable (barge boards)
      const sm = K.m(o.soffit || 'trim');
      sm.quadN(P(a, yE, B0), P(a, yR + 0.05, bm), P(a, yR + 0.3, bm), P(a, yE + 0.25, B0), out);
      sm.quadN(P(a, yE, B1), P(a, yE + 0.25, B1), P(a, yR + 0.3, bm), P(a, yR + 0.05, bm), out);
    }
  };
  endFace(0); endFace(1);
  // soffits + fascia
  const sm = K.m(o.soffit || 'trim');
  const fas = o.fascia ?? 0.22;
  const down = [0, -1, 0];
  const e0 = ends[0] === 'hip' ? a0 : A0, e1 = ends[1] === 'hip' ? a1 : A1;
  // side soffits (between wall line and eave), full length A0..A1
  sm.quadN(P(A0, yE, B0), P(A0, yE, b0), P(A1, yE, b0), P(A1, yE, B0), down);
  sm.quadN(P(A0, yE, b1), P(A0, yE, B1), P(A1, yE, B1), P(A1, yE, b1), down);
  // flat ceiling closing the whole underside at eave level (includes the hip-end soffits). Where a roof rectangle
  // reaches past its walls (Baker's spine stops 0.4 m short of the Mall wall, Porter's spine overhangs the loggia
  // court) the sky no longer shows through the back-face-culled roof slope; elsewhere it is hidden inside the walls.
  sm.quadN(P(A0, yE, b0), P(A1, yE, b0), P(A1, yE, b1), P(A0, yE, b1), down);
  // fascia boards / gutters: green copper, plus a narrow copper band on the roof edge
  const fm = K.m(o.fasciaMat || 'verdigris');
  const sideOut0 = axis === 'u' ? [0, 0, -1] : [-1, 0, 0], sideOut1 = axis === 'u' ? [0, 0, 1] : [1, 0, 0];
  const bandB = Math.min(0.35, over * 0.5), bandY = bandB * pitch; // band 0.35 m up the slope from the eave
  fm.quadN(P(A0, yE - fas, B0), P(A1, yE - fas, B0), P(A1, yE + 0.06, B0), P(A0, yE + 0.06, B0), sideOut0);
  fm.quadN(P(A0, yE - fas, B1), P(A0, yE + 0.06, B1), P(A1, yE + 0.06, B1), P(A1, yE - fas, B1), sideOut1);
  fm.quadN(P(A0, yE + 0.06, B0), P(A1, yE + 0.06, B0), P(A1 - (ends[1] === 'hip' ? bandB : 0), yE + bandY + 0.06, B0 + bandB), P(A0 + (ends[0] === 'hip' ? bandB : 0), yE + bandY + 0.06, B0 + bandB), [0, 1, 0]);
  fm.quadN(P(A0, yE + 0.06, B1), P(A0 + (ends[0] === 'hip' ? bandB : 0), yE + bandY + 0.06, B1 - bandB), P(A1 - (ends[1] === 'hip' ? bandB : 0), yE + bandY + 0.06, B1 - bandB), P(A1, yE + 0.06, B1), [0, 1, 0]);
  const endOut0 = axis === 'u' ? [-1, 0, 0] : [0, 0, -1], endOut1 = axis === 'u' ? [1, 0, 0] : [0, 0, 1];
  if (ends[0] === 'hip') fm.quadN(P(A0, yE - fas, B0), P(A0, yE + 0.06, B0), P(A0, yE + 0.06, B1), P(A0, yE - fas, B1), endOut0);
  if (ends[1] === 'hip') fm.quadN(P(A1, yE - fas, B0), P(A1, yE - fas, B1), P(A1, yE + 0.06, B1), P(A1, yE + 0.06, B0), endOut1);
  // ridge + hip caps (rolled green copper)
  const cap = K.m(o.capMat || 'verdigris');
  if (r1 - r0 > 0.05) capLine(cap, P(r0, yR, bm), P(r1, yR, bm), 0.16, 0.1);
  for (const [which, A, r] of [[0, A0, r0], [1, A1, r1]]) {
    if (ends[which] !== 'hip') continue;
    capLine(cap, P(A, yE, B0), P(r, yR, bm), 0.13, 0.07);
    capLine(cap, P(A, yE, B1), P(r, yR, bm), 0.13, 0.07);
  }
  // eave brackets (Italianate modillions) along the long walls — about 16k triangles over the Mall West group, so
  // they are left out at low quality (the soffit and fascia still read from afar)
  if (o.brackets && !K.low) {
    const bk = K.m(o.soffit || 'trim');
    const sp = o.brackets, bwid = 0.16, depth = over - 0.08;
    for (const side of [0, 1]) {
      if (o.bracketSides && !o.bracketSides[side]) continue;
      const bb = side === 0 ? b0 : b1, dir = side === 0 ? -1 : 1;
      // (the soffit covers the top; the inner face stays: the roof line b0/b1 may stand off the wall, and three.js
      // draws back faces into the shadow map, so it still casts the bracket's shadow)
      for (let a = e0 + sp / 2; a < e1 - sp / 4; a += sp) {
        const p0 = P(a - bwid / 2, yE - 0.32, bb), p1 = P(a + bwid / 2, yE, bb + dir * depth);
        bk.box(Math.min(p0[0], p1[0]), p0[1], Math.min(p0[2], p1[2]), Math.max(p0[0], p1[0]), p1[1], Math.max(p0[2], p1[2]), ['+y']);
      }
    }
  }
  return { yR, yE };
}

// ------------------------------------------------------------------------------------------------ columns
const _mat4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
// Unit prototypes, 16-sided (8-sided at low quality)
const PROTOS = new Map();
function proto(n = 16) {
  let P = PROTOS.get(n);
  if (P) return P;
  P = {
    cyl: new THREE.CylinderGeometry(1, 1, 1, n, 1, true).translate(0, 0.5, 0),
    cylCap: new THREE.CylinderGeometry(1, 1, 1, n, 1, false).translate(0, 0.5, 0),
    taper: new THREE.CylinderGeometry(0.84, 1, 1, n, 1, true).translate(0, 0.5, 0),
    echinus: new THREE.CylinderGeometry(1.32, 0.92, 1, n, 1, false).translate(0, 0.5, 0),
    bell: new THREE.CylinderGeometry(1.45, 0.9, 1, n, 1, false).translate(0, 0.5, 0),
  };
  PROTOS.set(n, P);
  return P;
}
function place(m, geom, x, y, z, sx, sy, sz, rotY = 0, opts = { uv: 'keep', uvScale: [1, 1] }) {
  _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rotY);
  _mat4.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  m.geometry(geom, _mat4, opts);
}
export function cylinder(m, x, y, z, r, h, { capped = true, seg = null, rTop = null } = {}) {
  const n = segs(m, seg || 16, 6);
  if (rTop !== null || (n !== 16 && n !== 8)) {
    const g = new THREE.CylinderGeometry(rTop ?? r, r, h, n, 1, !capped).translate(0, h / 2, 0);
    _mat4.makeTranslation(x, y, z);
    m.geometry(g, _mat4, { uv: 'keep', uvScale: [2 * Math.PI * r, h] });
    g.dispose();
    return;
  }
  const P = proto(n);
  place(m, capped ? P.cylCap : P.cyl, x, y, z, r, h, r, 0, { uv: 'keep', uvScale: [2 * Math.PI * r, h] });
}

// Classical column: base + tapered shaft + capital ('doric' echinus+abacus or 'corinthian' bell+abacus)
export function column(K, x, y, z, { r = 0.4, h = 6, order = 'doric', shaft = 'stone', cap = 'trim', rotY = 0 } = {}) {
  const P = proto(K.low ? 8 : 16);
  const baseH = order === 'doric' ? 0.18 * r * 2 : 0.5 * r * 2 * 0.6;
  const capH = order === 'doric' ? 0.55 * r * 2 * 0.6 : 1.1 * r * 2 * 0.6;
  const shaftH = h - baseH - capH;
  const cm = K.m(cap), sm = K.m(shaft);
  // base: plinth block + torus
  cm.box(x - r * 1.3, y, z - r * 1.3, x + r * 1.3, y + baseH * 0.45, z + r * 1.3, ['-y']);
  place(cm, P.cylCap, x, y + baseH * 0.45, z, r * 1.15, baseH * 0.55, r * 1.15);
  // shaft (uv: circumference metres x height)
  place(sm, P.taper, x, y + baseH, z, r, shaftH, r, rotY, { uv: 'keep', uvScale: [2 * Math.PI * r, shaftH] });
  // necking + capital
  const cy = y + baseH + shaftH;
  place(cm, order === 'doric' ? P.echinus : P.bell, x, cy, z, r * 0.9, capH * 0.6, r * 0.9);
  cm.box(x - r * 1.35, cy + capH * 0.6, z - r * 1.35, x + r * 1.35, cy + capH, z + r * 1.35);
}

// Annular sector prism (rings, entablatures, drums). Angles in the local u-v plane (u = r cos a, v = r sin a).
export function annulus(m, { cx, cz, r0, r1, y0, y1, a0 = 0, a1 = Math.PI * 2, seg = 48, faces = {} }) {
  seg = segs(m, seg, 8);
  const f = { top: true, bottom: true, inner: r0 > 0.01, outer: true, ends: Math.abs(a1 - a0) < Math.PI * 2 - 1e-6, ...faces };
  const pt = (a, r, y) => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
  for (let i = 0; i < seg; i++) {
    const aa = a0 + ((a1 - a0) * i) / seg, ab = a0 + ((a1 - a0) * (i + 1)) / seg, am = (aa + ab) / 2;
    const out = [Math.cos(am), 0, Math.sin(am)], inn = [-out[0], 0, -out[2]];
    if (f.outer) m.quadN(pt(aa, r1, y0), pt(ab, r1, y0), pt(ab, r1, y1), pt(aa, r1, y1), out);
    if (f.inner) m.quadN(pt(aa, r0, y0), pt(aa, r0, y1), pt(ab, r0, y1), pt(ab, r0, y0), inn);
    if (f.top) {
      if (r0 > 0.01) m.quadN(pt(aa, r0, y1), pt(ab, r0, y1), pt(ab, r1, y1), pt(aa, r1, y1), [0, 1, 0]);
      else m.triN([cx, y1, cz], pt(aa, r1, y1), pt(ab, r1, y1), [0, 1, 0]);
    }
    if (f.bottom) {
      if (r0 > 0.01) m.quadN(pt(aa, r0, y0), pt(aa, r1, y0), pt(ab, r1, y0), pt(ab, r0, y0), [0, -1, 0]);
      else m.triN([cx, y0, cz], pt(aa, r1, y0), pt(ab, r1, y0), [0, -1, 0]);
    }
  }
  if (f.ends) {
    const endFace = (a, sgn) => {
      const n = [-Math.sin(a) * sgn, 0, Math.cos(a) * sgn];
      m.quadN(pt(a, r0, y0), pt(a, r1, y0), pt(a, r1, y1), pt(a, r0, y1), n);
    };
    endFace(a0, -1); endFace(a1, 1);
  }
}

// ------------------------------------------------------------------------------------------------ stairs
// Straight flight rising from yLow (at `from`) to yHigh (at `to`) in the local plan; width across; blocks go
// down to the terrain (solid) so they never float. Registers as walkable via the 'step' mesher key.
export function stairFlight(K, from, to, yLow, yHigh, width, { mat = 'step', cheek = 'granite', cheekH = 0.5, ground = null, riser = 0.16 } = {}) {
  const du = to[0] - from[0], dv = to[1] - from[1], L = Math.hypot(du, dv);
  const W = wallFrame([from[0], from[1]], [to[0], to[1]]);
  const n = Math.max(1, Math.round(Math.abs(yHigh - yLow) / riser));
  const tread = L / n;
  const m = K.m(mat);
  const gmin = ground ? Math.min(ground(...from), ground(...to)) - 0.8 : Math.min(yLow, yHigh) - 1;
  for (let i = 0; i < n; i++) {
    const y = yLow + ((yHigh - yLow) * (i + 1)) / n;
    wbox(m, W, i * tread, L, gmin, y, -width / 2, width / 2, ['-y']);
  }
  if (cheek) {
    const cm = K.m(cheek);
    for (const side of [-1, 1]) {
      const d0 = side < 0 ? -width / 2 - 0.45 : width / 2, d1 = side < 0 ? -width / 2 : width / 2 + 0.45;
      // stepped cheek wall following the flight
      const segs = Math.max(1, Math.ceil(n / 3));
      for (let k = 0; k < segs; k++) {
        const sa = (L * k) / segs, sb = (L * (k + 1)) / segs;
        const yTop = yLow + ((yHigh - yLow) * (k + 1)) / segs + cheekH;
        wbox(cm, W, sa, sb, gmin, yTop, d0, d1, ['-y']);
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------ special bays
// A wall segment [s0, s1] (bottom..top) pierced by ONE tall opening (centred), e.g. a stair window spanning several
// storeys. spandrels: y values where a terracotta panel crosses the glazing. Returns the opening extents.
export function tallBay(K, W, { s0, s1, bottom, top, yb, yt, w, arch = true, depth = 0.45, spandrels = [], mullions = 0, surround = 0.35 }) {
  const wall = K.m('brick');
  const sc = (s0 + s1) / 2, sL = sc - w / 2, sR = sc + w / 2, r = w / 2, spring = arch ? yt - r : yt;
  wrect(wall, W, s0, sL, bottom, top);
  wrect(wall, W, sR, s1, bottom, top);
  wrect(wall, W, sL, sR, bottom, yb);
  if (arch) warchPanel(wall, W, sL, sR, spring, top, 0, 14);
  else wrect(wall, W, sL, sR, yt, top);
  wreveal(wall, W, sL, sR, yb, yt, arch, depth, 14);
  wglass(K.m('glass'), W, sL, sR, yb, yt, arch, -depth + 0.05, null, 14);
  const trim = K.m('trim');
  for (const y of spandrels) wbox(trim, W, sL, sR, y - 0.4, y + 0.45, -depth + 0.05, -depth + 0.18);
  for (let i = 1; i <= mullions; i++) {
    const s = sL + (w * i) / (mullions + 1);
    const yTop = arch ? spring + Math.sqrt(Math.max(0, r * r - (s - sc) ** 2)) : yt;
    wbox(trim, W, s - 0.09, s + 0.09, yb, yTop, -depth + 0.05, -depth + 0.2);
  }
  if (surround > 0) {
    wbox(trim, W, sL - 0.12, sR + 0.12, yb - 0.16, yb, -0.04, 0.14);
    if (arch) {
      warchRing(trim, W, sc, spring, r, r + surround, -0.02, 0.08, 14);
      wbox(trim, W, sc - 0.25, sc + 0.25, spring + r - 0.1, spring + r + 0.6, -0.02, 0.14);
      // jamb strips from the sill up to the springing
      wbox(trim, W, sL - surround, sL, yb, spring, -0.02, 0.08);
      wbox(trim, W, sR, sR + surround, yb, spring, -0.02, 0.08);
    }
  }
  return { sL, sR, spring };
}

// Classical door surround (pilasters + entablature + pediment) around an opening [sL,sR] rising to yTop.
export function doorSurround(K, W, sL, sR, y0, yTop, { pediment = true, proj = 0.3 } = {}) {
  const st = K.m('stone');
  const pw = 0.45;
  wbox(st, W, sL - 0.15 - pw, sL - 0.15, y0, yTop, -0.02, proj);
  wbox(st, W, sR + 0.15, sR + 0.15 + pw, y0, yTop, -0.02, proj);
  wbox(st, W, sL - 0.35 - pw, sR + 0.35 + pw, yTop, yTop + 0.55, -0.02, proj + 0.12);
  wbox(st, W, sL - 0.45 - pw, sR + 0.45 + pw, yTop + 0.55, yTop + 0.75, -0.02, proj + 0.22);
  if (pediment) {
    const a = sL - 0.45 - pw, b = sR + 0.45 + pw, mid = (a + b) / 2, h = (b - a) * 0.2;
    const y = yTop + 0.75;
    for (const d of [proj + 0.2]) {
      st.triN(W.P(a, y, d), W.P(b, y, d), W.P(mid, y + h, d), W.n);
    }
    const n1 = [W.n[0], 1, W.n[2]];
    st.quadN(W.P(a, y, -0.02), W.P(a, y, proj + 0.2), W.P(mid, y + h, proj + 0.2), W.P(mid, y + h, -0.02), n1);
    st.quadN(W.P(b, y, -0.02), W.P(mid, y + h, -0.02), W.P(mid, y + h, proj + 0.2), W.P(b, y, proj + 0.2), n1);
  }
}
