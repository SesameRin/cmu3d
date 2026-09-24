// Mellon Institute (Janssen & Cocken / Benno Janssen, 1931-37; now Carnegie Mellon's Mellon Institute).
// A massive neoclassical limestone block on Fifth Avenue ringed by 62 monolithic Ionic columns - each a single
// ~60 t piece of Indiana limestone about 11 m (36.5 ft) tall and 1.8 m (6 ft) thick at the foot, the largest
// monolithic columns of their day. Modelled on the OSM outline (w25795368 / multipolygon r20147694):
//   * a trapezoidal plan with cut corners; 17 columns on the Fifth Avenue, Bellefield (W) and east fronts and
//     11 on the rear (17 + 17 + 17 + 11 = 62), standing on a stepped stylobate in front of a deep portico;
//   * solid corner piers with antae, a three-fascia Ionic entablature with dentil cornice and a plain attic
//     capped by a copper coping; behind the columns three storeys of aluminium windows with cast spandrels;
//   * two long light courts (the OSM inner rings) each bridged by a low wing with a sedum green roof,
//     plus copper-roofed rooftop penthouses.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildingsByOsmId } from '../core/placement.js';
import {
  Batch, makeFrame, box, placeGeo, wallQuad, cap, bandCap, ensureCCW, insetConvex, edgeNormal, latheGeo,
  prep, pyramidGeo, applyWorldUV,
} from './lib/oaklandA-kit.js';
import { createOaklandMaterials } from './lib/oaklandA-textures.js';

const DEG = Math.PI / 180;
const MI = {
  origin: [-686.5, -345], angle: -12.06 * DEG, // local +u along Fifth Avenue (east), +v towards the rear (south)
  counts: { N: 17, E: 17, S: 11, W: 17 },       // = 62 columns
  colTop: 12.1,           // column height above the stylobate (base + shaft + capital)
  archTop: 13.3, friezeTop: 14.4, cornTop: 15.1, atticTop: 17.1, roof: 16.5, ceiling: 12.9,
  inset: { corn: -0.55, arch: 0.15, frieze: 0.3, attic: 0.35, cope: 0.25, copeIn: 1.1, col: 1.25, archIn: 2.3, wall: 4.6, pod: -0.35 },
  cornerExt: 1.2,         // how far the solid corner piers reach along each front
};

// One Ionic column (unfluted monolithic shaft) around the local origin; base at y=0, local +Z faces outward.
// Two levels of detail share the material: 'near' (~800 triangles: 20-sided lathe with the Attic base mouldings,
// entasis and volute scrolls) and 'far' (~140 triangles: 10-sided shaft, block capital). Previously a single
// 28-sided version cost 62 x 2k = 124k triangles in both the main and the shadow pass from every distance.
const entasis = (t) => 0.9 - 0.13 * Math.pow(Math.max(0, (t - 0.3) / 0.7), 1.5); // straight lower third, then taper
function ionicColumnGeometry(lod = 'near') {
  const parts = [];
  const add = (g) => parts.push(prep(g));
  let g = new THREE.BoxGeometry(2.0, 0.3, 2.0); g.translate(0, 0.15, 0); add(applyWorldUV(g)); // plinth
  const y0 = 0.8, y1 = 11.2;
  if (lod === 'near') {
    // Attic base (torus-scotia-torus), shaft with entasis, astragal, echinus
    const prof = [[0.99, 0.3], [1.0, 0.38], [0.93, 0.47], [0.87, 0.56], [0.94, 0.64], [0.955, 0.7], [0.9, 0.8]];
    for (const t of [0.3, 0.6, 0.85, 1]) prof.push([entasis(t), y0 + t * (y1 - y0)]);
    prof.push([0.8, 11.26], [0.84, 11.33], [0.79, 11.38], [0.9, 11.5], [0.92, 11.58], [0.9, 11.64]);
    add(latheGeo(prof, 20));
    // canalis block between the volutes
    g = new THREE.BoxGeometry(1.86, 0.34, 1.46); g.translate(0, 11.72, 0); add(applyWorldUV(g));
    // volute scrolls: short horizontal cylinders facing front/back, with a raised eye
    for (const s of [-1, 1]) {
      g = new THREE.CylinderGeometry(0.36, 0.36, 1.52, 16); g.rotateX(Math.PI / 2); g.translate(s * 0.9, 11.6, 0); add(applyWorldUV(g));
      g = new THREE.CylinderGeometry(0.2, 0.2, 1.62, 10); g.rotateX(Math.PI / 2); g.translate(s * 0.91, 11.6, 0); add(applyWorldUV(g));
    }
  } else {
    add(latheGeo([[1.0, 0.3], [0.9, 0.8], [entasis(0.3), y0 + 0.3 * (y1 - y0)], [entasis(1), y1], [0.92, 11.55]], 10));
    g = new THREE.BoxGeometry(2.0, 0.62, 1.5); g.translate(0, 11.6, 0); add(applyWorldUV(g)); // volute block
  }
  // abacus
  g = new THREE.BoxGeometry(2.0, 0.21, 2.0); g.translate(0, MI.colTop - 0.105, 0); add(applyWorldUV(g));
  const merged = mergeGeometries(parts, false);
  merged.computeBoundingSphere();
  return merged;
}
const COLUMN_LOD_DISTANCE = 140; // m from the building centre: beyond it a column is < ~12 px wide

// Walls around a ring between two heights with continuous metre-u; optional per-edge filter.
function walls(batch, key, frame, ring, y0, y1, vRef, filter = null) {
  let u = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!filter || filter(i)) wallQuad(batch, key, frame, a, b, y0, y1, { u0: u, vRef });
    u += L;
  }
}

async function buildMellon(ctx) {
  const { mats, dims } = createOaklandMaterials(ctx);
  await ctx.yield?.();
  const frame = makeFrame(MI.origin[0], MI.origin[1], MI.angle);
  const batch = new Batch();
  const I = MI.inset;
  const rec = buildingsByOsmId(ctx.data, 'w25795368')[0];
  const rel = buildingsByOsmId(ctx.data, 'r20147694')[0];
  const worldRing = rec?.footprint || [[-727.1, -377.7], [-656.4, -392.8], [-648.7, -387.5], [-641.9, -314.9], [-646.6, -309.1], [-699.9, -297.1], [-707.3, -302.1], [-731.6, -370.8]];
  const ring = ensureCCW(worldRing.map(([x, z]) => frame.toLocal(x, z)));
  const holes = (rel?.holes || []).map((h) => ensureCCW(h.map(([x, z]) => frame.toLocal(x, z))));
  const parts = ['w1472093013', 'w1472093014'].map((id) => buildingsByOsmId(ctx.data, id)[0]).filter(Boolean)
    .map((b) => ensureCCW(b.footprint.map(([x, z]) => frame.toLocal(x, z))));

  // ---- classify edges: long ones are the four fronts, short ones the cut corners
  const n = ring.length;
  const edges = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]), nn = edgeNormal(a, b);
    let side = null;
    if (L > 20) side = Math.abs(nn[0]) > Math.abs(nn[1]) ? (nn[0] > 0 ? 'E' : 'W') : (nn[1] > 0 ? 'S' : 'N');
    edges.push({ i, a, b, L, n: nn, side });
  }

  // ---- heights: the stylobate sits 1.26 m (three steps) above the highest point of Fifth Avenue's sidewalk
  let gMin = Infinity, gMaxN = -Infinity;
  for (const e of edges) {
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const [x, z] = frame.toWorld(e.a[0] + (e.b[0] - e.a[0]) * t, e.a[1] + (e.b[1] - e.a[1]) * t);
      const h = ctx.heightAt(x, z);
      gMin = Math.min(gMin, h);
      if (e.side === 'N') gMaxN = Math.max(gMaxN, h);
    }
  }
  if (!Number.isFinite(gMaxN)) gMaxN = gMin + 2;
  const Ys = gMaxN + 1.26, bottom = gMin - 4;
  const Y = (h) => Ys + h;

  const P = {};
  for (const [k, d] of Object.entries(I)) P[k] = insetConvex(ring, d);

  // ================================================================ podium, stylobate, steps
  walls(batch, 'mellonStone', frame, P.pod, bottom, Ys, Ys);
  cap(batch, 'mellonFloor', frame, P.pod, Ys);
  const walk = new Batch(); // invisible proxy for walk mode (podium top + steps)
  cap(walk, 'x', frame, P.pod, Ys);
  const north = edges.find((e) => e.side === 'N');
  if (north) {
    const a = P.pod[north.i], b = P.pod[(north.i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const rot = Math.atan2(north.n[0], north.n[1]);
    for (let k = 1; k <= 3; k++) {
      const off = (k - 0.5) * 0.5, top = Ys - k * 0.42;
      const cu = (a[0] + b[0]) / 2 + north.n[0] * off, cv = (a[1] + b[1]) / 2 + north.n[1] * off;
      box(batch, 'mellonStone', frame, cu, (bottom + top) / 2, cv, L + 1.0 * k, top - bottom, 0.5, { rotY: rot });
      box(walk, 'x', frame, cu, top - 0.05, cv, L + 1.0 * k, 0.1, 0.5, { rotY: rot });
    }
  }

  // ================================================================ colonnade
  const colGeo = ionicColumnGeometry();
  const colMatrices = [];
  const colsBySide = {};
  for (const e of edges) {
    if (!e.side) continue;
    const a = P.col[e.i], b = P.col[(e.i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const count = MI.counts[e.side];
    const m = MI.cornerExt + 0.9 + 1.25; // clear of the corner pier
    const step = (L - 2 * m) / (count - 1);
    const rot = Math.atan2(e.n[0], e.n[1]);
    const list = [];
    for (let k = 0; k < count; k++) {
      const s = m + k * step, t = s / L;
      const u = a[0] + (b[0] - a[0]) * t, v = a[1] + (b[1] - a[1]) * t;
      colMatrices.push(frame.place(u, Ys, v, rot, new THREE.Matrix4()));
      list.push([u, v]);
    }
    colsBySide[e.side] = { list, step, first: list[0], rot, e };
  }
  // near / far instanced sets under a THREE.LOD placed at the building centre (children offset back to world space)
  const [lodX, lodZ] = frame.toWorld(0, 0);
  const columns = new THREE.LOD();
  columns.name = 'mellon-columns';
  columns.position.set(lodX, Ys, lodZ);
  for (const [lod, dist] of [[colGeo, 0], [ionicColumnGeometry('far'), COLUMN_LOD_DISTANCE]]) {
    const im = new THREE.InstancedMesh(lod, mats.mellonColumn, colMatrices.length);
    colMatrices.forEach((mtx, k) => im.setMatrixAt(k, mtx));
    im.instanceMatrix.needsUpdate = true;
    im.position.set(-lodX, -Ys, -lodZ);
    im.computeBoundingSphere();
    im.castShadow = im.receiveShadow = true;
    im.name = dist ? 'mellon-columns-far' : 'mellon-columns';
    columns.addLevel(im, dist, 8);
  }

  // ================================================================ walls behind the colonnade (window bays aligned to the columns)
  const BAY = dims.MBAY.bay;
  for (const e of edges) {
    if (!e.side) continue;
    const a = P.wall[e.i], b = P.wall[(e.i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const cs = colsBySide[e.side];
    const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const s0 = (cs.first[0] - a[0]) * dir[0] + (cs.first[1] - a[1]) * dir[1]; // first column projected on the wall
    const uScale = BAY / cs.step;
    wallQuad(batch, 'mellonBay', frame, a, b, Ys - 0.3, Y(MI.ceiling), { vRef: Ys, uScale, u0: -s0 * uScale });
    // main entrance: bronze doors in the two central bays of the Fifth Avenue front
    if (e.side === 'N') {
      const mid = (cs.list.length - 1) / 2;
      for (const k of [mid - 0.5, mid + 0.5]) {
        const s = s0 + k * cs.step, pu = a[0] + dir[0] * s + e.n[0] * 0.12, pv = a[1] + dir[1] * s + e.n[1] * 0.12;
        const rot = Math.atan2(e.n[0], e.n[1]);
        box(batch, 'mellonStone', frame, pu, Ys + 3.3, pv, 2.3, 6.6, 0.22, { rotY: rot, vRef: Ys });
        box(batch, 'bronze', frame, pu + e.n[0] * 0.14, Ys + 2.8, pv + e.n[1] * 0.14, 1.8, 5.6, 0.12, { rotY: rot });
        box(batch, 'darkMetal', frame, pu + e.n[0] * 0.21, Ys + 2.5, pv + e.n[1] * 0.21, 0.05, 4.8, 0.05, { rotY: rot });
        box(batch, 'darkMetal', frame, pu + e.n[0] * 0.21, Ys + 4.6, pv + e.n[1] * 0.21, 1.8, 0.06, 0.05, { rotY: rot });
      }
    }
  }

  // ================================================================ exposed basement storey: windows + rear loading docks
  // The site falls ~3 m from Fifth Avenue to the rear, so the podium becomes a full storey on the south side.
  for (const e of edges) {
    if (!e.side || !colsBySide[e.side]) continue;
    const cs = colsBySide[e.side];
    const a = P.pod[e.i], b = P.pod[(e.i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dir = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], rot = Math.atan2(e.n[0], e.n[1]);
    const s0 = (cs.first[0] - a[0]) * dir[0] + (cs.first[1] - a[1]) * dir[1];
    for (let k = 0; k < cs.list.length - 1; k++) {
      const s = s0 + (k + 0.5) * cs.step;
      const pu = a[0] + dir[0] * s + e.n[0] * 0.03, pv = a[1] + dir[1] * s + e.n[1] * 0.03;
      const [wx, wz] = frame.toWorld(pu, pv);
      const g = ctx.heightAt(wx, wz), h = Ys - g;
      const dock = e.side === 'S' && (k === 2 || k === cs.list.length - 4);
      if (dock && h > 2.6) {
        box(batch, 'darkMetal', frame, pu, g + 1.5, pv, 3.4, 3.0, 0.08, { rotY: rot });
        box(batch, 'mellonStone', frame, pu + e.n[0] * 0.05, g + 3.15, pv + e.n[1] * 0.05, 3.9, 0.3, 0.12, { rotY: rot, vRef: Ys });
      } else if (h > 2.2) {
        const wh = Math.min(1.3, h - 1.3);
        box(batch, 'glassDark', frame, pu, Ys - 0.55 - wh / 2, pv, 1.7, wh, 0.08, { rotY: rot });
      }
    }
  }

  // ================================================================ solid corner piers at the cut corners
  const ext = MI.cornerExt;
  for (const e of edges) {
    if (e.side) continue;
    const i = e.i, j = (i + 1) % n, ip = (i + n - 1) % n, jn = (j + 1) % n;
    const dPrev = [ring[i][0] - ring[ip][0], ring[i][1] - ring[ip][1]], lp = Math.hypot(...dPrev);
    const dNext = [ring[jn][0] - ring[j][0], ring[jn][1] - ring[j][1]], ln = Math.hypot(...dNext);
    dPrev[0] /= lp; dPrev[1] /= lp; dNext[0] /= ln; dNext[1] /= ln;
    const A = [P.arch[i][0] - dPrev[0] * ext, P.arch[i][1] - dPrev[1] * ext], B = P.arch[i], C = P.arch[j];
    const D = [P.arch[j][0] + dNext[0] * ext, P.arch[j][1] + dNext[1] * ext];
    const E = [P.wall[j][0] + dNext[0] * ext, P.wall[j][1] + dNext[1] * ext], F = P.wall[j], Gp = P.wall[i];
    const H = [P.wall[i][0] - dPrev[0] * ext, P.wall[i][1] - dPrev[1] * ext];
    const blk = [A, B, C, D, E, F, Gp, H];
    for (let k = 0; k < blk.length; k++) {
      const top = k <= 2 ? Y(MI.colTop) : Y(MI.ceiling);
      wallQuad(batch, 'mellonStone', frame, blk[k], blk[(k + 1) % blk.length], bottom, top, { vRef: Ys });
    }
    cap(batch, 'mellonStone', frame, blk, Y(MI.ceiling));
    // antae (pilaster strips) at the corner pier's arrises and faces
    for (const [p, q] of [[A, B], [C, D]]) {
      const nn = edgeNormal(p, q), rot = Math.atan2(nn[0], nn[1]);
      box(batch, 'mellonStone', frame, (p[0] + q[0]) / 2 + nn[0] * 0.12, Y(MI.colTop / 2), (p[1] + q[1]) / 2 + nn[1] * 0.12, Math.hypot(q[0] - p[0], q[1] - p[1]) + 0.2, MI.colTop, 0.24, { rotY: rot, vRef: Ys });
    }
    {
      const nn = edgeNormal(B, C), rot = Math.atan2(nn[0], nn[1]);
      const L = Math.hypot(C[0] - B[0], C[1] - B[1]);
      const cu = (B[0] + C[0]) / 2, cv = (B[1] + C[1]) / 2;
      // recessed panel + raised frame on the blank chamfer face
      box(batch, 'mellonStone', frame, cu + nn[0] * 0.08, Y(0.5), cv + nn[1] * 0.08, L + 0.3, 1.0, 0.16, { rotY: rot, vRef: Ys });
      box(batch, 'mellonStone', frame, cu + nn[0] * 0.06, Y(10.6), cv + nn[1] * 0.06, L - 1.4, 0.5, 0.12, { rotY: rot, vRef: Ys });
      box(batch, 'mellonStone', frame, cu + nn[0] * 0.06, Y(1.6), cv + nn[1] * 0.06, L - 1.4, 0.35, 0.12, { rotY: rot, vRef: Ys });
    }
  }

  // ================================================================ entablature, attic, roof
  const eRef = Y(MI.colTop);
  walls(batch, 'mellonEntab', frame, P.arch, Y(MI.colTop), Y(MI.archTop), eRef);
  bandCap(batch, 'mellonStone', frame, P.arch, P.archIn, Y(MI.colTop), true);                // architrave soffit
  walls(batch, 'mellonStone', frame, [...P.archIn].reverse(), Y(MI.colTop), Y(MI.ceiling), Ys); // inner face
  bandCap(batch, 'mellonStone', frame, P.archIn, P.wall, Y(MI.ceiling), true);              // portico ceiling
  // coffer beams across the portico ceiling, one per column
  for (const side of Object.values(colsBySide)) {
    const e = side.e, rot = Math.atan2(e.n[0], e.n[1]);
    for (const [u, v] of side.list) {
      const cu = u - e.n[0] * (I.wall - I.col) / 2, cv = v - e.n[1] * (I.wall - I.col) / 2;
      box(batch, 'mellonStone', frame, cu, Y(MI.ceiling - 0.25), cv, 0.9, 0.5, I.wall - I.col + 0.6, { rotY: rot, vRef: Ys });
    }
  }
  bandCap(batch, 'mellonStone', frame, P.arch, P.frieze, Y(MI.archTop));
  walls(batch, 'mellonEntab', frame, P.frieze, Y(MI.archTop), Y(MI.friezeTop), eRef);
  bandCap(batch, 'mellonStone', frame, P.corn, P.frieze, Y(MI.friezeTop), true);
  walls(batch, 'mellonEntab', frame, P.corn, Y(MI.friezeTop), Y(MI.cornTop), eRef);
  bandCap(batch, 'mellonStone', frame, P.corn, P.attic, Y(MI.cornTop));
  walls(batch, 'mellonStone', frame, P.attic, Y(MI.cornTop), Y(MI.atticTop), Ys);
  // copper-clad coping along the roofline
  walls(batch, 'copper', frame, P.cope, Y(MI.atticTop), Y(MI.atticTop + 0.28), Ys);
  bandCap(batch, 'copper', frame, P.cope, P.copeIn, Y(MI.atticTop + 0.28));
  walls(batch, 'mellonStone', frame, [...P.copeIn].reverse(), Y(MI.roof), Y(MI.atticTop + 0.28), Ys);
  bandCap(batch, 'mellonStone', frame, P.attic, P.cope, Y(MI.atticTop)); // tiny ledge (attic -> coping)
  cap(batch, 'roof', frame, P.copeIn, Y(MI.roof), { holes });

  // ================================================================ light courts with low bridging wings (green roofs)
  const courtMat = ctx.materials.facade({ wall: 'stone', wallColor: '#d6cdb9', style: 'punched', bay: 3.2, floor: 3.9, winW: 1.5, winH: 2.3, sill: 0.9, frame: '#a3a8ab', glass: '#34414a', lit: 0.45, seed: 37 });
  const courtKey = 'court';
  const extraMats = { court: courtMat };
  const courtFloor = Y(1.5);
  for (const h of holes) {
    walls(batch, courtKey, frame, [...h].reverse(), courtFloor, Y(MI.roof), courtFloor);
    cap(batch, 'roof', frame, h, courtFloor);
    // parapet coping around the court edge
    walls(batch, 'mellonStone', frame, [...h].reverse(), Y(MI.roof), Y(MI.roof + 0.6), Ys);
  }
  for (const pr of parts) {
    walls(batch, courtKey, frame, pr, courtFloor, Y(8.2), courtFloor);
    cap(batch, 'sedum', frame, insetConvex(pr, 0.4), Y(8.25));
    walls(batch, 'mellonStone', frame, pr, Y(8.2), Y(8.8), Ys);
    bandCap(batch, 'mellonStone', frame, pr, insetConvex(pr, 0.4), Y(8.8));
    walls(batch, 'mellonStone', frame, [...insetConvex(pr, 0.4)].reverse(), Y(8.2), Y(8.8), Ys);
  }

  // ================================================================ rooftop penthouses with copper roofs
  {
    // centre of the spine between the two courts
    let cu = 0, cv = 0;
    if (holes.length === 2) {
      const c = holes.map((h) => h.reduce((s, p) => [s[0] + p[0] / h.length, s[1] + p[1] / h.length], [0, 0]));
      cu = (c[0][0] + c[1][0]) / 2; cv = (c[0][1] + c[1][1]) / 2;
    }
    const pens = [[cu, cv - 18, 9, 4.2, 7], [cu, cv + 16, 7, 3.4, 6], [cu - 26, cv - 30, 5, 3.0, 5], [cu + 30, cv - 30, 5, 3.0, 5]];
    for (const [u, v, w, h, d] of pens) {
      box(batch, 'mellonStone', frame, u, Y(MI.roof) + h / 2, v, w, h, d, { vRef: Y(MI.roof) });
      const roofG = pyramidGeo(1, 1.4);
      placeGeo(batch, 'copper', frame, roofG, u, Y(MI.roof) + h, v, 0, { scale: new THREE.Vector3(w / 2 + 0.25, 1, d / 2 + 0.25) });
    }
  }

  // ---- assemble
  // small / flush / up-facing pieces add shadow-pass draw calls without changing the shadows
  const group = batch.build({ ...mats, ...extraMats }, { noShadow: ['dark', 'bronze', 'darkMetal', 'glassDark', 'sedum', 'mellonFloor', 'roof'] });
  group.add(columns);
  group.name = 'landmark:mellonInstitute';
  const walkMesh = walk.build({ x: new THREE.MeshBasicMaterial() }, { castShadow: false, receiveShadow: false });
  walkMesh.children.forEach((m) => { m.visible = false; m.updateMatrixWorld(true); ctx.walkables.add(m); });
  walkMesh.visible = false;
  group.add(walkMesh);

  // ---- colliders: columns, walls, corner piers, podium edge
  const W = (r) => r.map(([u, v]) => frame.toWorld(u, v));
  for (const side of Object.values(colsBySide)) for (const [u, v] of side.list) {
    const [x, z] = frame.toWorld(u, v);
    ctx.colliders.addCircle(x, z, 0.98, Ys - 0.3, Y(MI.colTop), 'mellonInstitute');
  }
  ctx.colliders.addPolygon(W(P.wall), bottom, Y(MI.atticTop + 1), 'mellonInstitute');
  ctx.colliders.addPolygon(W(P.pod), bottom, Ys - 0.5, 'mellonInstitute');
  for (const e of edges) {
    if (e.side) continue;
    const i = e.i, j = (i + 1) % n;
    ctx.colliders.addPolygon(W([P.arch[i], P.arch[j], P.wall[j], P.wall[i]]), bottom, Y(MI.colTop), 'mellonInstitute');
  }

  const [cx, cz] = frame.toWorld(0, 0);
  ctx.pick.add(group, {
    key: 'mellonInstitute', kind: 'landmark', infoKey: 'mellonInstitute', osmId: 'w25795368',
    name: 'Mellon Institute', nameZh: '梅隆研究所（卡内基梅隆大学）', position: [cx, Y(10), cz], radius: 50,
  });
  ctx.labels.add({ key: 'mellonInstitute', text: 'Mellon Institute', textZh: '梅隆研究所', kind: 'landmark', priority: 8, position: { x: cx, y: Y(MI.atticTop + 8), z: cz }, maxDistance: 2200 });
  group.userData = { key: 'mellonInstitute', triangles: batch.tris + colGeo.attributes.position.count / 3 * colMatrices.length, columns: colMatrices.length };
  return group;
}

export default [
  {
    key: 'mellonInstitute',
    name: 'Mellon Institute', nameZh: '梅隆研究所',
    // the outer way, the multipolygon with the two light courts, and the two small building:parts inside them
    osmIds: ['w25795368', 'r20147694', 'w1472093013', 'w1472093014'],
    skipRoads: [], skipBarriers: [],
    async build(ctx) { return buildMellon(ctx); },
  },
];
