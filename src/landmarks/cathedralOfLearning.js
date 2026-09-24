// Cathedral of Learning (University of Pittsburgh, Charles Klauder, 1926-37) and Heinz Memorial Chapel
// (Klauder, 1933-38). Both are Pitt buildings just west of CMU; they dominate the skyline seen from the Mall.
//
// Cathedral: 42-storey Late Gothic Revival tower in Indiana limestone, 163 m. Modelled from the OSM outline
// (w30678664 = whole building, w841117946 = 4-storey base part, whose notch traces the tower plan):
//   * a 16 m, four-storey podium with Tudor-Gothic windows, buttresses, arcaded parapet and pinnacles;
//   * a stepped-cross tower rising sheer from the lawn on its north-east face (the Commons Room storey with
//     its tall lancets), wrapped in continuous vertical piers with recessed window strips;
//   * setbacks near the top: a crown storey of tall pointed openings, a lantern and corner pinnacles.
// Chapel: French Gothic nave with a steep slate roof, buttresses with pinnacles, tall stained-glass lancets,
// transept gables with the 22 m (73 ft) windows, a three-sided apse and the slender lead-clad fleche (78 m).
// St. Paul Cathedral (Fifth Avenue): see lib/oaklandA-stPaul.js.
import * as THREE from 'three';
import { buildingsByOsmId } from '../core/placement.js';
import {
  Batch, makeFrame, box, placeGeo, pinnacle, pyramidGeo, wallQuad, cap, ensureCCW, cleanRing,
  edgeNormal, pointInPoly, distToRing, gableRoof, applyWorldUV, portal,
} from './lib/oaklandA-kit.js';
import { createOaklandMaterials } from './lib/oaklandA-textures.js';
import { buildStPaul } from './lib/oaklandA-stPaul.js';

const DEG = Math.PI / 180;

// ------------------------------------------------------------------ helpers
// Rectilinear "stepped cross" plan: two arms plus a square core, relative to (0,0). CCW in (u,v).
function crossPlan({ uMin, uMax, vMin, vMax, armU, armV, core }) {
  return cleanRing([
    [uMax, -armV], [uMax, armV], [core, armV], [core, core], [armU, core], [armU, vMax],
    [-armU, vMax], [-armU, core], [-core, core], [-core, armV], [uMin, armV], [uMin, -armV],
    [-core, -armV], [-core, -core], [-armU, -core], [-armU, vMin], [armU, vMin], [armU, -core],
    [core, -core], [core, -armV],
  ]);
}
const offsetRing = (ring, du, dv) => ring.map(([u, v]) => [u + du, v + dv]);

// Sub-intervals [s0,s1] of edge a->b NOT lying along any edge of `other` (collinear overlap removed).
function uncoveredSpans(a, b, other, tol = 0.06) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
  let spans = [[0, L]];
  if (!other) return spans;
  for (let i = 0; i < other.length; i++) {
    const c = other[i], d = other[(i + 1) % other.length];
    // both endpoints on a->b's line?
    const oc = (c[0] - a[0]) * -dz + (c[1] - a[1]) * dx, od = (d[0] - a[0]) * -dz + (d[1] - a[1]) * dx;
    if (Math.abs(oc) > tol || Math.abs(od) > tol) continue;
    let s0 = (c[0] - a[0]) * dx + (c[1] - a[1]) * dz, s1 = (d[0] - a[0]) * dx + (d[1] - a[1]) * dz;
    if (s0 > s1) [s0, s1] = [s1, s0];
    const next = [];
    for (const [p, q] of spans) {
      if (s1 <= p || s0 >= q) { next.push([p, q]); continue; }
      if (s0 > p) next.push([p, s0]);
      if (s1 < q) next.push([s1, q]);
    }
    spans = next.filter(([p, q]) => q - p > 0.05);
  }
  return spans;
}

function isConvex(ring, i) {
  const a = ring[(i + ring.length - 1) % ring.length], b = ring[i], c = ring[(i + 1) % ring.length];
  return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) > 0;
}

// ------------------------------------------------------------------ Cathedral of Learning
const CATH = {
  angle: 46.77 * DEG,         // local u axis points SE (fitted to the OSM outline)
  origin: [-862, -152],
  tc: [3.2, -4.1],            // tower centre in the local frame
  baseH: 16,                  // podium height (OSM part: 15.5 m)
  // setback stages: [y0, y1] above ground and plan (relative to the tower centre)
  stages: [
    { y1: 112, plan: { uMin: -24.3, uMax: 24.35, vMin: -23.6, vMax: 35.0, armU: 8.35, armV: 8.35, core: 13.2 }, wall: 'cathTower', stone: 'cathStone' },
    { y1: 130, plan: { uMin: -21.6, uMax: 21.6, vMin: -21.2, vMax: 21.2, armU: 8.35, armV: 8.35, core: 11.2 }, wall: 'cathTower', stone: 'cathStone' },
    { y1: 145, plan: { uMin: -17.4, uMax: 17.4, vMin: -17.4, vMax: 17.4, armU: 7.2, armV: 7.2, core: 10.2 }, wall: 'cathCrown', stone: 'cathCrownStone' },
    { y1: 152, plan: { uMin: -7.6, uMax: 7.6, vMin: -7.6, vMax: 7.6, armU: 7.6, armV: 7.6, core: 7.6 }, wall: 'cathTower', stone: 'cathCrownStone' },
  ],
};

async function buildCathedral(ctx) {
  const { mats, dims } = createOaklandMaterials(ctx);
  await ctx.yield?.();
  const data = ctx.data;
  const outerRec = buildingsByOsmId(data, 'w30678664')[0];
  const frame = makeFrame(CATH.origin[0], CATH.origin[1], CATH.angle);
  const batch = new Batch();
  const [tcu, tcv] = CATH.tc;
  const [tcx, tcz] = frame.toWorld(tcu, tcv);
  const G = ctx.heightAt(tcx, tcz); // ground floor level (the site is just west of the terrain grid; heightAt clamps)

  // ---- tower stage plans (local frame)
  const stages = CATH.stages.map((s, i) => ({ ...s, y0: i === 0 ? -14 : CATH.stages[i - 1].y1, ring: ensureCCW(offsetRing(crossPlan(s.plan), tcu, tcv)) }));
  const towerRing = stages[0].ring;
  const vNE = tcv + CATH.stages[0].plan.vMin; // the north-east face (sheer to the ground, main entrance)

  // ---- podium outline from OSM (local frame), NE-face points pulled inside the tower so nothing pokes out
  let baseRing = outerRec
    ? outerRec.footprint.map(([x, z]) => frame.toLocal(x, z))
    : offsetRing(crossPlan({ uMin: -35, uMax: 38, vMin: -24, vMax: 45, armU: 30, armV: 25, core: 30 }), tcu, tcv);
  const armLo = tcu - CATH.stages[0].plan.armU, armHi = tcu + CATH.stages[0].plan.armU;
  baseRing = baseRing.map(([u, v]) => (u > armLo + 0.2 && u < armHi - 0.2 && v < vNE + 0.6 ? [u, vNE + 0.6] : [u, v]));
  baseRing = ensureCCW(cleanRing(baseRing, 0.05));
  let groundMin = Infinity;
  for (const [u, v] of baseRing) { const [x, z] = frame.toWorld(u, v); groundMin = Math.min(groundMin, ctx.heightAt(x, z)); }
  const bottom = Math.min(groundMin, G) - 14; // walls reach well below the (clamped) terrain

  const insideTower = (u, v, pad = 0.4) => pointInPoly(u, v, towerRing) || distToRing(u, v, towerRing) < pad;

  // ================================================================ podium
  const baseTop = G + CATH.baseH;
  {
    const BAY = dims.BASE.bay;
    for (let i = 0; i < baseRing.length; i++) {
      const a = baseRing[i], b = baseRing[(i + 1) % baseRing.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const mu = (a[0] + b[0]) / 2, mv = (a[1] + b[1]) / 2;
      if (insideTower(mu, mv, 0.5) && insideTower(a[0], a[1], 0.8) && insideTower(b[0], b[1], 0.8)) continue;
      const n = edgeNormal(a, b);
      if (L >= 2.6) {
        const nb = Math.max(1, Math.round(L / BAY));
        wallQuad(batch, 'cathBase', frame, a, b, bottom, baseTop, { vRef: G, uScale: (nb * BAY) / L });
        // buttresses every two bays (skip the ends: corners get their own)
        for (let k = 2; k < nb; k += 2) {
          const t = (k * L) / nb / L, pu = a[0] + (b[0] - a[0]) * t + n[0] * 0.35, pv = a[1] + (b[1] - a[1]) * t + n[1] * 0.35;
          const rot = Math.atan2(n[0], n[1]);
          box(batch, 'cathStone', frame, pu, (bottom + baseTop + 1.6) / 2, pv, 0.9, baseTop + 1.6 - bottom, 0.7, { rotY: rot });
          box(batch, 'cathStone', frame, pu + n[0] * 0.2, G + 2.4, pv + n[1] * 0.2, 1.1, 4.8, 0.9, { rotY: rot }); // weathered foot
          pinnacle(batch, 'cathStone', frame, pu, baseTop + 1.6, pv, 0.7, 1.0, 2.2, rot);
        }
      } else {
        wallQuad(batch, 'cathStone', frame, a, b, bottom, baseTop, {});
      }
      // arcaded parapet along the edge (except where it abuts the tower)
      const cu = mu - n[0] * 0.22, cv = mv - n[1] * 0.22;
      if (!insideTower(cu, cv, 0.3)) {
        box(batch, 'cathParapet', frame, cu, baseTop + 0.8, cv, L + 0.44, 1.6, 0.44, { rotY: Math.atan2(n[0], n[1]), vRef: baseTop });
      }
    }
    // corner buttress-turrets on convex podium corners
    for (let i = 0; i < baseRing.length; i++) {
      const p = baseRing[i];
      if (!isConvex(baseRing, i) || insideTower(p[0], p[1], 1.0)) continue;
      const a = baseRing[(i + baseRing.length - 1) % baseRing.length], c = baseRing[(i + 1) % baseRing.length];
      if (Math.hypot(p[0] - a[0], p[1] - a[1]) < 1.5 && Math.hypot(p[0] - c[0], p[1] - c[1]) < 1.5) continue;
      const n1 = edgeNormal(a, p), n2 = edgeNormal(p, c);
      const cu = p[0] + (n1[0] + n2[0]) * 0.25, cv = p[1] + (n1[1] + n2[1]) * 0.25;
      const rot = Math.atan2(n1[0], n1[1]);
      box(batch, 'cathStone', frame, cu, (bottom + baseTop + 2.2) / 2, cv, 1.3, baseTop + 2.2 - bottom, 1.3, { rotY: rot });
      pinnacle(batch, 'cathStone', frame, cu, baseTop + 2.2, cv, 1.0, 1.4, 3.4, rot);
    }
    cap(batch, 'roof', frame, baseRing, baseTop - 0.05);
  }

  // ================================================================ tower
  const PIER = { w: 0.95, d: 0.7 }, CORNER = 1.45, PARA = 1.6;
  stages.forEach((st, si) => {
    const ring = st.ring, next = stages[si + 1]?.ring || null;
    const y0 = si === 0 ? bottom : G + st.y0, y1 = G + st.y1;
    const bay = dims.TOWER.bay;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = edgeNormal(a, b), rot = Math.atan2(n[0], n[1]);
      const nb = Math.max(1, Math.round(L / bay)), uScale = (nb * bay) / L;
      // walls: the lowest stage shows the Commons Room lancets below the podium roof line
      if (si === 0) {
        wallQuad(batch, 'cathCommons', frame, a, b, y0, G + 16.5, { vRef: G, uScale });
        wallQuad(batch, 'cathTower', frame, a, b, G + 16.5, y1, { vRef: G, uScale });
      } else {
        wallQuad(batch, st.wall, frame, a, b, y0, y1, { vRef: st.wall === 'cathCrown' ? G + st.y0 : G, uScale });
      }
      const spans = uncoveredSpans(a, b, next);
      const exposedAt = (s) => spans.some(([p, q]) => s >= p - 0.01 && s <= q + 0.01);
      // intermediate piers (bay boundaries)
      for (let k = 1; k < nb; k++) {
        const s = (k * L) / nb, t = s / L;
        const pu = a[0] + (b[0] - a[0]) * t + n[0] * PIER.d / 2, pv = a[1] + (b[1] - a[1]) * t + n[1] * PIER.d / 2;
        const top = exposedAt(s) ? y1 + PARA + 0.3 : y1;
        box(batch, st.stone, frame, pu, (y0 + top) / 2, pv, PIER.w, top - y0, PIER.d, { rotY: rot });
        if (exposedAt(s)) pinnacle(batch, st.stone, frame, pu, top, pv, 0.6, 0.5, si >= 2 ? 1.7 : 1.3, rot);
      }
      // parapet on uncovered spans
      for (const [s0, s1] of spans) {
        const t0 = s0 / L, t1 = s1 / L;
        const cu = a[0] + (b[0] - a[0]) * (t0 + t1) / 2 - n[0] * 0.22, cv = a[1] + (b[1] - a[1]) * (t0 + t1) / 2 - n[1] * 0.22;
        box(batch, 'cathParapet', frame, cu, y1 + PARA / 2, cv, s1 - s0, PARA, 0.44, { rotY: rot, vRef: y1 });
      }
    }
    // corner piers on convex corners (full height of the stage, larger pinnacles)
    for (let i = 0; i < ring.length; i++) {
      if (!isConvex(ring, i)) continue;
      const p = ring[i], a = ring[(i + ring.length - 1) % ring.length], c = ring[(i + 1) % ring.length];
      const n1 = edgeNormal(a, p), n2 = edgeNormal(p, c);
      const cu = p[0] + (n1[0] + n2[0]) * (CORNER / 2 - 0.2), cv = p[1] + (n1[1] + n2[1]) * (CORNER / 2 - 0.2);
      const exposed = !next || !(pointInPoly(p[0] - (n1[0] + n2[0]) * 0.3, p[1] - (n1[1] + n2[1]) * 0.3, next) || distToRing(p[0], p[1], next) < 0.1);
      const top = exposed ? y1 + PARA + 0.8 : y1;
      box(batch, st.stone, frame, cu, (y0 + top) / 2, cv, CORNER, top - y0, CORNER);
      if (exposed) {
        const big = si === stages.length - 1;
        if (big) pinnacle(batch, st.stone, frame, cu, top, cv, 1.3, 2.4, 163 - (st.y1 + PARA + 0.8 + 2.4), 0);
        else pinnacle(batch, st.stone, frame, cu, top, cv, 1.0, 1.0, si >= 1 ? 2.8 : 2.4, 0);
      }
    }
    cap(batch, 'roof', frame, ring, y1 + 0.02);
  });

  // ---- lantern top: a small raised roof block with a lead-capped hip
  {
    const yTop = G + CATH.stages[3].y1;
    box(batch, 'cathCrownStone', frame, tcu, yTop + 1.2, tcv, 6, 2.4, 6);
    placeGeo(batch, 'lead', frame, pyramidGeo(3.2, 2.2), tcu, yTop + 2.4, tcv, 0);
  }

  // ---- entrances
  {
    // NE face: sheer tower face on the lawn -> main portal in its centre (with OSM's projecting porch)
    const nNE = [0, -1];
    const porchD = 2.6, pw = 8.4;
    box(batch, 'cathStone', frame, tcu, (bottom + G + 12.5) / 2, vNE - porchD / 2, pw, G + 12.5 - bottom, porchD);
    for (const s of [-1, 1]) {
      box(batch, 'cathStone', frame, tcu + s * (pw / 2 + 0.2), (bottom + G + 13) / 2, vNE - porchD / 2 - 0.2, 0.9, G + 13 - bottom, porchD + 0.6);
      pinnacle(batch, 'cathStone', frame, tcu + s * (pw / 2 + 0.2), G + 13, vNE - porchD / 2 - 0.2, 0.8, 1.2, 3.0, 0);
    }
    box(batch, 'cathParapet', frame, tcu, G + 12.5 + 0.7, vNE - porchD + 0.2, pw, 1.4, 0.4, { vRef: G + 12.5 });
    portal(batch, frame, { u: tcu, v: vNE - porchD, n: nNE, y0: G, w: 4.2, hs: 6.2, depth: 0.9, gablet: false });
    // NW (Fifth Avenue) and SE (Forbes Avenue) podium entrances: find the podium wall facing each way
    const findWall = (tu, tv, nn) => {
      let best = null, bd = Infinity;
      for (let i = 0; i < baseRing.length; i++) {
        const a = baseRing[i], b = baseRing[(i + 1) % baseRing.length];
        const n = edgeNormal(a, b), L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 7 || n[0] * nn[0] + n[1] * nn[1] < 0.95) continue;
        const ex = (b[0] - a[0]) / L, ez = (b[1] - a[1]) / L;
        let s = (tu - a[0]) * ex + (tv - a[1]) * ez; s = Math.max(3, Math.min(L - 3, s));
        const pu = a[0] + ex * s, pv = a[1] + ez * s, d = Math.hypot(pu - tu, pv - tv);
        if (d < bd) { bd = d; best = { u: pu, v: pv, n }; }
      }
      return best;
    };
    for (const [tu, tv, nn] of [[tcu - 40, tcv + 8, [-1, 0]], [tcu + 40, tcv + 8, [1, 0]], [tcu, tcv + 48, [0, 1]]]) {
      const w = findWall(tu, tv, nn);
      if (w) portal(batch, frame, { u: w.u, v: w.v, n: w.n, y0: G, w: 3.4, hs: 4.6, depth: 1.1 });
    }
  }

  // ---- merge
  const group = batch.build(mats, { noShadow: ['dark'] });
  group.name = 'landmark:cathedralOfLearning';

  // ---- colliders, pick, label
  const worldRing = baseRing.map(([u, v]) => frame.toWorld(u, v));
  ctx.colliders.addPolygon(worldRing, bottom, G + 165, 'cathedralOfLearning');
  const entry = {
    key: 'cathedralOfLearning', kind: 'landmark', infoKey: 'cathedralOfLearning', osmId: 'w30678664',
    name: 'Cathedral of Learning (University of Pittsburgh)', nameZh: '学习大教堂（匹兹堡大学）',
    position: [tcx, G + 80, tcz], radius: 70,
  };
  ctx.pick.add(group, entry);
  ctx.labels.add({ key: 'cathedralOfLearning', text: 'Cathedral of Learning · Pitt', textZh: '学习大教堂 · 匹兹堡大学', kind: 'landmark', priority: 8, position: { x: tcx, y: G + 170, z: tcz }, maxDistance: 5000 });
  group.userData = { key: 'cathedralOfLearning', triangles: batch.tris };
  return group;
}

// ------------------------------------------------------------------ Heinz Memorial Chapel
const CHAPEL = {
  origin: [-753.77, -253.72], angle: -45.1 * DEG, // local +u = along the nave towards the apse (NE), +v = SE
  zc: 3.7, hw: 7.4,           // nave centre line / half width (walls)
  front: -21.0, apse0: 15.0, apse1: 21.3, apseHalf: 3.4,
  tr0: 3.6, tr1: 11.4, trNW: -12.2, trSE: 12.3,
  eave: 17.0, ridge: 30.0, flecheTop: 78.0, // fleche 256 ft (78 m) above the ground, nave 100 ft (30 m)
};

async function buildChapel(ctx) {
  const { mats, dims } = createOaklandMaterials(ctx);
  const C = CHAPEL;
  const frame = makeFrame(C.origin[0], C.origin[1], C.angle);
  const batch = new Batch();
  const rec = buildingsByOsmId(ctx.data, 'w30678681')[0];
  let gmin = Infinity, gmax = -Infinity;
  const probe = rec ? rec.footprint : [C.origin];
  for (const [x, z] of probe) { const h = ctx.heightAt(x, z); gmin = Math.min(gmin, h); gmax = Math.max(gmax, h); }
  const G = gmin + 0.3, bottom = gmin - 3;
  const zc = C.zc, hw = C.hw, E = G + C.eave, RG = G + C.ridge;
  const NAVE = dims.NAVE;

  // wall helper with nave-bay texture fitted to whole bays
  const naveWall = (a, b, y1 = E) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), nb = Math.max(1, Math.round(L / NAVE.bay));
    wallQuad(batch, 'chapelNave', frame, a, b, bottom, y1, { vRef: G, uScale: (nb * NAVE.bay) / L });
    return nb;
  };
  // gable-end wall (rectangle + triangle) with the atlas texture; half = 'front' | 'transept'
  const gableWall = (a, b, apexY, half) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u0 = half === 'front' ? 0 : 0.5, du = 0.5;
    const vOf = (y) => (y - G) / dims.GABLE.h;
    wallQuad(batch, 'chapelGable', frame, a, b, bottom, E, {
      uvFn: () => [u0 + du, vOf(bottom), u0, vOf(bottom), u0, vOf(E), u0 + du, vOf(E)],
    });
    // triangle above the eaves, same plane
    const [nx, nz] = edgeNormal(a, b);
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const g = new THREE.BufferGeometry();
    const P = [[a[0], E, a[1]], [b[0], E, b[1]], [mid[0], apexY, mid[1]]];
    const order = [0, 1, 2];
    const pos = [], uv = [];
    const uvOf = [[u0 + du, vOf(E)], [u0, vOf(E)], [u0 + du / 2, vOf(apexY)]];
    for (const k of order) { pos.push(...P[k]); uv.push(...uvOf[k]); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const nrm = g.attributes.normal;
    if (nrm.getX(0) * nx + nrm.getZ(0) * nz < 0) { // flip to face outwards
      const p = g.attributes.position.array, t = g.attributes.uv.array;
      for (let k = 0; k < 3; k++) { const s = p[3 + k]; p[3 + k] = p[6 + k]; p[6 + k] = s; }
      for (let k = 0; k < 2; k++) { const s = t[2 + k]; t[2 + k] = t[4 + k]; t[4 + k] = s; }
      g.computeVertexNormals();
    }
    g.applyMatrix4(frame.matrix);
    batch.add('chapelGable', g);
    // raking copings
    const rot = Math.atan2(nx, nz);
    const span = L / 2, rise = apexY - E, len = Math.hypot(span, rise), ang = Math.atan2(rise, span);
    for (const s of [-1, 1]) {
      const cg = new THREE.BoxGeometry(len + 0.4, 0.45, 0.7);
      cg.rotateZ(s * ang);
      cg.translate(-s * span / 2, rise / 2, 0.1);
      placeGeo(batch, 'chapelStone', frame, cg, mid[0], E, mid[1], rot, { vRef: G });
    }
    // cross finial at the apex
    box(batch, 'chapelStone', frame, mid[0] + nx * 0.1, apexY + 0.9, mid[1] + nz * 0.1, 0.35, 1.8, 0.35);
    box(batch, 'chapelStone', frame, mid[0] + nx * 0.1, apexY + 1.25, mid[1] + nz * 0.1, nz !== 0 ? 1.1 : 0.35, 0.3, nz !== 0 ? 0.35 : 1.1);
  };
  const buttress = (u, v, n, h1 = 14.5, pinH = 3.0, big = false) => {
    const rot = Math.atan2(n[0], n[1]);
    const d1 = big ? 1.8 : 1.4, w = big ? 1.3 : 1.05;
    box(batch, 'chapelStone', frame, u + n[0] * d1 / 2, (bottom + G + h1) / 2, v + n[1] * d1 / 2, w, G + h1 - bottom, d1, { rotY: rot });
    box(batch, 'chapelStone', frame, u + n[0] * 0.45, G + h1 + (C.eave + 1.2 - h1) / 2, v + n[1] * 0.45, w * 0.8, C.eave + 1.2 - h1, 0.9, { rotY: rot });
    // sloped weathering
    placeGeo(batch, 'chapelStone', frame, pyramidGeo(w * 0.5, 0.8), u + n[0] * (d1 - 0.5), G + h1, v + n[1] * (d1 - 0.5), rot);
    pinnacle(batch, 'chapelStone', frame, u + n[0] * 0.45, E + 1.2, v + n[1] * 0.45, 0.72, 1.6, pinH, rot);
  };

  const nw = zc - hw, se = zc + hw; // nave wall lines (v)
  // ---- nave side walls (split around the transept)
  // (edges run so that the outward normal is on their right: NW walls towards +u, SE walls towards -u)
  const segs = [
    [[C.front, nw], [C.tr0, nw]], [[C.tr1, nw], [C.apse0, nw]],
    [[C.tr0, se], [C.front, se]], [[C.apse0, se], [C.tr1, se]],
  ];
  for (const [a, b] of segs) {
    const nb = naveWall(a, b);
    const n = edgeNormal(a, b), L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let k = 1; k < nb; k++) { const t = k / nb; buttress(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, n); }
  }
  // ---- front (SW) facade with its gable and corner turrets
  gableWall([C.front, se + 0.2], [C.front, nw - 0.2], RG + 0.6, 'front');
  for (const vv of [nw - 0.2, se + 0.2]) {
    // slim octagonal buttress-turrets flanking the west front, set-offs, then a crocketed spirelet
    const tu = C.front + 0.7;
    placeGeo(batch, 'chapelStone', frame, new THREE.CylinderGeometry(1.0, 1.15, G + 18 - bottom, 8), tu, (bottom + G + 18) / 2, vv, Math.PI / 8, { vRef: G });
    placeGeo(batch, 'chapelStone', frame, new THREE.CylinderGeometry(0.85, 1.0, 9.5, 8), tu, G + 22.75, vv, Math.PI / 8, { vRef: G });
    placeGeo(batch, 'chapelStone', frame, new THREE.CylinderGeometry(0.95, 0.95, 0.4, 8), tu, G + 27.6, vv, Math.PI / 8, { vRef: G });
    const sp = new THREE.ConeGeometry(0.85, 6.5, 8, 1, true); sp.translate(0, 3.25, 0);
    placeGeo(batch, 'chapelStone', frame, sp, tu, G + 27.8, vv, Math.PI / 8, { vRef: G });
    for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + Math.PI / 4; pinnacle(batch, 'chapelStone', frame, tu + Math.cos(a) * 0.9, G + 27.8, vv + Math.sin(a) * 0.9, 0.25, 0.5, 1.2); }
  }
  // ---- transepts: gable walls + side walls
  gableWall([C.tr0, C.trNW], [C.tr1, C.trNW], RG, 'transept');
  gableWall([C.tr1, C.trSE], [C.tr0, C.trSE], RG, 'transept');
  naveWall([C.tr0, nw], [C.tr0, C.trNW]); naveWall([C.tr1, C.trNW], [C.tr1, nw]);
  naveWall([C.tr0, C.trSE], [C.tr0, se]); naveWall([C.tr1, se], [C.tr1, C.trSE]);
  for (const [u, v, n] of [[C.tr0, C.trNW, [-0.7, -0.7]], [C.tr1, C.trNW, [0.7, -0.7]], [C.tr0, C.trSE, [-0.7, 0.7]], [C.tr1, C.trSE, [0.7, 0.7]]]) {
    const l = Math.hypot(n[0], n[1]); buttress(u, v, [n[0] / l, n[1] / l], 15.5, 3.6, true);
  }
  // ---- apse (three-sided)
  const apse = [[C.apse0, nw], [C.apse1, zc - C.apseHalf], [C.apse1, zc + C.apseHalf], [C.apse0, se]];
  for (let i = 0; i < 3; i++) naveWall(apse[i], apse[i + 1]);
  for (let i = 1; i < 3; i++) {
    const p = apse[i], n1 = edgeNormal(apse[i - 1], p), n2 = edgeNormal(p, apse[i + 1]);
    const n = [n1[0] + n2[0], n1[1] + n2[1]], l = Math.hypot(n[0], n[1]);
    buttress(p[0], p[1], [n[0] / l, n[1] / l], 14.5, 3.0);
  }
  // ---- eaves parapets
  const para = (a, b) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = edgeNormal(a, b);
    box(batch, 'chapelStone', frame, (a[0] + b[0]) / 2 - n[0] * 0.2, E + 0.55, (a[1] + b[1]) / 2 - n[1] * 0.2, L, 1.1, 0.45,
      { rotY: Math.atan2(b[0] - a[0], b[1] - a[1]) - Math.PI / 2 });
  };
  for (const [a, b] of segs) para(a, b);
  for (let i = 0; i < 3; i++) para(apse[i], apse[i + 1]);
  // ---- roofs (slate)
  gableRoof(batch, 'slate', frame, C.front + 0.3, C.apse0, zc, hw - 0.35, E + 0.85, RG, { overhang: 0 });
  gableRoof(batch, 'slate', frame, -(C.trSE - 0.2), -(C.trNW + 0.2), 0, (C.tr1 - C.tr0) / 2 - 0.35, E + 0.85, RG, { overhang: 0, rotY: Math.PI / 2, cu: (C.tr0 + C.tr1) / 2, cv: 0 });
  {
    // apse half-cone: fan from the ridge end down to the apse eave polygon
    const R = [C.apse0, RG, zc];
    const ring = [[C.apse0, nw + 0.35], [C.apse1 - 0.35, zc - C.apseHalf + 0.15], [C.apse1 - 0.35, zc + C.apseHalf - 0.15], [C.apse0, se - 0.35]];
    const pos = [];
    for (let i = 0; i < 3; i++) {
      const a = ring[i], b = ring[i + 1];
      pos.push(a[0], E + 0.85, a[1], R[0], R[1], R[2], b[0], E + 0.85, b[1]);
    }
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) { // make sure the faces point up/out
      const p = g.attributes.position.array;
      for (let i = 0; i < p.length; i += 9) for (let k = 0; k < 3; k++) { const s = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = s; }
      g.computeVertexNormals();
    }
    g = applyWorldUV(g);
    g.applyMatrix4(frame.matrix);
    batch.add('slate', g);
  }
  // ridge cresting (lead)
  box(batch, 'lead', frame, (C.front + C.apse0) / 2, RG + 0.15, zc, C.apse0 - C.front, 0.3, 0.3);
  // ---- fleche over the crossing (lead-coated copper)
  {
    const fu = (C.tr0 + C.tr1) / 2, fv = zc;
    placeGeo(batch, 'lead', frame, new THREE.CylinderGeometry(2.1, 2.4, 9, 8), fu, RG - 1.5, fv, Math.PI / 8);
    // open belfry stage: eight slim posts + cap ring
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      box(batch, 'lead', frame, fu + Math.cos(a) * 1.75, RG + 6.3, fv + Math.sin(a) * 1.75, 0.35, 6.6, 0.35, { rotY: -a });
      pinnacle(batch, 'lead', frame, fu + Math.cos(a) * 2.05, RG + 9.6, fv + Math.sin(a) * 2.05, 0.3, 0.6, 2.6, -a);
    }
    placeGeo(batch, 'dark', frame, new THREE.CylinderGeometry(1.45, 1.45, 6.6, 8), fu, RG + 6.3, fv, Math.PI / 8, { worldUV: false });
    placeGeo(batch, 'lead', frame, new THREE.CylinderGeometry(2.1, 2.0, 0.8, 8), fu, RG + 10.0, fv, Math.PI / 8);
    // the cross tip sits flecheTop above the lowest ground around the chapel (G is 0.3 m above it)
    const tipY = gmin + C.flecheTop, spH = tipY - 2.3 - (RG + 10.4);
    const sp = new THREE.ConeGeometry(1.9, spH, 8, 1, true);
    sp.translate(0, spH / 2, 0);
    placeGeo(batch, 'lead', frame, sp, fu, RG + 10.4, fv, Math.PI / 8);
    box(batch, 'gold', frame, fu, tipY - 1.1, fv, 0.18, 2.2, 0.18);
    box(batch, 'gold', frame, fu, tipY - 0.8, fv, 0.18, 0.18, 1.0);
  }

  const group = batch.build(mats, { noShadow: ['dark'] });
  group.name = 'landmark:heinzChapel';
  const worldRing = rec ? rec.footprint : [];
  if (worldRing.length) ctx.colliders.addPolygon(worldRing, bottom, G + C.flecheTop, 'heinzChapel');
  const [cx, cz] = frame.toWorld(0, zc);
  ctx.pick.add(group, {
    key: 'heinzChapel', kind: 'landmark', infoKey: 'heinzChapel', osmId: 'w30678681',
    name: 'Heinz Memorial Chapel (University of Pittsburgh)', nameZh: '亨氏纪念礼拜堂（匹兹堡大学）',
    position: [cx, G + 20, cz], radius: 30,
  });
  ctx.labels.add({ key: 'heinzChapel', text: 'Heinz Memorial Chapel · Pitt', textZh: '亨氏纪念礼拜堂 · 匹兹堡大学', kind: 'landmark', priority: 8, position: { x: cx, y: G + C.flecheTop + 4, z: cz }, maxDistance: 2500 });
  group.userData = { key: 'heinzChapel', triangles: batch.tris };
  return group;
}

export default [
  {
    key: 'cathedralOfLearning',
    name: 'Cathedral of Learning', nameZh: '学习大教堂（匹兹堡大学）',
    osmIds: ['w30678664', 'w841117946'],
    skipRoads: [], skipBarriers: [],
    async build(ctx) { return buildCathedral(ctx); },
  },
  {
    key: 'heinzChapel',
    name: 'Heinz Memorial Chapel', nameZh: '亨氏纪念礼拜堂（匹兹堡大学）',
    osmIds: ['w30678681'],
    skipRoads: [], skipBarriers: [],
    async build(ctx) { return buildChapel(ctx); },
  },
  {
    // St. Paul Cathedral (Egan & Prindeville, 1906): twin 247 ft (75 m) spires facing Fifth Avenue
    key: 'stPaulCathedral',
    name: 'St. Paul Cathedral', nameZh: '圣保罗主教座堂',
    osmIds: ['w104431158'],
    skipRoads: [], skipBarriers: [],
    async build(ctx) { return buildStPaul(ctx); },
  },
];
