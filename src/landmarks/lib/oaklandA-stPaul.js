// St. Paul Cathedral (Roman Catholic Diocese of Pittsburgh; Egan & Prindeville of Chicago, 1903-06) on the north
// side of Fifth Avenue at N. Craig Street, across from the Mellon Institute. Gothic Revival in grey-buff limestone,
// modelled on Cologne Cathedral: a five-aisled nave (clerestory vessel + lean-to aisles) under a steep slate roof,
// transepts with rose windows, a polygonal apse, and on the Fifth Avenue front a triple portal and a rose window
// under a gable with the statue of St. Paul, flanked by twin square towers that turn octagonal and end in stone
// spires 247 ft (75 m) above the street - after the Cathedral of Learning, the tallest towers of Oakland's skyline.
// Plan fitted to the OSM outline w104431158 (38 m front, ~68 m deep).
import * as THREE from 'three';
import { buildingsByOsmId } from '../../core/placement.js';
import {
  Batch, makeFrame, box, placeGeo, pinnacle, wallQuad, cap, ensureCCW, edgeNormal, gableRoof, gableTri, leanTo,
  portal, archShapePts, applyWorldUV,
} from './oaklandA-kit.js';
import { createOaklandMaterials } from './oaklandA-textures.js';

const DEG = Math.PI / 180;
// faceted (flat-shaded) copy of an indexed geometry: octagonal stonework should not read as round
const flat = (g) => { const n = g.toNonIndexed(); n.computeVertexNormals(); g.dispose(); return n; };
const SP = {
  // local frame: origin = centre of the Fifth Avenue front, +u = west along the front, +v = north (towards the apse)
  origin: [-572.4, -451.6], angle: (180 - 4.21) * DEG,
  front: 9.1,                    // |u| of the central bay between the towers
  tower: [9.1, 19.1, 11],        // towers: |u| from..to, depth along v
  nave: 7.0, aisle: 16.8,        // clerestory vessel and outer aisle walls (|u|)
  naveEnd: 61, apse: [3.6, 68.2],
  trV: [38, 52], trU: 22.5, chapels: [[32, 38, -1], [52, 58, 1]],
  rear: { u: 18.5, v: [52, 66] },
  // heights above the Fifth Avenue ground
  aisleEave: 13, clerBase: 19, eave: 25, ridge: 35.5, belfry: 25.2,
  towerTop: 40, octTop: 51, tip: 75.3, // 247 ft
};

export async function buildStPaul(ctx) {
  const { mats, dims } = createOaklandMaterials(ctx);
  await ctx.yield?.();
  const frame = makeFrame(SP.origin[0], SP.origin[1], SP.angle);
  const batch = new Batch();
  const rec = buildingsByOsmId(ctx.data, 'w104431158')[0];
  const [fx, fz] = frame.toWorld(0, -1.5);
  const G = ctx.heightAt(fx, fz);
  let gmin = G;
  const probe = rec ? rec.footprint : [[-20, 0], [20, 0], [20, 68], [-20, 68]].map(([u, v]) => frame.toWorld(u, v));
  for (const [x, z] of probe) gmin = Math.min(gmin, ctx.heightAt(x, z));
  const bottom = gmin - 3;
  const Y = (h) => G + h;
  const BAY = dims.SPW.bay;
  const S = 'spStone';

  // ---------------------------------------------------------------- helpers
  const wall = (a, b, y0, y1, key = 'spWall') => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const uScale = key === 'spWall' ? (Math.max(1, Math.round(L / BAY)) * BAY) / L : 1;
    return wallQuad(batch, key, frame, a, b, y0, y1, { vRef: G, uScale });
  };
  const rect = (u0, u1, v0, v1) => ensureCCW([[Math.min(u0, u1), v0], [Math.max(u0, u1), v0], [Math.max(u0, u1), v1], [Math.min(u0, u1), v1]]);
  const faceOf = (n) => (Math.abs(n[0]) > 0.5 ? (n[0] > 0 ? '+u' : '-u') : (n[1] > 0 ? '+v' : '-v'));
  // walls of the chosen faces ('+u' '-u' '+v' '-v') of an axis-aligned block
  const rectWalls = (u0, u1, v0, v1, y0, y1, faces, key = 'spWall') => {
    const ring = rect(u0, u1, v0, v1);
    for (let i = 0; i < 4; i++) {
      const a = ring[i], b = ring[(i + 1) % 4];
      if (faces.includes(faceOf(edgeNormal(a, b)))) wall(a, b, y0, y1, key);
    }
    return ring;
  };
  // horizontal moulding / parapet strip along wall line a->b, pushed `out` metres along its normal n
  const strip = (a, b, n, y0, h, t, out = 0, key = S) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    box(batch, key, frame, (a[0] + b[0]) / 2 + n[0] * out, y0 + h / 2, (a[1] + b[1]) / 2 + n[1] * out, L, h, t,
      { rotY: Math.atan2(-(b[1] - a[1]), b[0] - a[0]), vRef: G });
  };
  // a pointed opening (dark) with a stone hood moulding on a wall plane; (u,v) on the wall, n = outward normal
  const lancet = (u, v, n, y0, w, hs, k = 1, dark = 'dark') => {
    const rot = Math.atan2(n[0], n[1]);
    placeGeo(batch, dark, frame, new THREE.ShapeGeometry(new THREE.Shape(archShapePts(w, hs, k, 6))), u + n[0] * 0.04, y0, v + n[1] * 0.04, rot, { worldUV: false });
    const sh = new THREE.Shape(archShapePts(w + 0.5, hs, k, 6));
    sh.holes.push(new THREE.Path(archShapePts(w, hs, k, 6).reverse()));
    placeGeo(batch, S, frame, new THREE.ExtrudeGeometry(sh, { depth: 0.22, bevelEnabled: false, curveSegments: 4 }), u, y0, v, rot, { vRef: G });
  };
  // rose window (painted glass disc in a moulded ring) centred at (u, y, v) on a wall facing n
  const rose = (u, y, v, n, r) => {
    const rot = Math.atan2(n[0], n[1]);
    const ring = new THREE.Shape(); ring.absarc(0, 0, r + 0.5, 0, Math.PI * 2, false);
    const hole = new THREE.Path(); hole.absarc(0, 0, r, 0, Math.PI * 2, true); ring.holes.push(hole);
    placeGeo(batch, S, frame, new THREE.ExtrudeGeometry(ring, { depth: 0.4, bevelEnabled: false, curveSegments: 14 }), u, y, v, rot, { vRef: G });
    placeGeo(batch, 'spRose', frame, new THREE.CircleGeometry(r + 0.05, 28), u + n[0] * 0.14, y, v + n[1] * 0.14, rot, { worldUV: false });
  };
  // sloped raking copings along a gable whose base runs a->b at y0 up to apexY
  const copings = (a, b, y0, apexY) => {
    const [nx, nz] = edgeNormal(a, b);
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2, rise = apexY - y0;
    const len = Math.hypot(span, rise), ang = Math.atan2(rise, span);
    for (const s of [-1, 1]) {
      const cg = new THREE.BoxGeometry(len + 0.5, 0.5, 0.8);
      cg.rotateZ(s * ang); cg.translate(-s * span / 2, rise / 2, 0.1);
      placeGeo(batch, S, frame, cg, mid[0], y0, mid[1], Math.atan2(nx, nz), { vRef: G });
    }
    return mid;
  };
  const buttress = (u, v, n, h, pin = true, w = 1.0, d = 1.3) => {
    const rot = Math.atan2(n[0], n[1]);
    box(batch, S, frame, u + n[0] * d / 2, (bottom + Y(h - 1.2)) / 2, v + n[1] * d / 2, w, Y(h - 1.2) - bottom, d, { rotY: rot });
    box(batch, S, frame, u + n[0] * 0.4, Y(h + 0.3), v + n[1] * 0.4, w * 0.8, 3.0, 0.8, { rotY: rot, vRef: G });
    if (pin) pinnacle(batch, S, frame, u + n[0] * 0.4, Y(h + 1.8), v + n[1] * 0.4, 0.7, 0.8, 2.6, rot);
  };

  const { nave: NV, aisle: AU, eave: E, ridge: RG } = SP;
  const [tu0, tu1, td] = SP.tower;

  // ================================================================ twin towers and spires
  for (const s of [-1, 1]) {
    const ua = s * tu0, ub = s * tu1, uc = (ua + ub) / 2, vc = td / 2;
    const outer = s > 0 ? '+u' : '-u';
    // lower stage (to the belfry string course): window bays on the outer side and back, plain front
    rectWalls(ua, ub, 0, td, bottom, Y(SP.belfry), [outer, '+v']);
    rectWalls(ua, ub, 0, td, bottom, Y(SP.belfry), ['-v'], S);
    // tall two-light window over the side portal (a one-bay patch of the clerestory lancet)
    wallQuad(batch, 'spWall', frame, [uc - BAY / 2, -0.04], [uc + BAY / 2, -0.04], Y(18.8), Y(SP.belfry), { vRef: G });
    // belfry stage
    const ring = rectWalls(ua, ub, 0, td, Y(SP.belfry), Y(SP.towerTop), ['+u', '-u', '+v', '-v'], S);
    for (let i = 0; i < 4; i++) {
      const a = ring[i], b = ring[(i + 1) % 4], n = edgeNormal(a, b);
      strip(a, b, n, Y(SP.belfry - 0.1), 0.45, 0.5, 0.15);                  // string course
      strip(a, b, n, Y(SP.towerTop), 1.3, 0.45, -0.1);                        // parapet
      // two tall louvred belfry openings per face
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), t = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      const mu = (a[0] + b[0]) / 2, mv = (a[1] + b[1]) / 2;
      for (const k of [-1, 1]) lancet(mu + t[0] * k * 2.2, mv + t[1] * k * 2.2, n, Y(29.2), 1.5, 5.6);
    }
    cap(batch, 'roof', frame, ring, Y(SP.towerTop) + 0.05);
    // stepped clasping buttresses on the corners (the inner rear corner is buried in the nave), pinnacles on top
    for (const [pu, pv] of [[ua, 0], [ub, 0], [ub, td]]) {
      const du = Math.sign(pu - uc), dv = Math.sign(pv - vc);
      const steps = [[bottom, Y(14), 2.2], [Y(14), Y(28), 1.9], [Y(28), Y(SP.towerTop + 0.4), 1.6]];
      for (const [y0, y1, sz] of steps) {
        box(batch, S, frame, pu + du * (sz / 2 - 0.5), (y0 + y1) / 2, pv + dv * (sz / 2 - 0.5), sz, y1 - y0, sz, { vRef: G });
      }
      pinnacle(batch, S, frame, pu + du * 0.3, Y(SP.towerTop + 0.4), pv + dv * 0.3, 1.3, 2.0, 5.6);
    }
    // octagonal belfry lantern
    const Rc = 4.5, ap = Rc * Math.cos(Math.PI / 8), fw = 2 * Rc * Math.sin(Math.PI / 8);
    const octH = SP.octTop - SP.towerTop;
    placeGeo(batch, S, frame, flat(new THREE.CylinderGeometry(Rc, Rc, octH, 8, 1, true)), uc, Y(SP.towerTop + octH / 2), vc, Math.PI / 8, { vRef: G });
    placeGeo(batch, S, frame, flat(new THREE.CylinderGeometry(Rc + 0.35, Rc + 0.35, 0.6, 8)), uc, Y(SP.octTop), vc, Math.PI / 8, { vRef: G });
    for (let k = 0; k < 8; k++) {
      const al = (k * Math.PI) / 4, n = [Math.sin(al), Math.cos(al)];
      lancet(uc + n[0] * ap, vc + n[1] * ap, n, Y(SP.towerTop + 1.8), 1.3, 5.2);
      // gablet (wimperg) over each face at the foot of the spire
      const tri = new THREE.Shape([new THREE.Vector2(-fw / 2, 0), new THREE.Vector2(fw / 2, 0), new THREE.Vector2(0, 2.8)]);
      placeGeo(batch, S, frame, new THREE.ExtrudeGeometry(tri, { depth: 0.35, bevelEnabled: false }), uc + n[0] * (ap - 0.2), Y(SP.octTop + 0.3), vc + n[1] * (ap - 0.2), al, { vRef: G });
      // pinnacles on the octagon's corners
      const ac = al + Math.PI / 8;
      pinnacle(batch, S, frame, uc + Math.sin(ac) * Rc, Y(SP.octTop + 0.3), vc + Math.cos(ac) * Rc, 0.55, 1.4, 3.4, ac);
    }
    // stone spire with two collars, knob and cross (tip at 75 m)
    const sp0 = SP.octTop + 0.3, sp1 = SP.tip - 2.0, spR = Rc - 0.15;
    const cone = flat(new THREE.ConeGeometry(spR, sp1 - sp0, 8, 1, true).translate(0, (sp1 - sp0) / 2, 0));
    placeGeo(batch, S, frame, cone, uc, Y(sp0), vc, Math.PI / 8, { vRef: G });
    for (const t of [0.33, 0.62]) {
      const r0 = spR * (1 - t) + 0.14, r1 = spR * (1 - t - 0.02) + 0.14;
      placeGeo(batch, S, frame, flat(new THREE.CylinderGeometry(r1, r0, 0.45, 8, 1, true)), uc, Y(sp0 + (sp1 - sp0) * t), vc, Math.PI / 8, { vRef: G });
    }
    box(batch, S, frame, uc, Y(sp1 - 0.1), vc, 0.55, 0.7, 0.55);
    box(batch, 'gold', frame, uc, Y(sp1 + 0.25 + (SP.tip - sp1 - 0.25) / 2), vc, 0.16, SP.tip - sp1 - 0.25, 0.16);
    box(batch, 'gold', frame, uc, Y(SP.tip - 0.45), vc, 0.9, 0.16, 0.16);
  }

  // ================================================================ Fifth Avenue front: central bay
  const F = SP.front;
  wall([-F, 0], [F, 0], bottom, Y(E), S);
  gableTri(batch, S, frame, [-F, 0], [F, 0], Y(E), Y(RG + 0.4), { vRef: G });
  const gm = copings([-F, 0], [F, 0], Y(E), Y(RG + 0.4));
  // statue of St. Paul on the gable
  box(batch, S, frame, gm[0], Y(RG + 1.1), gm[1] - 0.1, 1.3, 1.2, 1.3);
  placeGeo(batch, S, frame, new THREE.CylinderGeometry(0.34, 0.55, 2.6, 8), gm[0], Y(RG + 3.0), gm[1] - 0.1, 0, { vRef: G });
  placeGeo(batch, S, frame, new THREE.SphereGeometry(0.28, 8, 6), gm[0], Y(RG + 4.55), gm[1] - 0.1, 0, { vRef: G });
  cap(batch, 'roof', frame, rect(-F, F, 0, td), Y(E));
  wall([F, td], [NV, td], Y(12.8), Y(E), S);
  wall([-NV, td], [-F, td], Y(12.8), Y(E), S);
  // triple portal: the great central door and one at the foot of each tower
  portal(batch, frame, { u: 0, v: 0, n: [0, -1], y0: G, w: 4.6, hs: 6.2, depth: 1.6, stone: S, dark: 'dark', gablet: true });
  for (const s of [-1, 1]) portal(batch, frame, { u: s * (tu0 + tu1) / 2, v: 0, n: [0, -1], y0: G, w: 3.2, hs: 4.8, depth: 1.2, stone: S, dark: 'dark', gablet: true });
  strip([-F, 0], [F, 0], [0, -1], Y(16.6), 0.35, 0.45, 0.2);
  strip([-F, 0], [F, 0], [0, -1], Y(E - 0.2), 0.45, 0.5, 0.2);
  // pointed-arch frame enclosing the great rose window
  {
    const sh = new THREE.Shape(archShapePts(9.7, 2.0, 1, 10));
    sh.holes.push(new THREE.Path(archShapePts(9.0, 2.0, 1, 10).reverse()));
    placeGeo(batch, S, frame, new THREE.ExtrudeGeometry(sh, { depth: 0.35, bevelEnabled: false, curveSegments: 6 }), 0, Y(16.95), 0, Math.PI, { vRef: G });
    rose(0, Y(21.6), 0, [0, -1], 3.3);
  }
  // landing in front of the portals (hides the street's slope)
  box(batch, S, frame, 0, (bottom + Y(0.1)) / 2, -1.9, 2 * (tu1 + 2.2), Y(0.1) - bottom, 3.8);

  // ================================================================ nave: clerestory, aisles, lean-to roofs
  for (const s of [-1, 1]) {
    const inner = s * NV, outer = s * AU;
    // clerestory walls (their lower part hides under the aisle roofs)
    for (const [v0, v1] of [[td, SP.trV[0]], [SP.trV[1], SP.naveEnd]]) {
      const a = s > 0 ? [inner, v0] : [inner, v1], b = s > 0 ? [inner, v1] : [inner, v0];
      wall(a, b, Y(12.8), Y(E));
      strip(a, b, edgeNormal(a, b), Y(E - 0.15), 0.5, 0.5, 0.1);
    }
    // outer aisle wall with buttresses and pinnacles
    const v0 = td, v1 = SP.chapels[0][0];
    const a = s > 0 ? [outer, v0] : [outer, v1], b = s > 0 ? [outer, v1] : [outer, v0];
    wall(a, b, bottom, Y(SP.aisleEave));
    const n = edgeNormal(a, b);
    strip(a, b, n, Y(SP.aisleEave - 0.1), 0.7, 0.45, 0.05);
    const nb = Math.max(1, Math.round((v1 - v0) / BAY));
    for (let k = 1; k < nb; k++) buttress(outer, v0 + ((v1 - v0) * k) / nb, n, SP.aisleEave);
    leanTo(batch, 'slate', frame, td, SP.trV[0], inner, Y(SP.clerBase), outer, Y(SP.aisleEave + 0.2));
  }
  // nave roof (steep slate gable) with lead cresting
  gableRoof(batch, 'slate', frame, -SP.naveEnd, -0.3, 0, NV, Y(E), Y(RG), { overhang: 0.45, rotY: Math.PI / 2 });
  box(batch, 'lead', frame, 0, Y(RG) + 0.12, (0.3 + SP.naveEnd) / 2, 0.32, 0.3, SP.naveEnd - 0.3);

  // ================================================================ transepts
  const [t0, t1] = SP.trV, TU = SP.trU, tc = (t0 + t1) / 2;
  for (const s of [-1, 1]) {
    const face = s > 0 ? '+u' : '-u';
    const ring = rectWalls(-TU, TU, t0, t1, bottom, Y(E), [face]);
    // gable with a rose window
    const i = ring.findIndex((p, j) => faceOf(edgeNormal(p, ring[(j + 1) % 4])) === face);
    const a = ring[i], b = ring[(i + 1) % 4], n = edgeNormal(a, b);
    gableTri(batch, S, frame, a, b, Y(E), Y(RG + 0.4), { vRef: G });
    copings(a, b, Y(E), Y(RG + 0.4));
    strip(a, b, n, Y(E - 0.2), 0.45, 0.5, 0.2);
    rose(s * TU, Y(28.7), tc, n, 2.0);
    // corner buttresses of the transept front
    for (const vv of [t0 + 0.6, t1 - 0.6]) buttress(s * TU, vv, [s, 0], 19, true, 1.3, 1.5);
    // clerestory side walls above the aisles / chapels
    for (const [vv, nn] of [[t0, -1], [t1, 1]]) {
      const p = [s * NV, vv], q = [s * TU, vv];
      const [aa, bb] = (nn < 0) === (s > 0) ? [p, q] : [q, p]; // outward normal = nn along v
      wall(aa, bb, Y(12.8), Y(E));
      strip(aa, bb, [0, nn], Y(E - 0.15), 0.5, 0.5, 0.1);
    }
    // low chapels in the transept aisles
    for (const [c0, c1, side] of SP.chapels) {
      const cr = rectWalls(s * AU, s * TU, c0, c1, bottom, Y(SP.aisleEave), [face, side < 0 ? '-v' : '+v']);
      cap(batch, 'roof', frame, cr, Y(SP.aisleEave) + 0.05);
      for (let j = 0; j < 4; j++) {
        const p = cr[j], q = cr[(j + 1) % 4], f = faceOf(edgeNormal(p, q));
        if (f === face || f === (side < 0 ? '-v' : '+v')) strip(p, q, edgeNormal(p, q), Y(SP.aisleEave - 0.1), 1.0, 0.4, -0.1);
      }
    }
  }
  gableRoof(batch, 'slate', frame, -TU - 0.2, TU + 0.2, tc, (t1 - t0) / 2, Y(E), Y(RG), { overhang: 0.45 });
  box(batch, 'lead', frame, 0, Y(RG) + 0.12, tc, 2 * TU, 0.3, 0.32);

  // ================================================================ choir, apse and the low sacristies around it
  const [aw, av] = SP.apse, ve = SP.naveEnd;
  const apse = [[NV, ve], [aw, av], [-aw, av], [-NV, ve]];
  for (let i = 0; i < 3; i++) wall(apse[i], apse[i + 1], bottom, Y(E));
  for (let i = 0; i < 3; i++) strip(apse[i], apse[i + 1], edgeNormal(apse[i], apse[i + 1]), Y(E - 0.15), 0.5, 0.5, 0.1);
  for (let i = 1; i < 3; i++) {
    const n1 = edgeNormal(apse[i - 1], apse[i]), n2 = edgeNormal(apse[i], apse[i + 1]);
    const nn = [n1[0] + n2[0], n1[1] + n2[1]], l = Math.hypot(nn[0], nn[1]);
    buttress(apse[i][0], apse[i][1], [nn[0] / l, nn[1] / l], 20, true, 1.1, 1.5);
  }
  {
    // apse roof: a half-cone fanned from the ridge end down to the eave polygon
    const R = [0, Y(RG), ve];
    const ring = [[NV + 0.4, ve], [aw + 0.25, av + 0.45], [-aw - 0.25, av + 0.45], [-NV - 0.4, ve]];
    const pos = [];
    for (let i = 0; i < 3; i++) {
      const a = ring[i], b = ring[i + 1];
      pos.push(a[0], Y(E) - 0.3, a[1], R[0], R[1], R[2], b[0], Y(E) - 0.3, b[1]);
    }
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) {
      const p = g.attributes.position.array;
      for (let i = 0; i < p.length; i += 9) for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; }
      g.computeVertexNormals();
    }
    g = applyWorldUV(g);
    g.applyMatrix4(frame.matrix);
    batch.add('slate', g);
  }
  for (const s of [-1, 1]) {
    const [r0, r1] = SP.rear.v, ru = s * SP.rear.u;
    const face = s > 0 ? '+u' : '-u';
    const cr = rectWalls(s * NV, ru, r0, r1, bottom, Y(SP.aisleEave), [face, '+v']);
    // inner face where the apse recedes
    wall(s > 0 ? [NV, r1] : [-NV, ve], s > 0 ? [NV, ve] : [-NV, r1], bottom, Y(SP.aisleEave));
    cap(batch, 'roof', frame, cr, Y(SP.aisleEave) + 0.09); // just above the overlapping transept-chapel roof
    for (let j = 0; j < 4; j++) {
      const p = cr[j], q = cr[(j + 1) % 4], f = faceOf(edgeNormal(p, q));
      if (f === face || f === '+v') strip(p, q, edgeNormal(p, q), Y(SP.aisleEave - 0.1), 1.0, 0.4, -0.1);
    }
  }

  // ================================================================ assemble
  const group = batch.build(mats, { noShadow: ['dark', 'spRose', 'gold', 'roof'] });
  group.name = 'landmark:stPaulCathedral';
  const worldRing = rec ? rec.footprint : rect(-tu1, tu1, 0, av).map(([u, v]) => frame.toWorld(u, v));
  ctx.colliders.addPolygon(worldRing, bottom, Y(SP.towerTop), 'stPaulCathedral');
  // portals and clasping buttresses stand ~1.7 m proud of the OSM front line
  ctx.colliders.addPolygon(rect(-tu1 - 1.7, tu1 + 1.7, -1.8, 0.5).map(([u, v]) => frame.toWorld(u, v)), bottom, Y(16), 'stPaulCathedral');
  const [cx, cz] = frame.toWorld(0, 30);
  ctx.pick.add(group, {
    key: 'stPaulCathedral', kind: 'landmark', infoKey: 'w104431158', osmId: 'w104431158',
    name: 'St. Paul Cathedral', nameZh: '圣保罗主教座堂', position: [cx, Y(30), cz], radius: 45,
  });
  const [lx, lz] = frame.toWorld(0, td / 2);
  ctx.labels.add({ key: 'stPaulCathedral', text: 'St. Paul Cathedral', textZh: '圣保罗主教座堂', kind: 'landmark', priority: 8, position: { x: lx, y: Y(SP.tip + 5), z: lz }, maxDistance: 2600 });
  group.userData = { key: 'stPaulCathedral', triangles: batch.tris };
  return group;
}
