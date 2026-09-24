// Railway through Junction Hollow (CSX / Allegheny Valley "P&W Subdivision") plus the disused spur:
// ballast bed on a smoothed grade, instanced sleepers, two steel rails, and a stone portal where the line
// dives into the Schenley Tunnel under Oakland. Disused track is rusty, overgrown and gappy; abandoned
// (lifted) track is not drawn. Also the NS Pittsburgh Line (double track) through Bloomfield / East Liberty:
// ~13.5 km of track, so the swept ballast / rails are thinned to where the line bends (simplify3), and rails +
// sleepers come in ~160 m pieces drawn only within a few hundred metres of the camera.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { resamplePolyline, polyLength, mulberry, RAIL_GONE } from './ground-painter.js';
import { GeoBuf, sweepSeg, simplify3 } from './bridges.js';
import { RAIL_OUT } from './terrain.js';

const GAUGE = 1.435;

function gravelTexture(ctx, base, seed) {
  const S = 256, c = ctx.materials.makeCanvas(S, S), g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, S, S);
  const r = mulberry(seed);
  for (let i = 0; i < 5200; i++) {
    const v = 70 + ((r() * 120) | 0), rad = 0.8 + r() * 2.2;
    g.fillStyle = `rgba(${v},${v - 4},${v - 10},${0.5 + r() * 0.5})`;
    g.beginPath(); g.ellipse(r() * S, r() * S, rad * 1.3, rad, r() * 3, 0, Math.PI * 2); g.fill();
  }
  return ctx.materials.canvasTexture(c, { repeatW: 2.5, repeatH: 2.5 });
}

// Join railway ways that share endpoints so the grade smoothing is continuous.
function chains(ways) {
  const key = (p) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;
  const out = [], used = new Set();
  const byEnd = new Map();
  for (const w of ways) for (const p of [w.points[0], w.points[w.points.length - 1]]) {
    const k = key(p); if (!byEnd.has(k)) byEnd.set(k, []); byEnd.get(k).push(w);
  }
  for (const w of ways) {
    if (used.has(w)) continue;
    used.add(w);
    let pts = w.points.slice();
    for (let dir = 0; dir < 2; dir++) {
      for (;;) {
        const end = dir === 0 ? pts[pts.length - 1] : pts[0];
        const cand = (byEnd.get(key(end)) || []).filter((o) => !used.has(o) && o.rusty === w.rusty);
        if (!cand.length) break;
        const o = cand[0];
        used.add(o);
        const op = o.points.slice();
        if (dir === 0) { if (key(op[0]) !== key(end)) op.reverse(); pts = pts.concat(op.slice(1)); }
        else { if (key(op[op.length - 1]) !== key(end)) op.reverse(); pts = op.slice(0, -1).concat(pts); }
      }
    }
    out.push({ rusty: w.rusty, points: pts });
  }
  return out;
}

// Clip a polyline to a rectangle (keeps the longest inside run).
function clipToRect(pts, x0, z0, x1, z1) {
  const inside = (p) => p[0] >= x0 && p[0] <= x1 && p[1] >= z0 && p[1] <= z1;
  const runs = [];
  let cur = [];
  const S = resamplePolyline(pts, 3);
  for (const p of S) {
    const q = [p.x, p.z];
    if (inside(q)) cur.push(q); else if (cur.length) { runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  return runs.filter((r) => r.length > 2);
}

export function createRail(ctx) {
  const T0 = performance.now();
  const data = ctx.data;
  const hf = ctx.heightfield;
  const group = new THREE.Group();
  group.name = 'railways';
  // railway=abandoned (razed, dismantled) means the rails were lifted: in Junction Hollow the old spur now runs
  // across a parking lot and through buildings, so it is not drawn at all. disused track is still in place.
  const ways = (data.railways || []).filter((r) => !r.tunnel && r.points.length > 1 && !RAIL_GONE.has(r.type)).map((r) => ({ ...r, rusty: r.type !== 'rail' }));
  if (!ways.length) return { group };
  const M = ctx.materials;
  const gravel = gravelTexture(ctx, '#6d675e', 3);
  const ballastMat = new THREE.MeshStandardMaterial({ map: gravel, roughness: 1 });
  ballastMat.name = 'ballast';
  // (same gravel, tinted browner and duller for the disused track: one texture to paint instead of two)
  const oldBallastMat = new THREE.MeshStandardMaterial({ map: gravel, roughness: 1, color: '#a89d79' });
  oldBallastMat.name = 'ballast-old';
  const railMat = M.color('#6e6862', { roughness: 0.38, metalness: 0.75 });
  const rustMat = M.color('#6a4632', { roughness: 0.75, metalness: 0.35 });
  const tieMat = M.color('#4a3d31', { roughness: 0.95 });

  const buf = { ballast: new GeoBuf(), oldBallast: new GeoBuf(), rail: new GeoBuf(), rust: new GeoBuf() };
  const ties = [];
  const rnd = mulberry(99);
  let portal = null;
  let nRun = 0;
  // Lines that leave the data go on over the terrain skirt for RAIL_OUT m (on its rendered surface; the 3D
  // surroundings keep clear of them) instead of stopping dead at the data edge.
  const surfAt = ctx.terrain?.meshHeightAt;
  const out = surfAt ? RAIL_OUT : -2;
  const inGrid = (x, z) => x >= hf.minX && x <= hf.maxX && z >= hf.minZ && z <= hf.maxZ;
  const groundAt = (x, z) => (inGrid(x, z) || !surfAt ? ctx.heightAt(x, z) : surfAt(x, z));
  for (const ch of chains(ways)) {
    for (const run of clipToRect(ch.points, hf.minX - out, hf.minZ - out, hf.maxX + out, hf.maxZ + out)) {
      nRun++;
      const S = resamplePolyline(run, 2).map((p) => ({ ...p, nx: -p.tz, nz: p.tx }));
      for (let i = 1; i < S.length - 1; i++) {
        let tx = S[i + 1].x - S[i - 1].x, tz = S[i + 1].z - S[i - 1].z;
        const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        S[i].tx = tx; S[i].tz = tz; S[i].nx = -tz; S[i].nz = tx;
      }
      // smoothed grade: moving average (±24 m) of the terrain, never more than 0.4 m below it
      const g = S.map((p) => groundAt(p.x, p.z));
      const W = 12;
      const y = g.map((_, i) => {
        let s = 0, n = 0;
        for (let k = Math.max(0, i - W); k <= Math.min(g.length - 1, i + W); k++) { s += g[k]; n++; }
        return s / n;
      });
      for (let i = 0; i < y.length; i++) y[i] = Math.max(y[i], g[i] - 0.4) + 0.35;
      // the swept geometry (ballast, rails) only needs samples where the line bends or the grade changes: the
      // 2 m samples are thinned to a tolerance of a few centimetres (13.5 km of track since the map reaches East
      // Liberty — ~420k triangles at 2 m)
      const keep = simplify3(S, y, 0.035, 18);
      const K = keep.map((i) => S[i]), yK = keep.map((i) => y[i]);
      const yOf = (i) => yK[i];
      const bb = ch.rusty ? buf.oldBallast : buf.ballast;
      // ballast: trapezoid, top 3.2 m wide at rail base, toe 5 m wide at -1.2
      sweepSeg(bb, K, yOf, [-1.6, 0], [1.6, 0], [0, 1]);
      sweepSeg(bb, K, yOf, [1.6, 0], [2.6, -1.3], [1, 1]);
      sweepSeg(bb, K, yOf, [-1.6, 0], [-2.6, -1.3], [-1, 1]);
      // rails (simple I-rail: head + web) on the sleepers
      const rb = ch.rusty ? buf.rust : buf.rail;
      for (const sgn of [-1, 1]) {
        const o = sgn * GAUGE / 2;
        const top = 0.16 + 0.15;
        sweepSeg(rb, K, yOf, [o - 0.036, top], [o + 0.036, top], [0, 1]);
        sweepSeg(rb, K, yOf, [o + 0.036, top], [o + 0.036, top - 0.045], [1, 0]);
        sweepSeg(rb, K, yOf, [o - 0.036, top], [o - 0.036, top - 0.045], [-1, 0]);
        sweepSeg(rb, K, yOf, [o + 0.012, top - 0.045], [o + 0.012, 0.16], [1, 0]);
        sweepSeg(rb, K, yOf, [o - 0.012, top - 0.045], [o - 0.012, 0.16], [-1, 0]);
      }
      // sleepers every 0.6 m
      const L = S[S.length - 1].s;
      let k = 0;
      for (let s = 0.3; s < L; s += 0.6) {
        while (k < S.length - 2 && S[k + 1].s < s) k++;
        const p = S[k], q = S[k + 1], t = (s - p.s) / Math.max(1e-6, q.s - p.s);
        if (ch.rusty && rnd() < 0.18) continue; // missing / rotted sleepers
        ties.push({
          x: p.x + (q.x - p.x) * t, y: y[k] + (y[k + 1] - y[k]) * t + 0.08, z: p.z + (q.z - p.z) * t, chunk: nRun * 1000 + Math.floor(s / 160),
          a: Math.atan2(p.tz, p.tx) + (ch.rusty ? (rnd() - 0.5) * 0.12 : 0), rusty: ch.rusty,
        });
      }
      // portal where the active line enters the Schenley Tunnel (the tunnel way starts at the run's north end)
      if (!ch.rusty) {
        for (const tw of data.railways.filter((r) => r.tunnel)) {
          for (const end of [tw.points[0], tw.points[tw.points.length - 1]]) {
            for (const [i, dir] of [[0, -1], [S.length - 1, 1]]) {
              if (Math.hypot(S[i].x - end[0], S[i].z - end[1]) < 6) portal = { x: S[i].x, z: S[i].z, y: y[i], tx: S[i].tx * dir, tz: S[i].tz * dir };
            }
          }
        }
      }
    }
  }
  // Rails + sleepers are sub-pixel beyond a few hundred metres (the ballast bed carries the line): the rails are
  // split into ~160 m pieces like the sleepers, and each piece is drawn only within RANGE of the camera.
  const fine = [];
  for (const [k, b] of Object.entries(buf)) {
    if (b.empty) continue;
    const mat = { ballast: ballastMat, oldBallast: oldBallastMat, rail: railMat, rust: rustMat }[k];
    const g = b.geometry();
    const pieces = k === 'rail' || k === 'rust' ? splitByCell(g, 160) : [g];
    for (const geo of pieces) {
      const m = new THREE.Mesh(geo, mat);
      m.name = 'rail-' + k;
      m.receiveShadow = true;
      m.castShadow = k === 'rail' || k === 'rust';
      m.matrixAutoUpdate = false;
      group.add(m);
      if (pieces.length > 1 || k === 'rail' || k === 'rust') fine.push(m);
    }
  }
  // instanced sleepers, one mesh per ~160 m of track
  if (ties.length) {
    const geo = sleeperGeometry(2.6, 0.16, 0.24);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const byChunk = new Map();
    for (const t of ties) { let l = byChunk.get(t.chunk); if (!l) byChunk.set(t.chunk, (l = [])); l.push(t); }
    for (const list of byChunk.values()) {
      const inst = new THREE.InstancedMesh(geo, tieMat, list.length);
      list.forEach((t, i) => {
        // box length runs across the track: rotate so local X = lateral normal
        q.setFromAxisAngle(up, -(t.a + Math.PI / 2));
        m4.compose(pos.set(t.x, t.y, t.z), q, sc);
        inst.setMatrixAt(i, m4);
        col.set(t.rusty ? '#8a8078' : '#ffffff').multiplyScalar(0.85 + rnd() * 0.3);
        inst.setColorAt(i, col);
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.receiveShadow = true;
      inst.castShadow = false;
      inst.name = 'rail-sleepers';
      inst.matrixAutoUpdate = false;
      inst.computeBoundingSphere();
      group.add(inst);
      fine.push(inst);
    }
  }
  if (fine.length) {
    const RANGE = ctx.quality?.level === 'low' ? 220 : 380;
    for (const m of fine) {
      const bs = m.isInstancedMesh ? m.boundingSphere : (m.geometry.boundingSphere || (m.geometry.computeBoundingSphere(), m.geometry.boundingSphere));
      m.userData.cull = { c: bs.center.clone(), r: bs.radius };
    }
    let lx = Infinity, ly = Infinity, lz = Infinity;
    ctx.onUpdate(() => {
      const p = ctx.camera?.position;
      if (!p || Math.abs(p.x - lx) + Math.abs(p.y - ly) + Math.abs(p.z - lz) < 5) return;
      lx = p.x; ly = p.y; lz = p.z;
      for (const m of fine) { const c = m.userData.cull; m.visible = c.c.distanceTo(p) - c.r < RANGE; }
    }, 20);
  }
  if (portal) group.add(tunnelPortal(ctx, portal));
  ctx.scene.add(group);
  return { group, stats: { sleepers: ties.length, ms: Math.round(performance.now() - T0) } };
}

// Split a non-indexed triangle geometry into pieces by the cell (cell × cell metres) of each triangle's first vertex.
function splitByCell(g, cell) {
  const P = g.attributes.position.array, N = g.attributes.normal.array, U = g.attributes.uv.array;
  const parts = new Map();
  for (let t = 0; t < P.length / 9; t++) {
    const k = Math.floor(P[t * 9] / cell) * 100003 + Math.floor(P[t * 9 + 2] / cell);
    let l = parts.get(k);
    if (!l) parts.set(k, (l = []));
    l.push(t);
  }
  const out = [];
  for (const tris of parts.values()) {
    const p = new Float32Array(tris.length * 9), n = new Float32Array(tris.length * 9), u = new Float32Array(tris.length * 6);
    tris.forEach((t, i) => { p.set(P.subarray(t * 9, t * 9 + 9), i * 9); n.set(N.subarray(t * 9, t * 9 + 9), i * 9); u.set(U.subarray(t * 6, t * 6 + 6), i * 6); });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(u, 2));
    geo.computeBoundingSphere();
    out.push(geo);
  }
  return out;
}

// A sleeper: a box without its (never seen) bottom face — 10 triangles.
function sleeperGeometry(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const idx = g.index.array, keep = [];
  // BoxGeometry faces: +x, -x, +y, -y, +z, -z (6 indices each); drop -y
  for (let i = 0; i < idx.length; i += 6) if (i !== 18) for (let k = 0; k < 6; k++) keep.push(idx[i + k]);
  g.setIndex(keep);
  g.clearGroups();
  return g;
}

// Stone tunnel portal: a masonry headwall with a round-arched opening and a dark bore behind it.
function tunnelPortal(ctx, p) {
  const Wd = 11, Ht = 9, archR = 3.1, archSpring = 4.6, depth = 2;
  const shape = new THREE.Shape();
  shape.moveTo(-Wd / 2, -2); shape.lineTo(Wd / 2, -2); shape.lineTo(Wd / 2, Ht); shape.lineTo(-Wd / 2, Ht); shape.lineTo(-Wd / 2, -2);
  const hole = new THREE.Path();
  hole.moveTo(-archR, 0); hole.lineTo(-archR, archSpring); hole.absarc(0, archSpring, archR, Math.PI, 0, true); hole.lineTo(archR, 0); hole.lineTo(-archR, 0);
  shape.holes.push(hole);
  const wall = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  // coping stones
  const cap = new THREE.BoxGeometry(Wd + 0.6, 0.5, depth + 0.4);
  cap.translate(0, Ht + 0.25, depth / 2);
  const bore = new THREE.CylinderGeometry(archR, archR, 14, 20, 1, true);
  bore.rotateX(Math.PI / 2);
  bore.translate(0, archSpring, depth + 7);
  const boreWalls = new THREE.BoxGeometry(archR * 2, archSpring, 14);
  boreWalls.translate(0, archSpring / 2, depth + 7);
  const back = new THREE.PlaneGeometry(archR * 2, archSpring + archR);
  back.translate(0, (archSpring + archR) / 2, depth + 13.5);
  const g = new THREE.Group();
  const stone = new THREE.Mesh(ctx.materials.applyWorldUV(mergeGeometries([wall.index ? wall.toNonIndexed() : wall, cap.toNonIndexed()])), ctx.materials.get('sandstone'));
  stone.castShadow = stone.receiveShadow = true;
  const dark = new THREE.MeshStandardMaterial({ color: '#0d0c0b', roughness: 1, side: THREE.BackSide });
  const inner = new THREE.Mesh(mergeGeometries([bore.toNonIndexed(), boreWalls.toNonIndexed()]), dark);
  const backM = new THREE.Mesh(back, new THREE.MeshBasicMaterial({ color: '#050505' }));
  g.add(stone, inner, backM);
  // orient: local +Z points into the tunnel (along the track direction beyond the run end)
  g.position.set(p.x, p.y - 0.2, p.z);
  g.rotation.y = Math.atan2(p.tx, p.tz);
  g.name = 'rail-tunnel-portal';
  ctx.colliders.addBox(p.x + p.tx * (depth / 2), p.z + p.tz * (depth / 2), Wd / 2, depth / 2, -Math.atan2(p.tz, p.tx) + Math.PI / 2, p.y - 2, p.y + Ht, 'portal');
  return g;
}

export { polyLength };
