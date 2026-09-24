// 3D ground-level infrastructure that is not painted into the ground texture:
//   bridges (bridges.js) · railway (rail.js) · water surfaces & fountains (water.js)
//   barriers: fences (picket / chain-link / railing), stone & brick walls, retaining walls, jersey barriers, bollards
//   cliffs: exposed Pittsburgh sandstone faces along natural=cliff ways
// Contract: ARCHITECTURE.md §terrain / §roads. Road surfaces themselves are painted by terrain.js.
import * as THREE from 'three';
import { createBridges, GeoBuf, sweepSeg, boxAt } from './bridges.js';
import { createRail } from './rail.js';
import { createWater, waterLevelAt } from './water.js';
import { markRange } from './terrain.js';
import { resamplePolyline, mulberry, tileNoise, prepareGround, computeMarkings, parkingLots, lotStalls, slicePolyline, polyLength } from './ground-painter.js';

// ---------------------------------------------------------------------------------------------------------------
// procedural textures
function fenceTexture(ctx, kind) {
  const W = kind === 'chain' ? 128 : 256, H = 256;
  const c = ctx.materials.makeCanvas(W, H), g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  if (kind === 'picket') {
    // 1 m wide tile: 8 pickets with spear tops, rails near top & bottom (v normalised 0..1 over the fence height)
    g.fillStyle = '#ffffff';
    const n = 8, pw = W / n;
    for (let i = 0; i < n; i++) {
      const x = i * pw + pw / 2;
      g.fillRect(x - 3, 10, 6, H - 10);
      g.beginPath(); g.moveTo(x - 6, 14); g.lineTo(x, 0); g.lineTo(x + 6, 14); g.fill();
    }
    g.fillRect(0, 26, W, 8);
    g.fillRect(0, H - 30, W, 8);
  } else {
    // chain-link: diamond wire mesh; tile = 0.5 m wide × full height
    g.strokeStyle = '#ffffff'; g.lineWidth = 2.2;
    const s = 16;
    for (let x = -H; x < W + H; x += s) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + H, H); g.stroke();
      g.beginPath(); g.moveTo(x, H); g.lineTo(x + H, 0); g.stroke();
    }
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W, 5); // top rail
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.repeat.set(kind === 'chain' ? 2 : 1, 1);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rockTexture(ctx) {
  // CPU-backed canvas (it is read back): a readback of a GPU canvas would wait for the GPU process to finish
  // everything queued before it — including the large ground painting.
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true });
  const r = mulberry(707);
  // bedding: soft horizontal bands of buff / grey sandstone (Pittsburgh Formation)
  let y = 0;
  while (y < S) {
    const h = 24 + r() * 70;
    const tone = 0.86 + r() * 0.26;
    const grey = r() < 0.35;
    const base = grey ? [128, 122, 112] : [146, 126, 98];
    g.fillStyle = `rgb(${(base[0] * tone) | 0},${(base[1] * tone) | 0},${(base[2] * tone) | 0})`;
    g.fillRect(0, y, S, h + 1);
    g.fillStyle = 'rgba(40,32,24,0.22)';
    for (let x = 0; x < S; x += 4) g.fillRect(x, y + h - 1 + Math.sin(x * 0.05 + y) * 1.5, 4, 1.5);
    y += h;
  }
  // mottling + lichen + streaks
  const n = tileNoise(128, [4, 8, 16, 32], 71);
  const img = g.getImageData(0, 0, S, S), d = img.data;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const k = (j * S + i) * 4, v = n[((j >> 2) & 127) * 128 + ((i >> 2) & 127)];
    const f = 0.75 + v * 0.5 + (r() - 0.5) * 0.12;
    d[k] = Math.min(255, d[k] * f); d[k + 1] = Math.min(255, d[k + 1] * f); d[k + 2] = Math.min(255, d[k + 2] * f);
    if (v > 0.66) { d[k] = d[k] * 0.8 + 70 * 0.2; d[k + 1] = d[k + 1] * 0.8 + 88 * 0.2; d[k + 2] = d[k + 2] * 0.8 + 50 * 0.2; }
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(20,16,12,0.55)';
  for (let i = 0; i < 26; i++) {
    let x = r() * S, yy = r() * S;
    g.lineWidth = 1 + r() * 2;
    g.beginPath(); g.moveTo(x, yy);
    for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 14; yy += 8 + r() * 16; g.lineTo(x, yy); }
    g.stroke();
  }
  g.fillStyle = 'rgba(40,32,24,0.25)';
  for (let i = 0; i < 60; i++) g.fillRect(r() * S, r() * S, 1 + r() * 2, 20 + r() * 80);
  return ctx.materials.canvasTexture(c, { repeatW: 7, repeatH: 7 });
}

// ---------------------------------------------------------------------------------------------------------------
export async function createRoads(ctx) {
  const T0 = performance.now();
  const stats = {};
  const step = async (name, fn) => {
    const t = performance.now();
    try { stats[name] = (await fn()) || true; } catch (e) { console.error(`[roads] ${name} failed`, e); }
    stats[`${name}Ms`] = Math.round(performance.now() - t);
    await ctx.yield?.();
  };
  let bridges = null;
  await step('bridges', () => { bridges = createBridges(ctx); return bridges.stats; });
  await step('rail', () => createRail(ctx).stats);
  await step('water', () => { createWater(ctx); return true; });
  const surface = (x, z) => {
    const g = ctx.heightAt(x, z);
    const d = bridges?.deckHeightAt?.(x, z);
    return d != null && d > g - 0.5 ? Math.max(g, d) : g;
  };
  await step('barriers', () => createBarriers(ctx, bridges?.deckSnap));
  await step('cliffs', () => createCliffs(ctx));
  await step('markings', () => createMarkingDecals(ctx));
  await step('curbs', () => createCurbs(ctx));
  await step('fieldArt', () => createFieldArt(ctx));
  ctx.roads = { bridges, deckHeightAt: bridges?.deckHeightAt || (() => null), surfaceAt: surface, waterLevelAt: (x, z) => waterLevelAt(ctx, x, z), stats };
  stats.totalMs = Math.round(performance.now() - T0);
  console.info('[roads]', JSON.stringify(stats));
  return ctx.roads;
}

// ---------------------------------------------------------------------------------------------------------------
// Base heights of a barrier's samples: each one stands either on the ground or on a bridge deck, whichever makes
// the barrier's run the smoothest (least total vertical travel, found by a two-state dynamic programme). So a
// fence along the rail or the trail under the Charles Anderson / Schenley bridges stays on the ground (the deck
// passes 35 m overhead), while the jersey barriers mapped along the Panther Hollow Bridge stay on its deck even
// where OSM draws them a metre or two beyond its edge — those samples are moved in onto the deck (S is updated).
const DECK_TOL = 2.5; // m beyond a deck's edge that still count as on it
function barrierBase(ctx, S, snapAt) {
  const n = S.length;
  const g = S.map((p) => ctx.heightAt(p.x, p.z));
  const c = S.map((p, i) => { const s = snapAt?.(p.x, p.z, DECK_TOL); return s && s.y > g[i] - 0.5 ? s : null; });
  if (c.every((v) => v === null)) return g;
  const yOf = (i, st) => (st ? Math.max(g[i], c[i].y) : g[i]);
  // (a small cost per sample for standing on a deck it is mapped beside, and jumps > 1.2 m cost triple)
  const stay = (i, st) => (st && c[i].off ? 0.3 : 0);
  const jump = (dy) => (dy > 1.2 ? 1.2 + (dy - 1.2) * 3 : dy);
  const cost = [[0, c[0] ? stay(0, 1) : Infinity]], from = [[0, 0]];
  for (let i = 1; i < n; i++) {
    cost.push([Infinity, Infinity]); from.push([0, 0]);
    for (let st = 0; st < 2; st++) {
      if (st && !c[i]) continue;
      for (let ps = 0; ps < 2; ps++) {
        if (cost[i - 1][ps] === Infinity) continue;
        const v = cost[i - 1][ps] + jump(Math.abs(yOf(i, st) - yOf(i - 1, ps))) + stay(i, st);
        if (v < cost[i][st]) { cost[i][st] = v; from[i][st] = ps; }
      }
    }
  }
  const out = new Array(n);
  let st = cost[n - 1][1] < cost[n - 1][0] ? 1 : 0;
  for (let i = n - 1; i >= 0; i--) {
    out[i] = yOf(i, st);
    if (st && c[i].off) { S[i].x = c[i].x; S[i].z = c[i].z; }
    st = from[i][st];
  }
  return out;
}

function createBarriers(ctx, deckAt) {
  const data = ctx.data;
  const skip = ctx.skipBarrierIds || new Set();
  const M = ctx.materials;
  const buf = { stone: new GeoBuf(), brick: new GeoBuf(), concrete: new GeoBuf(), metal: new GeoBuf(), galv: new GeoBuf(), picket: new GeoBuf(), chain: new GeoBuf() };
  const picketMat = new THREE.MeshStandardMaterial({ map: fenceTexture(ctx, 'picket'), color: '#2a2c2e', metalness: 0.5, roughness: 0.5, alphaTest: 0.5, side: THREE.DoubleSide });
  picketMat.name = 'fence-picket';
  const chainMat = new THREE.MeshStandardMaterial({ map: fenceTexture(ctx, 'chain'), color: '#9aa0a3', metalness: 0.6, roughness: 0.45, alphaTest: 0.35, side: THREE.DoubleSide });
  chainMat.name = 'fence-chainlink';
  const mats = {
    stone: M.get('sandstone'), brick: M.get('brickBuff'), concrete: M.get('concreteDark'),
    metal: M.get('darkMetal'), galv: M.get('aluminium'), picket: picketMat, chain: chainMat,
  };
  let count = 0;
  for (const b of data.barriers || []) {
    if (skip.has(b.id) || !b.points || b.points.length < 2) continue;
    const t = b.type;
    if (t === 'hedge' || t === 'yes' || t === 'gate' || t === 'kerb') continue;
    const mat = (b.material || '').toLowerCase();
    const S = resamplePolyline(b.points, 1.5).map((p) => ({ ...p, nx: -p.tz, nz: p.tx }));
    if (S.length < 2) continue;
    const L = S[S.length - 1].s;
    const gy = barrierBase(ctx, S, deckAt);
    count++;
    if (t === 'fence' || t === 'railing' || t === 'guard_rail') {
      const chain = /chain/.test(mat) || /Substation/i.test(b.name || '');
      const railing = mat === 'railing' || t === 'railing' || t === 'guard_rail';
      const h = b.height || (chain ? (/Substation/i.test(b.name || '') ? 2.6 : 2.0) : railing ? 1.1 : 1.5);
      if (railing) {
        for (const hh of [h, h * 0.5]) boxRibbon(buf.metal, S, (i) => gy[i] + hh - 0.05, 0.05, 0.06);
      } else {
        // textured mesh panel (u in metres, v 0..1 over the height)
        const pb = chain ? buf.chain : buf.picket;
        for (let i = 0; i < S.length - 1; i++) {
          const p = S[i], q = S[i + 1];
          pb.quad([p.x, gy[i], p.z], [q.x, gy[i + 1], q.z], [q.x, gy[i + 1] + h, q.z], [p.x, gy[i] + h, p.z],
            [p.s, 0], [q.s, 0], [q.s, 1], [p.s, 1], [p.nx, 0, p.nz]);
        }
        if (chain) boxRibbon(buf.galv, S, (i) => gy[i] + h - 0.03, 0.03, 0.04);
      }
      // posts
      const postEvery = chain ? 3 : 2.4;
      for (let s = 0; s <= L + 0.01; s += postEvery) {
        const i = Math.min(S.length - 1, Math.round((s / L) * (S.length - 1)));
        const p = S[i];
        boxAt(chain ? buf.galv : buf.metal, p.x, gy[i] - 0.3, p.z, 0.07, 0.07, h + 0.35, p.tx, p.tz);
      }
      addColliders(ctx, S, gy, 0.12, h, 'fence');
    } else if (t === 'wall' || t === 'city_wall') {
      const h = b.height || 1.1;
      const bm = /brick/.test(mat) ? 'brick' : /concrete/.test(mat) ? 'concrete' : 'stone';
      wallSweep(buf[bm], S, (i) => gy[i] - 0.4, (i) => gy[i] + h, 0.45, 0.08);
      addColliders(ctx, S, gy, 0.3, h, 'wall');
    } else if (t === 'retaining_wall') {
      // height from the terrain step across the wall
      const lo = [], hi = [];
      for (const p of S) {
        const a = ctx.heightAt(p.x + p.nx * 2.5, p.z + p.nz * 2.5), c = ctx.heightAt(p.x - p.nx * 2.5, p.z - p.nz * 2.5);
        lo.push(Math.min(a, c)); hi.push(Math.max(a, c));
      }
      const top = (i) => Math.max(hi[i] + 0.35, lo[i] + (b.height || 1.2));
      wallSweep(buf.concrete, S, (i) => lo[i] - 0.5, top, 0.4, 0.05);
      addColliders(ctx, S, lo, 0.28, 0, 'retaining-wall', top);
    } else if (t === 'jersey_barrier') {
      // New-Jersey profile
      const prof = [[-0.3, 0], [-0.22, 0.08], [-0.1, 0.3], [-0.08, 0.81], [0.08, 0.81], [0.1, 0.3], [0.22, 0.08], [0.3, 0]];
      for (let k = 0; k < prof.length - 1; k++) {
        const a = prof[k], c = prof[k + 1];
        const nx = c[1] - a[1], ny = -(c[0] - a[0]);
        sweepSeg(buf.concrete, S, (i) => gy[i], a, c, [nx, ny]);
      }
      addColliders(ctx, S, gy, 0.3, 0.81, 'barrier');
    } else if (t === 'bollard') {
      for (let s = 0; s <= L + 0.01; s += 1.6) {
        const i = Math.min(S.length - 1, Math.round((s / L) * (S.length - 1)));
        const p = S[i];
        boxAt(buf.metal, p.x, gy[i] - 0.2, p.z, 0.16, 0.16, 1.1, p.tx, p.tz);
        ctx.colliders.addCircle(p.x, p.z, 0.12, gy[i] - 0.2, gy[i] + 0.9, 'bollard');
      }
    }
  }
  const group = new THREE.Group();
  group.name = 'barriers';
  for (const [k, b] of Object.entries(buf)) {
    if (b.empty) continue;
    const m = new THREE.Mesh(b.geometry(), mats[k]);
    m.name = `barrier-${k}`;
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  ctx.scene.add(group);
  return { barriers: count };
}

// thin box-section rail following samples at height yOf(i)
function boxRibbon(buf, S, yOf, halfW, h) {
  sweepSeg(buf, S, yOf, [-halfW, 0], [halfW, 0], [0, 1]);
  sweepSeg(buf, S, yOf, [halfW, 0], [halfW, -h], [1, 0]);
  sweepSeg(buf, S, yOf, [-halfW, 0], [-halfW, -h], [-1, 0]);
  sweepSeg(buf, S, yOf, [-halfW, -h], [halfW, -h], [0, -1]);
}

// solid wall with a slightly wider coping: bottom(i) .. top(i), thickness t
function wallSweep(buf, S, bottom, top, t, cop) {
  const h = t / 2;
  const yB = (i) => bottom(i), yT = (i) => top(i);
  // faces are built with sweepSeg by passing a per-sample base and relative offsets
  const face = (off, out) => {
    for (let i = 0; i < S.length - 1; i++) {
      const p = S[i], q = S[i + 1];
      const A0 = [p.x + p.nx * off, yB(i), p.z + p.nz * off], A1 = [q.x + q.nx * off, yB(i + 1), q.z + q.nz * off];
      const B0 = [p.x + p.nx * off, yT(i), p.z + p.nz * off], B1 = [q.x + q.nx * off, yT(i + 1), q.z + q.nz * off];
      buf.quad(A0, A1, B1, B0, [p.s, yB(i)], [q.s, yB(i + 1)], [q.s, yT(i + 1)], [p.s, yT(i)], [p.nx * out, 0, p.nz * out]);
    }
  };
  face(h, 1);
  face(-h, -1);
  // coping
  sweepSeg(buf, S, yT, [-h - cop, 0.12], [h + cop, 0.12], [0, 1]);
  sweepSeg(buf, S, yT, [h + cop, 0.12], [h + cop, 0], [1, 0]);
  sweepSeg(buf, S, yT, [-h - cop, 0.12], [-h - cop, 0], [-1, 0]);
  sweepSeg(buf, S, yT, [-h - cop, 0], [h + cop, 0], [0, -1]);
  // end caps
  for (const [i, dir] of [[0, -1], [S.length - 1, 1]]) {
    const p = S[i];
    const P = (off, y) => [p.x + p.nx * off, y, p.z + p.nz * off];
    buf.quad(P(-h, yB(i)), P(h, yB(i)), P(h, yT(i)), P(-h, yT(i)), [-h, yB(i)], [h, yB(i)], [h, yT(i)], [-h, yT(i)], [p.tx * dir, 0, p.tz * dir]);
  }
}

function addColliders(ctx, S, gy, halfT, h, tag, topFn = null) {
  for (let i = 0; i < S.length - 1; i++) {
    const p = S[i], q = S[i + 1];
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    if (len < 0.05) continue;
    const yMin = Math.min(gy[i], gy[i + 1]) - 0.5;
    const yMax = topFn ? Math.max(topFn(i), topFn(i + 1)) : Math.max(gy[i], gy[i + 1]) + h;
    ctx.colliders.addBox((p.x + q.x) / 2, (p.z + q.z) / 2, len / 2 + 0.02, halfT, -Math.atan2(q.z - p.z, q.x - p.x), yMin, yMax, tag);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Cliffs: jagged, slightly leaning sandstone faces between the high side (left of the way) and the low side (right).
function createCliffs(ctx) {
  const cliffs = ctx.data.cliffs || [];
  if (!cliffs.length) return { cliffs: 0 };
  const hf = ctx.heightfield;
  const inGrid = (x, z) => x > hf.minX + 4 && x < hf.maxX - 4 && z > hf.minZ + 4 && z < hf.maxZ - 4;
  const buf = new GeoBuf();
  const talus = new GeoBuf();
  const noise = (a, b) => Math.sin(a * 1.7 + Math.sin(b * 0.9) * 2.1) * 0.5 + Math.sin(a * 0.43 - b * 1.3) * 0.35 + Math.sin(a * 3.1 + b * 2.3) * 0.15;
  let n = 0;
  for (const c of cliffs) {
    const S0 = resamplePolyline(c.points, 2.2).map((p) => ({ ...p, nx: -p.tz, nz: p.tx }));
    // split into in-grid runs
    const runs = [];
    let cur = [];
    for (const p of S0) { if (inGrid(p.x, p.z)) cur.push(p); else if (cur.length) { runs.push(cur); cur = []; } }
    if (cur.length) runs.push(cur);
    for (const S of runs) {
      if (S.length < 3) continue;
      n++;
      const top = [], bot = [];
      for (const p of S) {
        const hi = Math.max(ctx.heightAt(p.x - p.nx * 3, p.z - p.nz * 3), ctx.heightAt(p.x - p.nx * 7, p.z - p.nz * 7));
        const lo = Math.min(ctx.heightAt(p.x + p.nx * 3, p.z + p.nz * 3), ctx.heightAt(p.x + p.nx * 7, p.z + p.nz * 7));
        const t = Math.max(hi + 0.4, lo + 3);
        top.push(t); bot.push(Math.min(lo, t - 3) - 0.8);
      }
      // smooth the rim a little
      for (let k = 1; k < S.length - 1; k++) top[k] = (top[k - 1] + 2 * top[k] + top[k + 1]) / 4;
      const ROWS = 7;
      const Pc = new Array(S.length * (ROWS + 1)); // (each grid point is shared by four quads)
      const P = (i, r) => Pc[i * (ROWS + 1) + r] || (Pc[i * (ROWS + 1) + r] = P0(i, r));
      const P0 = (i, r) => {
        const p = S[i], v = r / ROWS;
        const y = bot[i] + (top[i] - bot[i]) * v;
        const taper = Math.min(1, i, S.length - 1 - i); // ends pull back into the slope
        const jag = (noise(p.s * 0.35, y * 0.45) * 0.9 + noise(p.s * 1.3 + 7, y * 1.7) * 0.35 + Math.round(noise(p.s * 0.2, y * 0.25) * 2) * 0.35)
          * (0.4 + 0.6 * Math.sin(v * Math.PI)) * (taper ? 1 : 0.3);
        const lean = -(y - bot[i]) * 0.22; // the face leans back towards the high side
        const off = (lean + jag) * (taper ? 1 : 0.6) + 0.3;
        return [p.x + p.nx * off, y, p.z + p.nz * off];
      };
      for (let i = 0; i < S.length - 1; i++) {
        for (let r = 0; r < ROWS; r++) {
          const a = P(i, r), b = P(i + 1, r), c2 = P(i + 1, r + 1), d = P(i, r + 1);
          const e = [S[i].nx, 0.15, S[i].nz];
          buf.quad(a, b, c2, d, [S[i].s, a[1]], [S[i + 1].s, b[1]], [S[i + 1].s, c2[1]], [S[i].s, d[1]], e);
        }
        // rim lip back into the high ground
        const r0 = P(i, ROWS), r1 = P(i + 1, ROWS);
        const k0 = [S[i].x - S[i].nx * 3.5, ctx.heightAt(S[i].x - S[i].nx * 3.5, S[i].z - S[i].nz * 3.5) - 0.1, S[i].z - S[i].nz * 3.5];
        const k1 = [S[i + 1].x - S[i + 1].nx * 3.5, ctx.heightAt(S[i + 1].x - S[i + 1].nx * 3.5, S[i + 1].z - S[i + 1].nz * 3.5) - 0.1, S[i + 1].z - S[i + 1].nz * 3.5];
        buf.quad(r0, r1, k1, k0, [S[i].s, 0], [S[i + 1].s, 0], [S[i + 1].s, 3.5], [S[i].s, 3.5], [0, 1, 0]);
        // talus apron in front of the foot
        const f0 = P(i, 1), f1 = P(i + 1, 1);
        const t0 = [S[i].x + S[i].nx * 3.2, ctx.heightAt(S[i].x + S[i].nx * 3.2, S[i].z + S[i].nz * 3.2) - 0.05, S[i].z + S[i].nz * 3.2];
        const t1 = [S[i + 1].x + S[i + 1].nx * 3.2, ctx.heightAt(S[i + 1].x + S[i + 1].nx * 3.2, S[i + 1].z + S[i + 1].nz * 3.2) - 0.05, S[i + 1].z + S[i + 1].nz * 3.2];
        talus.quad(f0, f1, t1, t0, [S[i].s, 0], [S[i + 1].s, 0], [S[i + 1].s, 3], [S[i].s, 3], [S[i].nx, 1, S[i].nz]);
      }
    }
  }
  const mat = new THREE.MeshStandardMaterial({ map: rockTexture(ctx), roughness: 0.95 });
  mat.name = 'cliff-rock';
  const talusMat = new THREE.MeshStandardMaterial({ map: mat.map, color: '#8a8272', roughness: 1 });
  talusMat.name = 'cliff-talus';
  const group = new THREE.Group();
  group.name = 'cliffs';
  if (!buf.empty) {
    const m = new THREE.Mesh(buf.geometry(), mat);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  if (!talus.empty) {
    const t = new THREE.Mesh(talus.geometry(), talusMat);
    t.receiveShadow = true;
    group.add(t);
  }
  ctx.scene.add(group);
  return { cliffs: n };
}

// ---------------------------------------------------------------------------------------------------------------
// Near-camera detail geometry (marking decals, curbs) in 200 m tiles, one merged mesh per tile and material. The
// tiles are built lazily: at init the source features are only bucketed per tile; a tile's mesh is built the
// first time the camera comes within its reach (+ a 100 m margin) — nearest first, within a small per-frame time
// budget — and only tiles within the marking range are drawn. (Building all of them up front cost 1.5–2 s of
// init at low-end CPU speeds for a 2 × 1.8 km map, most of which a session never sees.) The ground shader fades
// the far level's painted markings in over the last 100 m of that range (terrain.js MARK_RANGE). Car park stall
// lines are found per lot when its first tile is built (ground-painter lotStalls).
const TILE = 200;

function createLazyTiles(ctx, name, { build, placeholder, range }) {
  const tiles = new Map();
  const group = new THREE.Group();
  group.name = name;
  // never drawn: lets engine.precompile() compile the tile material's program before the first frame
  if (placeholder) { placeholder.visible = false; placeholder.name = `${name}-placeholder`; group.add(placeholder); }
  ctx.scene.add(group);
  const budget = ctx.quality?.level === 'low' ? 3 : 6; // ms of tile building per frame (at least one tile)
  const hAt = ctx.terrain?.meshHeightAt || ctx.heightAt;
  const R = TILE * 0.72 + range; // tile centre → farthest corner + range
  const stats = { tiles: 0, built: 0, buildMs: 0 };
  let lx = Infinity, lz = Infinity, ly = Infinity, pending = true;
  const api = {
    group, stats,
    // bucket a feature into every tile its bounding box touches
    add(x0, z0, x1, z1, item) {
      for (let i = Math.floor(x0 / TILE); i <= Math.floor(x1 / TILE); i++) {
        for (let j = Math.floor(z0 / TILE); j <= Math.floor(z1 / TILE); j++) {
          const key = `${i},${j}`;
          let t = tiles.get(key);
          if (!t) { t = { i, j, cx: (i + 0.5) * TILE, cz: (j + 0.5) * TILE, items: [], mesh: null, built: false }; tiles.set(key, t); stats.tiles++; }
          t.items.push(item);
        }
      }
    },
    // (x, z) inside tile t — each piece of geometry belongs to exactly one tile
    owns: (t, x, z) => Math.floor(x / TILE) === t.i && Math.floor(z / TILE) === t.j,
  };
  const buildTile = (t) => {
    const t0 = performance.now();
    let m = null;
    try { m = build(t); } catch (e) { console.warn(`[roads] ${name} tile ${t.i},${t.j} failed`, e); }
    t.items = null;
    t.built = true;
    stats.built++;
    stats.buildMs += performance.now() - t0;
    if (!m) return;
    m.matrixAutoUpdate = false;
    m.updateMatrixWorld(true);
    m.name = `${name}-${t.i},${t.j}`;
    group.add(m);
    t.mesh = m;
  };
  ctx.onUpdate(() => {
    const cam = ctx.camera;
    if (!cam) return;
    const p = cam.position;
    const moved = Math.abs(p.x - lx) + Math.abs(p.z - lz) + Math.abs(p.y - ly) >= 6;
    if (!moved && !pending) return;
    lx = p.x; lz = p.z; ly = p.y;
    // high aerial views: the painted far level carries the markings
    const high = Math.max(0, p.y - hAt(p.x, p.z)) > range + 20;
    const todo = [];
    for (const t of tiles.values()) {
      const d = Math.hypot(t.cx - p.x, t.cz - p.z);
      if (!t.built) { if (!high && d < R + 100) todo.push([d, t]); continue; }
      if (t.mesh) t.mesh.visible = !high && d < R;
    }
    pending = false;
    if (!todo.length) return;
    todo.sort((a, b) => a[0] - b[0]);
    const t0 = performance.now();
    let k = 0;
    while (k < todo.length && (k === 0 || performance.now() - t0 < budget)) {
      const [d, t] = todo[k++];
      buildTile(t);
      if (t.mesh) t.mesh.visible = d < R;
    }
    pending = k < todo.length;
  }, 20);
  return api;
}

// Crisp road / field markings near the camera: the same lines that are painted into the far level's markings
// texture, rebuilt as thin geometry draped on the exact terrain mesh surface (vertex-coloured, one mesh per tile).
function createMarkingDecals(ctx) {
  const P = ctx.terrain?.groundData || prepareGround(ctx);
  const marks = computeMarkings(P);
  const hAt = ctx.terrain?.meshHeightAt || ctx.heightAt;
  const LIFT = 0.035;
  const cols = { white: new THREE.Color('#e7e5dd'), yellow: new THREE.Color('#d7a42a'), dark: new THREE.Color('#1c1c1c') };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  mat.name = 'road-marking-decals';
  // decals lie flat on the ground: constant up normal in the shader instead of a per-vertex attribute
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(1.0, 0.0, 0.0);\n#endif');
  };
  mat.customProgramCacheKey = () => 'cmu-marking-decal-v2';
  const meshOf = (pos, col, idx) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(col), 3, true));
    const nv = pos.length / 3;
    g.setIndex(new THREE.BufferAttribute(nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  };
  let quads = 0;
  const set = createLazyTiles(ctx, 'road-markings', {
    range: markRange(ctx),
    placeholder: meshOf([0, -1e4, 0, 0, -1e4, 0, 0, -1e4, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0], [0, 1, 2]),
    build(t) {
      const out = { pos: [], col: [], idx: [] };
      const items = [];
      for (const it of t.items) {
        if (it.lot) items.push(...lotStalls(P, it.lot)); // (a car park's stall lines, found on first use)
        else items.push(it);
      }
      for (const m of items) {
        const c = cols[m.color] || cols.white;
        if (!m.dash) { strip(t, out, m.pts, m.w, c, m.alpha); continue; }
        const L = polyLength(m.pts), [on, off] = m.dash;
        for (let s = 0; s < L; s += on + off) {
          const seg = slicePolyline(m.pts, s, Math.min(L, s + on));
          if (seg.length > 1) strip(t, out, seg, m.w, c, m.alpha);
        }
      }
      return out.pos.length ? meshOf(out.pos, out.col, out.idx) : null;
    },
  });
  // Densify each segment to ≤ 1 m pieces but keep the original vertices (sharp corners of digits / boxes stay
  // sharp); lateral normals are mitred at vertices (clamped) and wrap around on closed rings. Only the pieces
  // whose centre lies in tile t are emitted (4 vertices + 6 indices per quad, 8-bit colour, no normals).
  function strip(t, out, pts, w, c, a) {
    const S = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-4) continue;
      const n = Math.max(1, Math.ceil(L / 1.0));
      for (let k = 0; k < n; k++) S.push({ x: ax + ((bx - ax) * k) / n, z: az + ((bz - az) * k) / n, tx: (bx - ax) / L, tz: (bz - az) / L });
    }
    if (!S.length) return;
    const last = pts[pts.length - 1];
    S.push({ x: last[0], z: last[1], tx: S[S.length - 1].tx, tz: S[S.length - 1].tz });
    const closed = Math.hypot(pts[0][0] - last[0], pts[0][1] - last[1]) < 0.01;
    const N = S.map((p, i) => {
      const prev = i > 0 ? S[i - 1] : closed ? S[S.length - 2] : null;
      let tx = p.tx, tz = p.tz;
      if (prev) { tx += prev.tx; tz += prev.tz; }
      const l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      const k = 1 / Math.max(0.6, tx * p.tx + tz * p.tz); // miter length
      return [-tz * k, tx * k];
    });
    if (closed) N[N.length - 1] = N[0];
    const lat = Math.max(1, Math.ceil(w / 1.0));
    const col = c.clone().multiplyScalar(0.92 + 0.08 * a); // linear; flat colours survive 8 bits fine
    const cr8 = Math.round(col.r * 255), cg8 = Math.round(col.g * 255), cb8 = Math.round(col.b * 255);
    const V = (s, nx, nz, o) => { const x = s.x + nx * o, z = s.z + nz * o; return [x, hAt(x, z) + LIFT, z]; };
    for (let i = 0; i < S.length - 1; i++) {
      const p = S[i], q = S[i + 1];
      if (!set.owns(t, (p.x + q.x) / 2, (p.z + q.z) / 2)) continue;
      const [nx0, nz0] = N[i], [nx1, nz1] = N[i + 1];
      for (let k = 0; k < lat; k++) {
        const o0 = -w / 2 + (w * k) / lat, o1 = -w / 2 + (w * (k + 1)) / lat;
        const A = V(p, nx0, nz0, o0), B = V(p, nx0, nz0, o1), C = V(q, nx1, nz1, o1), D = V(q, nx1, nz1, o0);
        const v0 = out.pos.length / 3;
        for (const v of [A, B, C, D]) { out.pos.push(v[0], v[1], v[2]); out.col.push(cr8, cg8, cb8); }
        // up-facing winding
        const cr = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
        if (cr > 0) out.idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
        else out.idx.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
        quads++;
      }
    }
  }
  for (const m of marks) {
    const b = m._bb;
    if (b) set.add(b[0], b[1], b[2], b[3], m);
  }
  for (const lot of parkingLots(P)) {
    const b = lot._bb;
    set.add(b[0], b[1], b[2], b[3], { lot });
  }
  return { tiles: set.stats.tiles, marks: marks.length, lazy: true, get quads() { return quads; }, get built() { return set.stats.built; }, get buildMs() { return Math.round(set.stats.buildMs); } };
}

// Concrete curbs along streets: a 14 cm face towards the road, a 28 cm top and a sloped back that meets the
// painted sidewalk / verge. Interrupted wherever the curb would sit on another carriageway (junctions,
// driveways, slip lanes), which falls out of the carriageway distance field — no topology needed.
const CURB_TYPES = new Set(['trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'residential', 'unclassified']);
function createCurbs(ctx) {
  const P = ctx.terrain?.groundData || prepareGround(ctx);
  const hAt = ctx.terrain?.meshHeightAt || ctx.heightAt;
  const hf = ctx.heightfield;
  const inGrid = (x, z) => x > hf.minX + 2 && x < hf.maxX - 2 && z > hf.minZ + 2 && z < hf.maxZ - 2;
  // profile: [lateral offset beyond the carriageway edge, height above the local ground]
  const PROF = [[-0.02, -0.08], [0.0, 0.14], [0.28, 0.14], [0.62, -0.03]];
  const OUT = [[-1, 0.15], [0, 1], [1, 1.2]]; // expected outward direction of each face (lateral sign, up)
  const mat = new THREE.MeshStandardMaterial({ map: ctx.materials.surfaceTexture('concrete', '#b3aea4', 1.5, 9), roughness: 0.88 });
  mat.name = 'curb';
  const meshOf = (g) => {
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.castShadow = false;
    return m;
  };
  const ph = new GeoBuf();
  ph.quad([0, -1e4, 0], [0.01, -1e4, 0], [0.01, -1e4, 0.01], [0, -1e4, 0.01], [0, 0], [1, 0], [1, 1], [0, 1], [0, 1, 0]);
  // per road, once (a road spans several tiles): samples with smoothed tangents + where each side may have a curb
  const prepared = new Map();
  const prep = (r) => {
    let c = prepared.get(r);
    if (c) return c;
    const S = resamplePolyline(r.points, 2.5);
    for (let i = 1; i < S.length - 1; i++) {
      const tx = S[i + 1].x - S[i - 1].x, tz = S[i + 1].z - S[i - 1].z;
      const l = Math.hypot(tx, tz) || 1;
      S[i].tx = tx / l; S[i].tz = tz / l;
    }
    const e0 = r._w / 2;
    // may the curb exist at this sample? (inside the terrain grid and not on another road's surface)
    const ok = [-1, 1].map((sgn) => S.map((p) => {
      const nx = -p.tz * sgn, nz = p.tx * sgn;
      const x = p.x + nx * (e0 + 0.15), z = p.z + nz * (e0 + 0.15);
      return inGrid(x, z) && P.carriagewayDist(x, z, r) > 0.35 && P.carriagewayDist(p.x + nx * (e0 + 0.6), p.z + nz * (e0 + 0.6), r) > 0.1;
    }));
    prepared.set(r, (c = { S, ok, e0 }));
    return c;
  };
  let segs = 0;
  const set = createLazyTiles(ctx, 'curbs', {
    range: markRange(ctx),
    placeholder: meshOf(ph.geometry()),
    build(t) {
      const buf = new GeoBuf();
      for (const r of t.items) {
        const { S, ok, e0 } = prep(r);
        if (S.length < 2) continue;
        [-1, 1].forEach((sgn, si) => {
          const pt = (s, k) => {
            const nx = -s.tz * sgn, nz = s.tx * sgn, o = e0 + PROF[k][0];
            const x = s.x + nx * o, z = s.z + nz * o;
            return [x, hAt(x, z) + PROF[k][1], z];
          };
          for (let i = 0; i < S.length - 1; i++) {
            if (!ok[si][i] || !ok[si][i + 1]) continue;
            const p = S[i], q = S[i + 1];
            if (!set.owns(t, (p.x + q.x) / 2, (p.z + q.z) / 2)) continue;
            const nx = -(p.tz + q.tz) * 0.5 * sgn, nz = (p.tx + q.tx) * 0.5 * sgn;
            for (let k = 0; k < 3; k++) {
              const a0 = pt(p, k), b0 = pt(p, k + 1), a1 = pt(q, k), b1 = pt(q, k + 1);
              const e = [nx * OUT[k][0], OUT[k][1], nz * OUT[k][0]];
              buf.quad(a0, a1, b1, b0, [p.s, k * 0.3], [q.s, k * 0.3], [q.s, k * 0.3 + 0.3], [p.s, k * 0.3 + 0.3], e);
            }
            segs++;
          }
        });
      }
      return buf.empty ? null : meshOf(buf.geometry());
    },
  });
  let roads = 0;
  for (const r of P.roads) {
    if (!CURB_TYPES.has(r.type) || r._brick || r._w < 4 || r.points.length < 2) continue;
    const b = r._bb;
    set.add(b[0], b[1], b[2], b[3], r);
    roads++;
  }
  return { tiles: set.stats.tiles, roads, lazy: true, get segments() { return segs; }, get built() { return set.stats.built; }, get buildMs() { return Math.round(set.stats.buildMs); } };
}

// ---------------------------------------------------------------------------------------------------------------
// Field art of Gesling Stadium as crisp decals (the ground texture's 0.2 m texels made the lettering blocky):
// "TARTANS" in both end zones, reading across the field, and the red midfield disc with "CMU". One small mesh
// with a 2048 × 1024 canvas texture (≈ 2 cm per pixel), always drawn.
function createFieldArt(ctx) {
  const P = ctx.terrain?.groundData || prepareGround(ctx);
  const field = P.areas.find((e) => e.gesling && e.a.sport === 'american_football' && e.frame);
  if (!field) return { fieldArt: 0 };
  const { frame } = field;
  let ang = frame.angle;
  while (ang > Math.PI / 2) ang -= Math.PI;
  while (ang <= -Math.PI / 2) ang += Math.PI;
  const ca = Math.cos(ang), sa = Math.sin(ang), [fcx, fcz] = frame.center;
  const toWorld = (u, v) => [fcx + u * ca - v * sa, fcz + u * sa + v * ca]; // same frame as the painter's inFrame
  const L = frame.length, Wd = frame.width, yd = L / 120;
  // canvas: rows 0–511 the word (40 × 10 m box), rows 512–1023 the disc (10 × 10 m box at the left)
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 1024;
  const g = c.getContext('2d');
  const TW = 40, TH = 10; // metres covered by the word box
  g.clearRect(0, 0, 2048, 1024);
  g.save();
  g.scale(2048 / TW, 512 / TH);
  g.fillStyle = '#f2efe6';
  g.font = `bold ${(5.2 * yd).toFixed(2)}px Georgia, serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('TARTANS', TW / 2, TH / 2);
  g.restore();
  g.save();
  g.translate(0, 512);
  g.scale(512 / 10, 512 / 10);
  g.fillStyle = '#b01e2e';
  g.beginPath(); g.arc(5, 5, 4.2, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#f2efe6';
  g.font = 'bold 3.2px Georgia, serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('CMU', 5, 5.1);
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, ctx.renderer?.capabilities?.getMaxAnisotropy?.() ?? 8);
  const hAt = ctx.terrain?.meshHeightAt || ctx.heightAt;
  const pos = [], uv = [], idx = [];
  // a draped grid: text-local (tx along the word, ty down the canvas) → frame (u, v) → world
  const quad = (u0, v0, rot, w, h, s0, t0, s1, t1, nx, nz) => {
    const cr = Math.cos(rot), sr = Math.sin(rot), base = pos.length / 3;
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const tx = (i / nx - 0.5) * w, ty = (j / nz - 0.5) * h;
      const [x, z] = toWorld(u0 + tx * cr - ty * sr, v0 + tx * sr + ty * cr);
      pos.push(x, hAt(x, z) + 0.045, z); // (above the line decals: the midfield disc covers the 50-yard line)
      uv.push(s0 + (s1 - s0) * (i / nx), t0 + (t1 - t0) * (j / nz));
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = base + j * (nx + 1) + i, b = a + 1, d = a + nx + 1, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  };
  for (const sgn of [-1, 1]) quad(sgn * (L / 2 - 5 * yd), 0, sgn * Math.PI / 2, TW, TH, 0, 0, 1, 0.5, 20, 5);
  quad(0, 0, Math.PI, 10, 10, 0, 0.5, 0.25, 1, 5, 5); // (reads upright from the home grandstand on the north side)
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  // faces up whatever the frame's handedness
  geo.computeVertexNormals();
  if (geo.attributes.normal.getY(0) < 0) {
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    geo.setIndex(idx);
    geo.computeVertexNormals();
  }
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.8, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  mat.name = 'field-art';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'gesling-field-art';
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.matrixAutoUpdate = false;
  ctx.scene.add(mesh);
  return { fieldArt: 1 };
}
