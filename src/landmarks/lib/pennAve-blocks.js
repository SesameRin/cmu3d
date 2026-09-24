// Commercial landmarks of East Liberty around Penn & Highland (reference: street photographs and aerial imagery,
// nothing shipped):
//   * Highland Building, 121 S. Highland Ave. (D. H. Burnham & Co. for Henry Clay Frick, 1910; restored 2012-15 as
//     "Walnut on Highland" apartments). Thirteen storeys of Chicago-school tower: a two-storey stone base with shop
//     windows, a shaft of cream glazed terracotta on the street faces (pier-and-spandrel bays with paired sashes, the
//     top storey arched under a deep bracketed cornice) and plain buff brick on the back faces, rooftop penthouse.
//   * Wallace Building next door on Highland: three storeys of brown brick with big window bays over shop fronts and
//     a band of round medallions under the cornice.
//   * Carnegie Library of Pittsburgh - East Liberty, 130 S. Whitfield St.: a two-storey corner block remodelled in 2016
//     - a glazed ground floor under a charcoal metal-clad upper floor with a white corner box.
//   * Target, 6231 Penn Ave. (2011): a very large two-level store over street-level parking, precast and brick panels,
//     a glass entrance pavilion at the west corner with a white pylon carrying the red bullseye.
import * as THREE from 'three';
import { buildingLevels } from '../../core/placement.js';
import {
  Batch, makeFrame, box, boxY, placeGeo, wallQuad, ringWalls, cap, rect, edgeNormal, atlasPanel, atlasDisc,
  archFrame, ensureCCW, distanceCull,
} from './pennAve-kit.js';
import { getPennMaterials } from './pennAve-materials.js';

export const HIGHLAND_OSM = 'w377411693';
export const WALLACE_OSM = 'w126251317';
export const LIBRARY_OSM = 'w34309462';
export const TARGET_OSM = 'w125708085';

const IDENT = makeFrame(0, 0, 0);     // footprints are already in world x/z

function record(ctx, id) { return ctx.data.buildings.find((b) => b.id === id || b.osmId === id) || null; }
function centroid(ring) { let x = 0, z = 0; for (const p of ring) { x += p[0]; z += p[1]; } return [x / ring.length, z / ring.length]; }
// CCW ring in the (x, z) plan (math orientation) so edgeNormal points outwards
function ringOf(rec) { return ensureCCW(rec.footprint.map((p) => [p[0], p[1]])); }
function edges(ring) { return ring.map((a, i) => [a, ring[(i + 1) % ring.length]]); }
const lenOf = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const rotOf = (a, b) => Math.atan2(-(b[1] - a[1]), b[0] - a[0]);

// far: hide the whole model beyond this share of the quality draw distance (small blocks vanish into the haze anyway)
function finish(ctx, group, main, det, M, { key, name, nameZh, osmId, ring, y0, y1, labelY, priority = 8, near = 400, maxDistance = 1800, far = 0 }) {
  group.add(main.build(M, { noShadow: ['win'] }));
  let detG = null;
  if (det && det.lists.size) { detG = det.build(M, { noShadow: ['win'] }); group.add(detG); }
  ctx.materials.enhance?.(group);
  ctx.colliders.addPolygon(ring, y0, y1, key);
  const [cx, cz] = centroid(ring);
  ctx.pick.add(group, { key, kind: 'landmark', name, nameZh, osmId, infoKey: osmId, position: [cx, (y0 + y1) / 2, cz], radius: 30 });
  ctx.labels.add({ key, text: name, textZh: nameZh, kind: 'landmark', priority, position: { x: cx, y: labelY, z: cz }, maxDistance });
  const farM = far > 0 ? far * (ctx.quality?.drawDistance || 2400) : Infinity;
  if (detG || farM < Infinity) distanceCull(ctx, { x: cx, z: cz, detail: detG, near, main: farM < Infinity ? group : null, far: farM });
  return group;
}

// ------------------------------------------------------------------ Highland Building
export async function buildHighland(ctx) {
  const rec = record(ctx, HIGHLAND_OSM);
  if (!rec) return null;
  const { mats, cells } = getPennMaterials(ctx);
  const low = ctx.quality?.level === 'low';
  const lv = buildingLevels(rec);
  const G = rec.ground.min, bottom = lv.baseY;
  const BASE = 8.2, FLOOR = 3.55, TOPF = 11 * FLOOR + BASE, TOP = TOPF + 3.9;   // 13 storeys, ~47.5 m
  const ring = ringOf(rec);
  const main = new Batch('highland'), det = low ? null : new Batch('highland-detail');
  const D = det || { add() {} };
  const M = { ...mats, granite: ctx.materials.get('granite') };
  for (const [a, b] of edges(ring)) {
    const n = edgeNormal(a, b), L = lenOf(a, b);
    // street faces (west on Highland Avenue, north over Penn Avenue) are terracotta; the back faces plain brick
    const street = n[0] < -0.5 || n[1] < -0.5;
    wallQuad(main, 'granite', IDENT, a, b, bottom, G + BASE, { vRef: G });
    const bays = Math.max(1, Math.round(L / 4.4));
    wallQuad(main, street ? 'hbFront' : 'hbSide', IDENT, a, b, G + BASE, G + TOP, { vRef: G + BASE, uScale: (bays * 4.4) / L });
    // shop windows in the base
    const shops = Math.max(1, Math.floor(L / 5));
    if (street) for (let i = 0; i < shops; i++) {
      const t = (i + 0.5) / shops, u = a[0] + (b[0] - a[0]) * t, v = a[1] + (b[1] - a[1]) * t;
      atlasPanel(main, 'win', IDENT, cells.shop, { u, v, n, y0: G + 0.5, w: 4.0, hs: 3.1, k: 0, out: 0.04 });
      atlasPanel(main, 'win', IDENT, cells.sash, { u, v, n, y0: G + 4.8, w: 1.2, hs: 2.4, k: 0, out: 0.04 });
    }
    // belt course over the base, top-storey arcade, the deep cornice and the parapet
    box(main, 'precast', IDENT, (a[0] + b[0]) / 2 + n[0] * 0.2, G + BASE - 0.3, (a[1] + b[1]) / 2 + n[1] * 0.2, L + 0.4, 0.6, 0.4, { rotY: rotOf(a, b) });
    box(main, 'precast', IDENT, (a[0] + b[0]) / 2 + n[0] * 0.55, G + TOP - 0.55, (a[1] + b[1]) / 2 + n[1] * 0.55, L + 1.1, 1.1, 1.1, { rotY: rotOf(a, b) });
    box(main, 'precast', IDENT, (a[0] + b[0]) / 2, G + TOP + 0.5, (a[1] + b[1]) / 2, L, 1.0, 0.4, { rotY: rotOf(a, b) });
    if (street) {
      for (let i = 0; i < bays; i++) {
        const t = (i + 0.5) / bays, u = a[0] + (b[0] - a[0]) * t, v = a[1] + (b[1] - a[1]) * t;
        archFrame(D, 'precast', IDENT, { u, v, n, y0: G + TOPF + 0.7, w: 3.0, hs: 1.3, k: 0.5, t: 0.3, d: 0.18, vRef: G });
        // modillions under the cornice
        if (det) for (const s of [-1, 0, 1]) box(D, 'precast', IDENT, u + (b[0] - a[0]) / L * s * 1.4 + n[0] * 0.5, G + TOP - 1.25, v + (b[1] - a[1]) / L * s * 1.4 + n[1] * 0.5, 0.25, 0.35, 0.9, { rotY: rotOf(a, b) });
      }
    }
  }
  cap(main, 'flatRoof', IDENT, ring, G + TOP);
  // rooftop penthouse (elevator / stair)
  const [cx, cz] = centroid(ring);
  box(main, 'precast', IDENT, cx + 3, G + TOP + 2.2, cz + 2, 11, 4.4, 7, { rotY: rotOf(ring[0], ring[1]) });
  const group = new THREE.Group();
  group.name = 'landmark:highlandBuilding';
  return finish(ctx, group, main, det, M, { key: 'highlandBuilding', name: 'Highland Building', nameZh: '海兰大楼', osmId: HIGHLAND_OSM, ring, y0: bottom, y1: G + TOP + 1, labelY: G + TOP + 8, priority: 8 });
}

// ------------------------------------------------------------------ Wallace Building
export async function buildWallace(ctx) {
  const rec = record(ctx, WALLACE_OSM);
  if (!rec) return null;
  const { mats, cells } = getPennMaterials(ctx);
  const low = ctx.quality?.level === 'low';
  const lv = buildingLevels(rec);
  const G = rec.ground.min, bottom = lv.baseY, TOP = 14.2;
  const ring = ringOf(rec);
  const main = new Batch('wallace'), det = low ? null : new Batch('wallace-detail');
  const D = det || { add() {} };
  for (const [a, b] of edges(ring)) {
    const n = edgeNormal(a, b), L = lenOf(a, b);
    wallQuad(main, 'brickRed', IDENT, a, b, bottom, G + 4.4, { vRef: G });
    wallQuad(main, 'wallaceFacade', IDENT, a, b, G + 4.4, G + TOP, { vRef: G + 4.4 });
    const street = n[0] < -0.6 || n[1] > 0.6;   // Highland Avenue front and the Centre Avenue side
    if (street) {
      const shops = Math.max(1, Math.floor(L / 4.8));
      for (let i = 0; i < shops; i++) {
        const t = (i + 0.5) / shops, u = a[0] + (b[0] - a[0]) * t, v = a[1] + (b[1] - a[1]) * t;
        atlasPanel(main, 'win', IDENT, cells.shop, { u, v, n, y0: G + 0.4, w: 4.1, hs: 3.3, k: 0, out: 0.04 });
      }
      // frieze of roundels under the cornice
      const k = Math.floor(L / 3.2);
      for (let i = 0; i < k; i++) {
        const t = (i + 0.5) / k;
        atlasDisc(D, 'precast', IDENT, [0, 0, 1, 1], { u: a[0] + (b[0] - a[0]) * t, v: a[1] + (b[1] - a[1]) * t, n, y: G + TOP - 1.2, r: 0.45, out: 0.05, seg: 12 });
      }
    }
    box(main, 'precast', IDENT, (a[0] + b[0]) / 2 + n[0] * 0.25, G + TOP - 0.3, (a[1] + b[1]) / 2 + n[1] * 0.25, L + 0.5, 0.6, 0.5, { rotY: rotOf(a, b) });
    box(main, 'precast', IDENT, (a[0] + b[0]) / 2 + n[0] * 0.15, G + 4.3, (a[1] + b[1]) / 2 + n[1] * 0.15, L + 0.3, 0.4, 0.3, { rotY: rotOf(a, b) });
  }
  cap(main, 'flatRoof', IDENT, ring, G + TOP);
  const group = new THREE.Group();
  group.name = 'landmark:wallaceBuilding';
  return finish(ctx, group, main, det, { ...mats }, { key: 'wallaceBuilding', name: 'Wallace Building', nameZh: '华莱士大楼', osmId: WALLACE_OSM, ring, y0: bottom, y1: G + TOP, labelY: G + TOP + 5, priority: 8, maxDistance: 700, far: 0.6 });
}

// ------------------------------------------------------------------ Carnegie Library - East Liberty
export async function buildLibrary(ctx) {
  const rec = record(ctx, LIBRARY_OSM);
  if (!rec) return null;
  const { mats, cells } = getPennMaterials(ctx);
  const lv = buildingLevels(rec);
  const G = rec.ground.min, bottom = lv.baseY, F1 = 4.6, TOP = 10.2;
  const ring = ringOf(rec);
  const main = new Batch('library');
  for (const [a, b] of edges(ring)) {
    const n = edgeNormal(a, b), L = lenOf(a, b);
    wallQuad(main, 'concrete', IDENT, a, b, bottom, G + 0.5, { vRef: G });
    // glazed ground floor: glass panels between slim piers
    const k = Math.max(1, Math.floor(L / 6.5));
    wallQuad(main, 'libClad', IDENT, a, b, G + 0.5, G + F1, { vRef: G });
    for (let i = 0; i < k && L > 3; i++) {
      const t = (i + 0.5) / k, u = a[0] + (b[0] - a[0]) * t, v = a[1] + (b[1] - a[1]) * t;
      atlasPanel(main, 'win', IDENT, cells.glass, { u, v, n, y0: G + 0.5, w: Math.min(6.2, L / k - 0.3), hs: F1 - 0.7, k: 0, out: 0.04 });
    }
    // charcoal metal-clad upper floor with a few deep windows, parapet
    wallQuad(main, 'libClad', IDENT, a, b, G + F1, G + TOP, { vRef: G });
    if (L > 12) for (const t of [0.3, 0.62]) {
      atlasPanel(main, 'win', IDENT, cells.glass, { u: a[0] + (b[0] - a[0]) * t, v: a[1] + (b[1] - a[1]) * t, n, y0: G + F1 + 1.1, w: 3.2, hs: 2.6, k: 0, out: 0.04 });
    }
    box(main, 'metal', IDENT, (a[0] + b[0]) / 2 + n[0] * 0.3, G + F1 - 0.1, (a[1] + b[1]) / 2 + n[1] * 0.3, L + 0.6, 0.3, 0.6, { rotY: rotOf(a, b) });
  }
  cap(main, 'flatRoof', IDENT, ring, G + TOP);
  // white-panelled corner box at the south corner (Baum Blvd / Whitfield St)
  let best = ring[0];
  for (const p of ring) if (p[1] > best[1]) best = p;
  const [cx, cz] = centroid(ring), dx = cx - best[0], dz = cz - best[1], dl = Math.hypot(dx, dz);
  box(main, 'white', IDENT, best[0] + dx / dl * 3.2, G + 7.4, best[1] + dz / dl * 3.2, 6.2, 6.0, 6.2, { rotY: rotOf(ring[0], ring[1]) });
  const group = new THREE.Group();
  group.name = 'landmark:clpEastLiberty';
  return finish(ctx, group, main, null, { ...mats }, { key: 'clpEastLiberty', name: 'Carnegie Library of Pittsburgh – East Liberty', nameZh: '匹兹堡卡内基图书馆东自由分馆', osmId: LIBRARY_OSM, ring, y0: bottom, y1: G + TOP, labelY: G + TOP + 5, priority: 8, maxDistance: 1200, far: 0.6 });
}

// ------------------------------------------------------------------ Target, East Liberty
export async function buildTarget(ctx) {
  const rec = record(ctx, TARGET_OSM);
  if (!rec) return null;
  const { mats, cells } = getPennMaterials(ctx);
  const low = ctx.quality?.level === 'low';
  const G = rec.ground.min, bottom = G - 1.5, PARK = 5.2, TOP = 14.5;
  const ring = ringOf(rec);
  const main = new Batch('target'), det = low ? null : new Batch('target-detail');
  const D = det || { add() {} };
  const M = { ...mats, storeWall: ctx.materials.facade({ wall: 'panel', wallColor: '#cfc6b4', style: 'none', bay: 6, floor: 4.6, seed: 71 }) };
  for (const [a, b] of edges(ring)) {
    const n = edgeNormal(a, b), L = lenOf(a, b);
    const penn = n[1] < -0.6;            // the north-east front on Penn Avenue
    // street level: brick with display windows on Penn Avenue, open parking bays elsewhere
    wallQuad(main, penn ? 'brickRed' : 'concrete', IDENT, a, b, bottom, G + PARK, { vRef: G });
    const k = Math.max(0, Math.floor(L / 8));
    for (let i = 0; i < k; i++) {
      const t = (i + 0.5) / k, u = a[0] + (b[0] - a[0]) * t, v = a[1] + (b[1] - a[1]) * t;
      if (penn) atlasPanel(main, 'win', IDENT, cells.shop, { u, v, n, y0: G + 0.6, w: 5.6, hs: 3.4, k: 0, out: 0.04 });
      else atlasPanel(main, 'dark', IDENT, [0, 0, 1, 1], { u, v, n, y0: G + 0.3, w: 6.4, hs: PARK - 1.2, k: 0, out: 0.03 });
    }
    // the store floor: precast panels with a red band and a cornice
    wallQuad(main, 'storeWall', IDENT, a, b, G + PARK, G + TOP, { vRef: G });
    box(main, 'redBand', IDENT, (a[0] + b[0]) / 2 + n[0] * 0.12, G + TOP - 1.6, (a[1] + b[1]) / 2 + n[1] * 0.12, L + 0.24, 0.9, 0.24, { rotY: rotOf(a, b) });
    box(main, 'precast', IDENT, (a[0] + b[0]) / 2 + n[0] * 0.3, G + TOP + 0.2, (a[1] + b[1]) / 2 + n[1] * 0.3, L + 0.6, 0.5, 0.6, { rotY: rotOf(a, b) });
    box(D, 'metal', IDENT, (a[0] + b[0]) / 2 + n[0] * 0.15, G + PARK, (a[1] + b[1]) / 2 + n[1] * 0.15, L + 0.3, 0.35, 0.3, { rotY: rotOf(a, b) });
  }
  cap(main, 'flatRoof', IDENT, ring, G + TOP);
  // entrance pavilion at the west corner: glass box, red fin wall, the bullseye pylon
  let west = ring[0];
  for (const p of ring) if (p[0] < west[0]) west = p;
  const [cx, cz] = centroid(ring), dx = cx - west[0], dz = cz - west[1], dl = Math.hypot(dx, dz);
  const px = west[0] + dx / dl * 9, pz = west[1] + dz / dl * 9, rot = rotOf(ring[0], ring[1]);
  box(main, 'redBand', IDENT, px, G + TOP + 1.2, pz, 14, 2.4, 10, { rotY: rot });
  const pyl = [west[0] - dx / dl * 2.5, west[1] - dz / dl * 2.5];
  boxY(main, 'white', IDENT, pyl[0], pyl[1], 3.4, 1.0, G, G + 17.5, { rotY: rot + Math.PI / 4 });
  for (const s of [-1, 1]) {
    const nr = [Math.cos(rot + Math.PI / 4) * 0 + Math.sin(rot + Math.PI / 4) * s, Math.cos(rot + Math.PI / 4) * s];
    atlasDisc(main, 'win', IDENT, cells.bullseye, { u: pyl[0], v: pyl[1], n: nr, y: G + 15.6, r: 1.4, out: 0.52 });
  }
  const group = new THREE.Group();
  group.name = 'landmark:targetEastLiberty';
  return finish(ctx, group, main, det, M, { key: 'targetEastLiberty', name: 'Target (East Liberty)', nameZh: 'Target 超市（东自由）', osmId: TARGET_OSM, ring, y0: bottom, y1: G + TOP, labelY: G + TOP + 6, priority: 8, maxDistance: 1200, far: 0.9 });
}
