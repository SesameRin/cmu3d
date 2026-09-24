// Motor Square Garden (built 1898-1900 as the East Liberty Market House; Peabody & Stearns of Boston), 5900 Baum
// Boulevard at South Beatty Street. Now AAA's regional headquarters.
// Read from photographs and aerial imagery (reference only):
//   * an 84 x 51 m block in buff/yellow brick: a two-storey perimeter range under grey shingle roofs, broken on every
//     side by cross-gables - five on each long side, three on each short side - each gable end filled by a tall
//     round-arched window (fan light over sashes, painted oxblood) above a row of ordinary windows;
//   * inside the ring the old market hall is roofed flat with two long glazed monitors, and from the middle rises the
//     famous verdigris dome: an octagonal drum clad in green metal with a dentil cornice, stepped rings, sixteen glazed
//     gores between ribs, a small lantern with scrolls and a ball finial.
// Plan fitted to OSM w34398651 (footprintFrame: long axis ~ north-north-west, Baum Boulevard on the north end).
import * as THREE from 'three';
import { footprintFrame, buildingLevels } from '../../core/placement.js';
import {
  Batch, makeFrame, box, boxY, placeGeo, prismGeo, wallQuad, ringWalls, cap, gableTri, gableRoof, rect, edgeNormal,
  atlasPanel, archFrame, distanceCull,
} from './pennAve-kit.js';
import { getPennMaterials } from './pennAve-materials.js';

export const MSG_OSM = 'w34398651';

export async function buildMSG(ctx) {
  const rec = ctx.data.buildings.find((b) => b.id === MSG_OSM || b.osmId === MSG_OSM);
  if (!rec) { console.warn('[pennAve] Motor Square Garden footprint missing'); return null; }
  const { mats, cells } = getPennMaterials(ctx);
  const low = ctx.quality?.level === 'low';
  await ctx.yield?.();
  const ff = footprintFrame(rec.footprint);
  const frame = makeFrame(ff.center[0], ff.center[1], ff.angle);
  const HL = ff.length / 2, HW = ff.width / 2;
  const lv = buildingLevels(rec);
  const G = rec.ground.max - 0.3, bottom = lv.baseY - 0.5;
  const Y = (h) => G + h;
  const main = new Batch('msg');
  const det = low ? null : new Batch('msg-detail');
  const D = det || { add() {} };
  const wallMat = ctx.materials.facade({ wall: 'brick', wallColor: '#d4b77e', style: 'punched', bay: 3.4, floor: 4.4, winW: 1.7, winH: 2.4, sill: 1.0, frame: '#7d2a20', glass: '#34414a', trim: '#c8b48b', lit: 0.5, seed: 61 });
  const M = { ...mats, wall: wallMat, glassRoof: ctx.materials.get('glass') };

  const EAVE = 9.5, RIDGE = 14.2, DEPTH = 12.5, ATRIUM = 8.6;
  const outer = rect(-HL, HL, -HW, HW);
  const inner = rect(-HL + DEPTH, HL - DEPTH, -HW + DEPTH, HW - DEPTH);
  // ---------------------------------------------------------------- perimeter range
  ringWalls(main, 'wall', frame, outer, bottom, Y(EAVE), { vRef: G });
  ringWalls(main, 'msgBrick', frame, inner.slice().reverse(), Y(ATRIUM - 0.2), Y(EAVE), { vRef: G });   // faces the atrium
  // ring roofs: long sides full length, short sides between them
  for (const s of [-1, 1]) {
    gableRoof(main, 'shingle', frame, -HL, HL, s < 0 ? -HW : HW - DEPTH, s < 0 ? -HW + DEPTH : HW, Y(EAVE), Y(RIDGE), { alongU: true, overhang: 0.5, ends: [true, true], wallKey: 'msgBrick', vRef: G });
    gableRoof(main, 'shingle', frame, s < 0 ? -HL : HL - DEPTH, s < 0 ? -HL + DEPTH : HL, -HW + DEPTH - 2, HW - DEPTH + 2, Y(EAVE), Y(RIDGE), { alongU: false, overhang: 0.5, ends: [false, false] });
  }
  // cross-gables with their great arched windows
  const sides = [
    { a: [-HL, -HW], b: [HL, -HW], n: 5 }, { a: [HL, -HW], b: [HL, HW], n: 3 },
    { a: [HL, HW], b: [-HL, HW], n: 5 }, { a: [-HL, HW], b: [-HL, -HW], n: 3 },
  ];
  for (const { a, b, n } of sides) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), nn = edgeNormal(a, b), t = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const bay = L / n, gw = Math.min(13.5, bay - 3.2), proud = 0.45;
    for (let i = 0; i < n; i++) {
      const c = (i + 0.5) * bay;
      const cu = a[0] + t[0] * c + nn[0] * proud, cv = a[1] + t[1] * c + nn[1] * proud;
      const p0 = [cu - t[0] * gw / 2, cv - t[1] * gw / 2], p1 = [cu + t[0] * gw / 2, cv + t[1] * gw / 2];
      // gable front, its returns, the gable triangle and the pediment coping
      wallQuad(main, 'msgBrick', frame, p0, p1, bottom, Y(EAVE), { vRef: G });
      for (const [q, back] of [[p0, -1], [p1, 1]]) {
        const qb = [q[0] - nn[0] * proud, q[1] - nn[1] * proud];
        if (back < 0) wallQuad(main, 'msgBrick', frame, qb, q, bottom, Y(EAVE), { vRef: G });
        else wallQuad(main, 'msgBrick', frame, q, qb, bottom, Y(EAVE), { vRef: G });
      }
      const apex = EAVE + gw / 2 * ((RIDGE - EAVE) / (DEPTH / 2)) * 0.95;
      gableTri(main, 'msgBrick', frame, p0, p1, Y(EAVE), Y(apex), { vRef: G });
      // cross-gable roof back to the ring ridge
      const inU = [cu - nn[0] * (DEPTH / 2 + proud), cv - nn[1] * (DEPTH / 2 + proud)];
      const ang = Math.atan2(-nn[1], nn[0]);
      const rise = apex - EAVE, half = gw / 2, slope = Math.hypot(half, rise) + 0.5, run = DEPTH / 2 + proud + 0.4;
      for (const sd of [-1, 1]) {
        const g = new THREE.BoxGeometry(run, 0.2, slope);
        g.translate(0, -0.1, sd * slope / 2);
        g.rotateX(sd * Math.atan2(rise, half));
        g.translate(run / 2 - 0.4, 0, 0);
        placeGeo(main, 'shingle', frame, g, inU[0], Y(apex), inU[1], ang);
      }
      // coping and the brick arch round the window, keystone
      for (const sd of [-1, 1]) {
        const cg = new THREE.BoxGeometry(Math.hypot(half, rise) + 0.6, 0.35, 0.6);
        cg.rotateZ(sd * Math.atan2(rise, half)); cg.translate(-sd * half / 2, rise / 2, 0.15);
        placeGeo(D, 'precast', frame, cg, cu, Y(EAVE), cv, Math.atan2(nn[0], nn[1]), { vRef: G });
      }
      const ww = Math.min(7.6, gw - 3.4);
      atlasPanel(main, 'win', frame, cells.msgArch, { u: cu, v: cv, n: nn, y0: Y(4.1), w: ww, hs: 4.2, k: 0.5, out: 0.03 });
      archFrame(D, 'precast', frame, { u: cu, v: cv, n: nn, y0: Y(4.1), w: ww, hs: 4.2, k: 0.5, t: 0.55, d: 0.18, vRef: G });
      // ground floor: three windows under the arch; a belt course at the springing
      for (const k of [-1, 0, 1]) {
        atlasPanel(main, 'win', frame, cells.sash, { u: cu + t[0] * k * 2.6, v: cv + t[1] * k * 2.6, n: nn, y0: Y(0.9), w: 1.6, hs: 2.3, k: 0, out: 0.03 });
      }
      box(D, 'precast', frame, cu + nn[0] * 0.08, Y(3.75), cv + nn[1] * 0.08, gw + 0.3, 0.3, 0.3, { rotY: Math.atan2(-t[1], t[0]), vRef: G });
      box(main, 'precast', frame, cu + nn[0] * 0.1, Y(0.35), cv + nn[1] * 0.1, gw + 0.2, 1.3, 0.3, { rotY: Math.atan2(-t[1], t[0]), vRef: G });
    }
    // eave cornice along the whole side
    box(main, 'precast', frame, (a[0] + b[0]) / 2 + nn[0] * 0.25, Y(EAVE - 0.25), (a[1] + b[1]) / 2 + nn[1] * 0.25, L + 0.5, 0.5, 0.5, { rotY: Math.atan2(-t[1], t[0]), vRef: G });
  }
  // ---------------------------------------------------------------- atrium roof with glazed monitors
  cap(main, 'flatRoof', frame, inner, Y(ATRIUM));
  for (const s of [-1, 1]) for (const ud of [-1, 1]) {
    const u0 = ud < 0 ? -HL + DEPTH + 2 : 9.5, u1 = ud < 0 ? -9.5 : HL - DEPTH - 2;
    const v0 = s * 7.2 - 2.1, v1 = s * 7.2 + 2.1;
    for (const f of rect(u0, u1, v0, v1).map((p, i, r) => [p, r[(i + 1) % 4]])) wallQuad(main, 'msgBrick', frame, f[0], f[1], Y(ATRIUM), Y(ATRIUM + 1.0), { vRef: G });
    gableRoof(main, 'glassRoof', frame, u0, u1, v0, v1, Y(ATRIUM + 1.0), Y(ATRIUM + 2.4), { alongU: true, overhang: 0.15, ends: [true, true], wallKey: 'msgBrick', vRef: G });
  }
  // ---------------------------------------------------------------- the dome
  {
    const DA = 7.4, drumTop = 16.2;
    placeGeo(main, 'verdigris', frame, prismGeo(DA, 0, drumTop - ATRIUM, 8), 0, Y(ATRIUM), 0);
    const ra = DA / Math.cos(Math.PI / 8);
    for (let k = 0; k < 8; k++) {
      const a0 = (k - 0.5) * Math.PI / 4, a1 = (k + 0.5) * Math.PI / 4;
      const pa = [Math.cos(a0) * ra, Math.sin(a0) * ra], pb = [Math.cos(a1) * ra, Math.sin(a1) * ra];
      const nn = edgeNormal(pa, pb), mid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2];
      atlasPanel(main, 'dark', frame, [0, 0, 1, 1], { u: mid[0], v: mid[1], n: nn, y0: Y(ATRIUM + 2.8), w: 2.6, hs: 1.5, k: 0.5, out: 0.03 });
      archFrame(D, 'verdigris', frame, { u: mid[0], v: mid[1], n: nn, y0: Y(ATRIUM + 2.8), w: 2.6, hs: 1.5, k: 0.5, t: 0.3, d: 0.15, vRef: G });
    }
    // dentil cornice and stepped rings (lathe, 8-sided cornice then round steps)
    placeGeo(main, 'verdigris', frame, prismGeo(DA + 0.7, 0, 0.55, 8), 0, Y(drumTop), 0);
    placeGeo(D, 'verdigris', frame, prismGeo(DA + 0.45, 0, 0.25, 8), 0, Y(drumTop - 0.25), 0);
    const steps = [];
    let r = DA + 0.1, y = drumTop + 0.55;
    for (let i = 0; i < 5; i++) { steps.push([r, y], [r, y + 0.32]); r -= 0.32; y += 0.32; }
    const stepGeo = new THREE.LatheGeometry(steps.map(([rr, yy]) => new THREE.Vector2(rr, yy - drumTop)), low ? 24 : 40);
    placeGeo(main, 'verdigris', frame, stepGeo, 0, Y(drumTop), 0);
    // glazed dome: 16 gores; the texture wraps once around (u) and spans the profile (v)
    const R = r + 0.05, prof = [];
    for (let i = 0; i <= 10; i++) { const a = (i / 10) * (Math.PI / 2) * 0.86; prof.push(new THREE.Vector2(R * Math.cos(a), R * 0.9 * Math.sin(a))); }
    const domeGeo = new THREE.LatheGeometry(prof, low ? 32 : 64);
    const domeBase = y;
    placeGeo(main, 'dome', frame, domeGeo, 0, Y(domeBase), 0, 0, { worldUV: false });
    const topY = domeBase + R * 0.9 * Math.sin(Math.PI / 2 * 0.86), topR = R * Math.cos(Math.PI / 2 * 0.86);
    // lantern ring with scrolls, ball finial
    const lant = new THREE.LatheGeometry([[topR + 0.2, 0], [topR + 0.25, 0.25], [topR - 0.1, 0.35], [topR - 0.2, 1.0], [topR + 0.05, 1.15], [0.5, 1.35], [0.3, 1.9], [0.01, 1.95]].map(([a, b]) => new THREE.Vector2(a, b)), low ? 16 : 24);
    placeGeo(main, 'verdigris', frame, lant, 0, Y(topY - 0.1), 0);
    if (det) for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      const sg = new THREE.TorusGeometry(0.32, 0.1, 5, 8, Math.PI);
      placeGeo(D, 'verdigris', frame, sg, Math.cos(a) * (topR - 0.1), Y(topY + 0.95), Math.sin(a) * (topR - 0.1), -a);
    }
    placeGeo(main, 'precast', frame, new THREE.SphereGeometry(0.62, 14, 10), 0, Y(topY + 2.45), 0);
  }
  // ---------------------------------------------------------------- AAA entrance canopy on Beatty Street (west long side)
  {
    const side = sides[0], L = 2 * HL, nn = edgeNormal(side.a, side.b), t = [(side.b[0] - side.a[0]) / L, (side.b[1] - side.a[1]) / L];
    const c = L * 0.3, cu = side.a[0] + t[0] * c + nn[0] * 1.9, cv = side.a[1] + t[1] * c + nn[1] * 1.9;
    box(main, 'redBand', frame, cu, Y(3.2), cv, 7.0, 0.35, 3.4, { rotY: Math.atan2(-t[1], t[0]) });
    for (const k of [-1, 1]) boxY(main, 'metal', frame, cu + t[0] * k * 3.2 + nn[0] * 1.5, cv + t[1] * k * 3.2 + nn[1] * 1.5, 0.12, 0.12, Y(0), Y(3.1));
  }

  const group = new THREE.Group();
  group.name = 'landmark:motorSquareGarden';
  group.add(main.build(M, { noShadow: ['win', 'glassRoof'] }));
  let detG = null;
  if (det) { detG = det.build(M, { noShadow: ['win'] }); group.add(detG); }
  ctx.materials.enhance?.(group);
  ctx.colliders.addPolygon(rec.footprint, bottom, Y(28), 'motorSquareGarden');
  const [cx, cz] = frame.toWorld(0, 0);
  ctx.pick.add(group, { key: 'motorSquareGarden', kind: 'landmark', name: 'Motor Square Garden', nameZh: '汽车广场花园', osmId: MSG_OSM, infoKey: MSG_OSM, position: [cx, Y(20), cz], radius: 50 });
  ctx.labels.add({ key: 'motorSquareGarden', text: 'Motor Square Garden', textZh: '汽车广场花园', kind: 'landmark', priority: 8, position: { x: cx, y: Y(31), z: cz }, maxDistance: 2200 });
  distanceCull(ctx, { x: cx, z: cz, detail: detG, near: 450, main: group, far: 1.1 * (ctx.quality?.drawDistance || 2400) });
  return group;
}
