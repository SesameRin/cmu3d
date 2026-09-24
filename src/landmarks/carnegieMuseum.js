// Carnegie Institute complex on Forbes Avenue (Oakland, Pittsburgh) + "Dippy" the Diplodocus statue.
//
// One connected Beaux-Arts building made of four OSM footprints:
//   · Carnegie Music Hall            w154257484  (NW corner, Forbes Ave / Schenley Plaza)
//   · Carnegie Museum of Natural History w154257481 (1907 extension along Forbes Ave + halls behind)
//   · Carnegie Library of Pittsburgh  w31899524   (1895 building facing Schenley Plaza, apse to the south)
//   · Carnegie Museum of Art          w31899525   (Forbes Ave galleries + 1974 Sarah Scaife Galleries, larvikite)
// Real-world references used: Longfellow, Alden & Harlow (1895, 1907), light-grey Berea sandstone with a rusticated
// ground floor, fluted Corinthian porticos over the entrances, names of writers/artists/musicians/scientists carved in
// the entablature, J. Massey Rhind's seated bronzes (Shakespeare & Bach at the Music Hall stairs, Michelangelo &
// Galileo at the carriage-drive museum entrance) with four standing bronze muses on the parapets above them, an
// armillary sphere on the roof, patinated copper hipped roofs; the Scaife wing by Edward Larrabee Barnes (grey-blue
// Norwegian larvikite over a glazed base, sawtooth gallery windows on Forbes, roof lights), Fountain Plaza and
// Richard Serra's 40-ft Cor-Ten "Carnegie".
//
// Coordinates: the whole complex is modelled in a local frame aligned with Forbes Avenue
// (u = east along Forbes, w = away from Forbes / south), see FRAME.
import * as THREE from 'three';
import { buildingById } from '../core/placement.js';
import { GeoBatch, makeFrame, pointInRing, offsetRing, exteriorSegments, signedArea } from './lib/oaklandB-geo.js';
import * as TX from './lib/oaklandB-tex.js';
import { seatedFigure, standingMuse, lampStandard, armillary, corinthianColumn, dippyGeometry } from './lib/oaklandB-figures.js';

const IDS = { nh: 'w154257481', art: 'w31899525', lib: 'w31899524', mh: 'w154257484' };
const FRAME = makeFrame([-700, -60], Math.atan2(-57, 177)); // Forbes Ave direction (ENE)
const G0 = 33.8; // ground-floor datum of the sandstone building (m above base elevation)
const GS = 35.3; // Scaife Galleries datum (Forbes Ave rises towards the east)
const WALL_TOP = G0 + TX.FACADE.wallTop;

const INFO = {
  nh: { key: 'carnegieMuseum', name: 'Carnegie Museum of Natural History', nameZh: '卡内基自然历史博物馆', osmId: IDS.nh, label: [-601.4, G0 + 31, -12.0], priority: 8 },
  art: { key: 'carnegieArt', name: 'Carnegie Museum of Art', nameZh: '卡内基艺术博物馆', osmId: IDS.art, label: [-510, GS + 22, -85], priority: 8 },
  lib: { key: 'carnegieLibrary', name: 'Carnegie Library of Pittsburgh', nameZh: '匹兹堡卡内基图书馆', osmId: IDS.lib, label: [-640.6, G0 + 28, 23.9], priority: 7 },
  mh: { key: 'carnegieMusicHall', name: 'Carnegie Music Hall', nameZh: '卡内基音乐厅', osmId: IDS.mh, label: [-681, G0 + 35, -38], priority: 7 },
};

// Profiles for mouldings lofted around the roof line: [outward offset, height above G0]
const CORNICE = [[0, 18.2], [0.1, 18.2], [0.1, 18.42], [0.28, 18.48], [0.28, 18.68], [0.92, 18.86], [0.92, 19.3], [1.02, 19.36], [1.02, 19.6], [0, 19.6]];
const PARAPET = [[0, 19.6], [0.06, 19.6], [0.06, 20.55], [0.16, 20.6], [0.16, 20.8], [-0.24, 20.8], [-0.24, 19.6]];

// ------------------------------------------------------------------------------------------------ materials
function materialsFor(ctx) {
  const m = ctx.materials;
  const inscr = TX.inscriptions(ctx);
  return {
    inscrUV: inscr.uv,
    mats: {
      facade: TX.carnegieFacade(ctx, 'museum'),
      libFacade: TX.carnegieFacade(ctx, 'library'),
      ashlar: TX.ashlar(ctx),
      portico: TX.porticoStone(ctx),
      fluted: TX.flutedColumn(ctx),
      podium: m.get('granite'),
      roof: m.get('flatRoof'),
      copperRoof: m.get('copperRoof'),
      skylight: TX.skylightGlass(ctx),
      bronze: TX.patinaBronze(ctx),
      door: TX.darkBronze(ctx),
      globe: TX.lampGlobe(ctx),
      inscr: inscr.material,
      larvikite: TX.larvikite(ctx),
      scaifeGlass: m.facade({ style: 'curtain', bay: 3.0, floor: 5.2, glass: '#2f3e47', frame: '#30343a', lit: 0.5, seed: 11 }),
      corten: TX.corten(ctx),
      water: m.get('water'),
      granite: m.get('granite'),
      aluminium: m.get('aluminium'),
    },
  };
}

// ------------------------------------------------------------------------------------------------ portico
/**
 * Build a portico in portico space (x along the front, left→right seen from outside; y absolute; z outward,
 * the building wall at z = 0) into a fresh GeoBatch. Caller merges it with a placement matrix.
 */
function buildPortico(s, inscrUV) {
  const P = new GeoBatch();
  const { x0, x1, depth, floorY, colTop, entTop, groundFront, stairHalf } = s;
  const colD = s.colD, colZ = depth - colD * 0.85;
  // stylobate / porch floor
  P.box('podium', x0, x1, Math.min(groundFront, floorY) - 1.5, floorY, -0.2, depth, { vOrigin: floorY });
  // steps down to the street
  const nSteps = Math.max(1, Math.ceil((floorY - groundFront) / 0.16));
  const rise = (floorY - groundFront) / nSteps;
  for (let k = 1; k <= nSteps; k++) {
    const z0 = depth + (k - 1) * 0.38, z1 = depth + k * 0.38;
    P.box('podium', -stairHalf, stairHalf, groundFront - 1.2, floorY - k * rise, z0 - 0.4, z1, { vOrigin: groundFront });
  }
  const stairFront = depth + nSteps * 0.38;
  // cheek blocks flanking the stairs
  if (s.cheeks) {
    for (const sx of [-1, 1]) {
      const xa = sx < 0 ? -stairHalf - 1.4 : stairHalf, xb = sx < 0 ? -stairHalf : stairHalf + 1.4;
      P.box('podium', xa, xb, groundFront - 1.2, floorY + 0.35, depth - 0.1, stairFront, { vOrigin: groundFront });
    }
  }
  // columns
  const colGeo = corinthianColumn(colD, colTop - floorY);
  const m = new THREE.Matrix4();
  for (const cx of s.cols) {
    m.makeTranslation(cx, floorY, colZ);
    P.addGeometry('fluted', colGeo.shaft, m);
    for (const g of colGeo.stone) P.addGeometry('portico', g, m);
  }
  // antae (end piers)
  if (s.antae) {
    P.box('portico', x0, x0 + s.antae, floorY, colTop, -0.1, depth - 0.15, { vOrigin: floorY });
    P.box('portico', x1 - s.antae, x1, floorY, colTop, -0.1, depth - 0.15, { vOrigin: floorY });
  }
  // entablature (architrave + frieze) with a soffit (porch ceiling)
  P.box('portico', x0 - 0.2, x1 + 0.2, colTop, entTop, -0.1, depth + 0.35, { vOrigin: colTop, bottom: true });
  // inscription on the frieze
  const [v0, v1] = inscrUV(s.inscription);
  const fz = depth + 0.36, fy0 = colTop + (entTop - colTop) * 0.42, fy1 = entTop - 0.18;
  const halfW = Math.min((x1 - x0) / 2 - 1.2, (fy1 - fy0) * 6.4);
  P.quad('inscr', [-halfW, fy0, fz], [halfW, fy0, fz], [halfW, fy1, fz], [-halfW, fy1, fz], [0, v0], [1, v0], [1, v1], [0, v1], [0, 0, 1]);
  // architrave fasciae shadow line: slight projecting band
  P.box('portico', x0 - 0.25, x1 + 0.25, colTop + (entTop - colTop) * 0.36, colTop + (entTop - colTop) * 0.4, -0.1, depth + 0.4, { vOrigin: colTop });
  // cornice around the three free sides
  const corRing = [[x0 - 0.2, -0.1], [x1 + 0.2, -0.1], [x1 + 0.2, depth + 0.35], [x0 - 0.2, depth + 0.35]];
  const prof = s.corniceProfile.map(([o, y]) => [o, entTop + y]);
  P.ringLoft('portico', corRing, prof, (i) => i === 0);
  const corTop = entTop + s.corniceProfile[s.corniceProfile.length - 1][1];
  // attic
  if (s.atticTop) {
    P.box('ashlar', x0 + 0.3, x1 - 0.3, corTop, s.atticTop, 0.2, depth - 0.1, { vOrigin: corTop });
    P.ringLoft('portico', [[x0 + 0.3, 0.2], [x1 - 0.3, 0.2], [x1 - 0.3, depth - 0.1], [x0 + 0.3, depth - 0.1]],
      [[0, s.atticTop - 0.35], [0.18, s.atticTop - 0.3], [0.18, s.atticTop], [0, s.atticTop]], (i) => i === 0);
    // raised panels
    for (const px of [-(x1 - x0) / 4, (x1 - x0) / 4]) {
      P.box('portico', px - 3, px + 3, corTop + 0.5, s.atticTop - 0.7, depth - 0.1, depth, { vOrigin: corTop });
    }
  } else if (s.balustrade) {
    // low balustrade over the porch
    for (let x = x0; x < x1 - 0.1; x += 0.42) P.box('portico', x + 0.1, x + 0.26, corTop, corTop + 0.85, depth - 0.3, depth - 0.1, { vOrigin: corTop });
    P.box('portico', x0, x1, corTop + 0.85, corTop + 1.05, depth - 0.4, depth, { vOrigin: corTop });
    P.box('portico', x0, x1, corTop, corTop + 1.05, 0.0, 0.3, { vOrigin: corTop });
    for (const x of [x0, x1 - 0.5]) P.box('portico', x, x + 0.5, corTop, corTop + 1.05, 0, depth, { vOrigin: corTop });
  }
  // doors in the back wall
  for (const dx of s.doors) {
    P.box('door', dx - 1.2, dx + 1.2, floorY, floorY + s.doorH, 0.02, 0.12, { vOrigin: floorY });
    P.box('portico', dx - 1.55, dx + 1.55, floorY + s.doorH, floorY + s.doorH + 0.45, 0.02, 0.3, { vOrigin: floorY });
  }
  return { batch: P, stairFront, colZ };
}

// ------------------------------------------------------------------------------------------------ complex
async function buildComplex(ctx) {
  const data = ctx.data;
  const bld = {};
  for (const k of Object.keys(IDS)) {
    bld[k] = buildingById(data, IDS[k]);
    if (!bld[k]) { console.warn(`[carnegieMuseum] footprint ${IDS[k]} missing — skipping model`); return null; }
  }
  const F = FRAME;
  const L = (ring) => ring.map(([x, z]) => F.toLocal(x, z));
  const R = { nh: L(bld.nh.footprint), art: L(bld.art.footprint), lib: L(bld.lib.footprint), mh: L(bld.mh.footprint) };
  const hAt = (u, w) => { const [x, z] = F.toWorld(u, w); return ctx.heightAt(x, z); };
  const { mats, inscrUV } = materialsFor(ctx);
  const B = new GeoBatch();
  const colliders = []; // [kind, ...args] in world coords

  // ---------------------------------------------------------------- sandstone body (walls to the roof line)
  // Music Hall ring without the portico bay (vertices 2,3 are the portico's front corners)
  const mhBody = R.mh.length === 11 ? R.mh.filter((_, i) => i !== 2 && i !== 3) : R.mh;
  const bodies = [
    { ring: mhBody, key: 'facade', others: [R.nh, R.lib, R.art] },
    { ring: R.nh, key: 'facade', others: [R.mh, R.lib, R.art] },
    { ring: R.lib, key: 'libFacade', others: [R.nh, R.mh] },
  ];
  const bottom = (u, w) => Math.min(hAt(u, w), G0) - 1.6;
  for (const b of bodies) {
    // facade texture anchored at each wall's midpoint (centred on a bay; the carved name varies per wall)
    const bay = TX.FACADE.bay;
    B.prism(b.key, b.ring, bottom, WALL_TOP, { top: false, vOrigin: G0, uAnchor: (i) => bay / 2 + bay * ((i * 7 + b.ring.length) % TX.FACADE.bays) });
    B.polygon('roof', b.ring, WALL_TOP + 0.02, 1);
    // granite base course (offset slightly outward)
    B.prism('podium', offsetRing(b.ring, 0.3), (u, w) => Math.min(hAt(u, w), G0) - 1.2, G0 + 0.3, { top: false, vOrigin: G0 });
    B.ringLoft('podium', b.ring, [[0.3, G0 + 0.3], [0.16, G0 + 0.44], [0, G0 + 0.44]]);
    // roof-line mouldings only where the edge is (mostly) exterior
    const segs = exteriorSegments(b.ring, b.others, 1.5);
    const extLen = new Map();
    for (const s of segs) extLen.set(s.edge, (extLen.get(s.edge) || 0) + Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]));
    const skip = (i) => {
      const a = b.ring[i], c = b.ring[(i + 1) % b.ring.length];
      const L0 = Math.hypot(c[0] - a[0], c[1] - a[1]);
      return (extLen.get(i) || 0) < L0 * 0.3;
    };
    B.ringLoft('ashlar', b.ring, CORNICE.map(([o, y]) => [o, G0 + y]), skip, G0);
    B.ringLoft('ashlar', b.ring, PARAPET.map(([o, y]) => [o, G0 + y]), skip, G0);
  }

  // ---------------------------------------------------------------- porticos
  const toComplex = (anchorU, anchorW, theta) => new THREE.Matrix4().makeRotationY(theta).setPosition(anchorU, 0, anchorW);
  const statueSpots = [];
  const lampSpots = [];
  const museSpots = [];
  // Music Hall portico (faces Forbes = -w). Wall plane w≈4.75, front w≈-3.1, u -2.2…23.7.
  {
    const au = 10.75, aw = 4.75;
    const groundFront = Math.min(hAt(au, -6), hAt(au - 9, -6), hAt(au + 9, -6));
    const s = {
      x0: -12.95, x1: 12.95, depth: 7.8, floorY: G0 + 0.5, colTop: G0 + 16.2, entTop: G0 + 18.2, atticTop: G0 + 22.4,
      colD: 1.6, cols: [-6.57, -2.19, 2.19, 6.57], antae: 2.0, groundFront, stairHalf: 9.2, cheeks: false,
      corniceProfile: CORNICE.map(([o, y]) => [o, y - 18.2]), inscription: 0, doors: [-5.2, 0, 5.2], doorH: 5.6,
    };
    const { batch, stairFront } = buildPortico(s, inscrUV);
    const M = toComplex(au, aw, Math.PI);
    B.merge(batch, M);
    const loc = (x, z) => { const v = new THREE.Vector3(x, 0, z).applyMatrix4(M); return [v.x, v.z]; };
    statueSpots.push({ at: loc(-10.6, stairFront - 1.4), faceW: -1, pose: 1, name: 'Bach' }, { at: loc(10.6, stairFront - 1.4), faceW: -1, pose: 0, name: 'Shakespeare' });
    lampSpots.push(loc(-8.4, stairFront + 0.5), loc(8.4, stairFront + 0.5));
    museSpots.push({ at: loc(-10.9, 5.4), y: s.atticTop, faceW: -1, seed: 1 }, { at: loc(10.9, 5.4), y: s.atticTop, faceW: -1, seed: 0 });
  }
  // Carriage-drive entrance to the museums (NH front, w≈6.3), shallow portico: the drive passes in front.
  {
    const au = 55.9, aw = 6.3;
    const groundFront = Math.min(hAt(au, 3), hAt(au - 8, 3), hAt(au + 8, 3));
    const s = {
      x0: -10.5, x1: 10.5, depth: 2.3, floorY: Math.max(G0 + 0.35, groundFront + 0.35), colTop: G0 + 16.2, entTop: G0 + 18.2, atticTop: G0 + 22.4,
      colD: 1.45, cols: [-7.4, -2.5, 2.5, 7.4], antae: 1.4, groundFront, stairHalf: 9.0, cheeks: false,
      corniceProfile: CORNICE.map(([o, y]) => [o, y - 18.2]), inscription: 1, doors: [-4.9, 0, 4.9], doorH: 5.2,
    };
    const { batch, stairFront } = buildPortico(s, inscrUV);
    const M = toComplex(au, aw, Math.PI);
    B.merge(batch, M);
    const loc = (x, z) => { const v = new THREE.Vector3(x, 0, z).applyMatrix4(M); return [v.x, v.z]; };
    statueSpots.push({ at: loc(-12.6, 1.4), faceW: -1, pose: 1, name: 'Galileo' }, { at: loc(12.6, 1.4), faceW: -1, pose: 0, name: 'Michelangelo' });
    museSpots.push({ at: loc(-8.6, 1.5), y: s.atticTop, faceW: -1, seed: 3 }, { at: loc(8.6, 1.5), y: s.atticTop, faceW: -1, seed: 2 });
    for (const cx of s.cols) { const [u, w] = loc(cx, s.depth - s.colD * 0.85); colliders.push(['circle', u, w, s.colD * 0.6]); }
    void stairFront;
  }
  // Library entrance porch on Schenley Plaza (faces -u). Wall plane u≈0.55, w 91.9…103.4.
  {
    const au = 0.55, aw = 97.6;
    const groundFront = Math.min(hAt(-4, aw), hAt(-4, aw - 4), hAt(-4, aw + 4));
    const s = {
      x0: -5.9, x1: 5.9, depth: 3.2, floorY: G0 + 0.45, colTop: G0 + 9.6, entTop: G0 + 11.0, atticTop: 0, balustrade: true,
      colD: 0.95, cols: [-4.6, -1.55, 1.55, 4.6], antae: 0, groundFront, stairHalf: 5.6, cheeks: false,
      corniceProfile: [[0, 0], [0.1, 0], [0.1, 0.2], [0.5, 0.35], [0.5, 0.65], [0, 0.65]], inscription: 2, doors: [-3.1, 0, 3.1], doorH: 4.4,
    };
    const { batch, stairFront } = buildPortico(s, inscrUV);
    const M = toComplex(au, aw, -Math.PI / 2);
    B.merge(batch, M);
    const loc = (x, z) => { const v = new THREE.Vector3(x, 0, z).applyMatrix4(M); return [v.x, v.z]; };
    lampSpots.push(loc(-6.6, stairFront - 0.6), loc(6.6, stairFront - 0.6));
    for (const cx of s.cols) { const [u, w] = loc(cx, s.depth - s.colD * 0.85); colliders.push(['circle', u, w, s.colD * 0.6]); }
  }

  // Seated bronzes, standing muses, lanterns
  const keysFig = { bronze: 'bronze', granite: 'granite', stone: 'portico', globe: 'globe', metal: 'aluminium' };
  for (const st of statueSpots) {
    const [u, w] = st.at;
    const m = new THREE.Matrix4().makeRotationY(st.faceW < 0 ? Math.PI : 0).setPosition(u, hAt(u, w) - 0.05, w);
    seatedFigure(B, m, keysFig, st.pose);
    colliders.push(['box', u, w, 1.1, 1.25, 0]);
  }
  for (const ms of museSpots) {
    const m = new THREE.Matrix4().makeRotationY(ms.faceW < 0 ? Math.PI : 0).setPosition(ms.at[0], ms.y, ms.at[1]);
    standingMuse(B, m, keysFig, ms.seed);
  }
  for (const [u, w] of lampSpots) {
    lampStandard(B, new THREE.Matrix4().makeTranslation(u, hAt(u, w) - 0.05, w), keysFig);
    colliders.push(['circle', u, w, 0.35]);
  }

  // ---------------------------------------------------------------- upper masses and roofs
  const mass = (u0, u1, w0, w1, top, key = 'ashlar') => {
    B.box(key, u0, u1, WALL_TOP - 0.6, top, w0, w1, { vOrigin: G0, topKey: 'roof' });
    B.ringLoft('ashlar', [[u0, w0], [u1, w0], [u1, w1], [u0, w1]], [[0, top - 0.8], [0.12, top - 0.8], [0.12, top - 0.55], [0.55, top - 0.35], [0.55, top], [0, top]], null, G0);
  };
  // Music Hall auditorium: taller mass with a hipped metal roof
  mass(-4, 29.5, 19, 61, G0 + 25.5);
  B.hipRoof('copperRoof', -4, 29.5, 19, 61, G0 + 25.5, 4.6, 0.4);
  // Grand Staircase pavilion (projecting on Forbes) + armillary sphere on the ridge
  mass(79.6, 103.4, -4.2, 19, G0 + 23.2);
  B.hipRoof('copperRoof', 79.6, 103.4, -4.2, 19, G0 + 23.2, 3.4, 0.3);
  armillary(B, new THREE.Matrix4().makeTranslation(91.5, G0 + 26.3, 7.4), keysFig);
  // Hall of Architecture: tall hall with a glazed hipped skylight
  mass(40, 74.5, 11, 46.5, G0 + 22.6);
  B.hipRoof('skylight', 41, 73.5, 12, 45.5, G0 + 22.6, 4.2);
  // Hall of Sculpture skylight
  mass(76.5, 103, 21, 44.5, G0 + 20.9);
  B.hipRoof('skylight', 77.5, 102, 22, 43.5, G0 + 20.9, 3.0);
  // Dinosaur Hall (Dinosaurs in Their Time) — raised hall with long skylight
  mass(40, 72, 64.5, 128, G0 + 23.2);
  B.hipRoof('skylight', 43, 69, 68, 124.5, G0 + 23.2, 3.4);
  // eastern natural-history halls skylight monitor
  mass(81, 108.5, 66, 126, G0 + 20.9);
  B.hipRoof('skylight', 82, 107.5, 67, 125, G0 + 20.9, 2.8);
  // Library: hipped metal roofs over the Schenley Plaza range and its two end pavilions; book-stack block behind
  B.hipRoof('copperRoof', 3.8, 22, 65.5, 130, G0 + 19.6, 4.4);
  B.hipRoof('copperRoof', -7.1, 3.8, 64.2, 79.8, G0 + 19.6, 3.6);
  B.hipRoof('copperRoof', -6.2, 3.8, 115.9, 131.8, G0 + 19.6, 3.6);
  mass(26, 62, 70, 126, G0 + 21.0);

  // ---------------------------------------------------------------- Scaife Galleries (Museum of Art, 1974)
  {
    const ring = R.art;
    const sgn = signedArea(ring) > 0 ? 1 : -1;
    const bot = (u, w) => Math.min(hAt(u, w), GS) - 1.6;
    // glazed ground floor, set back under the cantilevered stone storey (soffit)
    const inset = offsetRing(ring, -1.4);
    B.prism('scaifeGlass', inset, bot, GS + 5.2, { top: false, vOrigin: GS });
    B.polygon('larvikite', ring, GS + 5.2, -1, [inset]);
    // larvikite gallery storey; the slanted sawtooth faces on Forbes are glazed gallery windows
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const du = b[0] - a[0], dw = b[1] - a[1], len = Math.hypot(du, dw);
      if (len < 1e-3) continue;
      const nu = (dw / len) * sgn, nw = (-du / len) * sgn;
      const slanted = Math.abs(dw) > 1.5 && Math.abs(du) > 5 && nw < -0.9 && Math.max(a[1], b[1]) < 8;
      const inner = pointInRing((a[0] + b[0]) / 2 + nu * 0.6, (a[1] + b[1]) / 2 + nw * 0.6, R.nh);
      if (inner) continue;
      B.wall(slanted ? 'scaifeGlass' : 'larvikite', a[0], a[1], b[0], b[1], GS + 5.2, GS + 5.2, GS + 14, GS + 14, [nu, nw], GS);
    }
    B.polygon('roof', ring, GS + 14, 1);
    // dark bronze fascia between the glass base and the stone storey, aluminium coping
    B.ringLoft('door', ring, [[0, GS + 4.95], [0.18, GS + 4.95], [0.18, GS + 5.45], [0, GS + 5.45]]);
    B.ringLoft('aluminium', ring, [[0, GS + 13.85], [0.1, GS + 13.85], [0.1, GS + 14.3], [-0.3, GS + 14.3], [-0.3, GS + 14]]);
    // north-light roof monitors over the gallery block
    for (let w = 27; w <= 68; w += 8) {
      B.box('larvikite', 153, 214, GS + 14, GS + 15.5, w - 1.8, w + 1.8, { vOrigin: GS, topKey: 'aluminium' });
      B.wall('skylight', 153, w - 1.81, 214, w - 1.81, GS + 14.3, GS + 14.3, GS + 15.3, GS + 15.3, [0, -1], GS);
    }
    // Fountain Plaza: long reflecting pool in front of the Scaife entrance
    const pu0 = 166, pu1 = 199, pw0 = -9.5, pw1 = -3.2;
    const pg = Math.min(hAt(pu0, pw0), hAt(pu1, pw0), hAt(pu0, pw1), hAt(pu1, pw1));
    const rimTop = pg + 0.45;
    B.box('granite', pu0, pu1, pg - 1, rimTop, pw0, pw0 + 0.45, { vOrigin: pg });
    B.box('granite', pu0, pu1, pg - 1, rimTop, pw1 - 0.45, pw1, { vOrigin: pg });
    B.box('granite', pu0, pu0 + 0.45, pg - 1, rimTop, pw0, pw1, { vOrigin: pg });
    B.box('granite', pu1 - 0.45, pu1, pg - 1, rimTop, pw0, pw1, { vOrigin: pg });
    B.polygon('water', [[pu0 + 0.45, pw0 + 0.45], [pu1 - 0.45, pw0 + 0.45], [pu1 - 0.45, pw1 - 0.45], [pu0 + 0.45, pw1 - 0.45]], rimTop - 0.12, 1);
    colliders.push(['box', (pu0 + pu1) / 2, (pw0 + pw1) / 2, (pu1 - pu0) / 2, (pw1 - pw0) / 2, 0]);
    // Richard Serra, "Carnegie" (1985): four tilted Cor-Ten plates, ~12 m tall, flaring towards the top
    {
      const [su, sw] = [204.8, -3.3];
      const g = hAt(su, sw);
      const H = 12.2;
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2 + 0.2;
        const c = Math.cos(a), s = Math.sin(a);
        // plate spans tangentially; bottom close to the centre, top leaning outwards
        const rb = 0.85, rt = 1.3, hwB = 0.95, hwT = 1.35, t = 0.08;
        const pts = (r, hw, y) => [[su + c * r - s * hw, y, sw + s * r + c * hw], [su + c * r + s * hw, y, sw + s * r - c * hw]];
        const [b0, b1] = pts(rb, hwB, g - 0.3), [t0, t1] = pts(rt, hwT, g + H);
        const [ib0, ib1] = pts(rb - t, hwB, g - 0.3), [it0, it1] = pts(rt - t, hwT, g + H);
        const du = [c, 0, s];
        B.quad('corten', b0, b1, t1, t0, [0, 0], [2 * hwB, 0], [2 * hwT, H], [0, H], du);
        B.quad('corten', ib0, ib1, it1, it0, [0, 0], [2 * hwB, 0], [2 * hwT, H], [0, H], [-c, 0, -s]);
        B.quad('corten', t0, t1, it1, it0, [0, 0], [4, 0], [4, 0.1], [0, 0.1], [0, 1, 0]);
        B.quad('corten', b1, t1, it1, ib1, [0, 0], [H, 0], [H, 0.1], [0, 0.1], [-s, 0, c]);
        B.quad('corten', b0, t0, it0, ib0, [0, 0], [H, 0], [H, 0.1], [0, 0.1], [s, 0, -c]);
        colliders.push(['box', su + c * 0.95, sw + s * 0.95, 0.12, 1.0, -a]);
      }
    }
    // Sculptures on the Forbes Avenue lawn
    {
      const [u1, w1] = [139.1, -9.1];
      const g1 = hAt(u1, w1);
      B.box('granite', u1 - 1.6, u1 + 1.6, g1 - 0.4, g1 + 0.5, w1 - 1.0, w1 + 1.0, { vOrigin: g1 });
      const tor = new THREE.TorusGeometry(1.0, 0.42, 8, 18, Math.PI * 1.35);
      B.addGeometry('bronze', tor, new THREE.Matrix4().makeRotationZ(0.3).setPosition(u1, g1 + 1.35, w1));
      const [u2, w2] = [172.3, -4.1];
      const g2 = hAt(u2, w2);
      B.box('corten', u2 - 0.2, u2 + 0.2, g2 - 0.3, g2 + 6.5, w2 - 1.6, w2 + 1.6, { vOrigin: g2 });
      B.addGeometry('corten', new THREE.BoxGeometry(0.4, 4.5, 3.2), new THREE.Matrix4().makeRotationX(0.7).setPosition(u2 + 0.4, g2 + 4.5, w2 + 0.8));
    }
  }

  // ---------------------------------------------------------------- assemble
  // 'podium' and 'granite' share one material, so GeoBatch.build merges them into a single mesh. Parts whose shadow is
  // invisible (doors flush with the wall, thin aluminium coping + armillary, lamp globes, inscriptions, water) skip
  // the shadow pass.
  const group = B.build(mats, {
    shadows: { water: { cast: false }, globe: { cast: false }, inscr: { cast: false }, door: { cast: false }, aluminium: { cast: false } },
  });
  group.name = 'landmark:carnegieInstitute';
  group.position.set(F.origin[0], 0, F.origin[1]);
  group.rotation.y = F.rotationY;
  group.updateMatrixWorld(true);

  // ---------------------------------------------------------------- colliders (world coords)
  const W = (ring) => ring.map(([u, w]) => F.toWorld(u, w));
  for (const k of Object.keys(IDS)) {
    const b = bld[k];
    const top = k === 'art' ? GS + 16 : G0 + 30;
    ctx.colliders.addPolygon(b.footprint, b.ground.min - 3, top, INFO[k].key);
  }
  for (const c of colliders) {
    if (c[0] === 'circle') { const [x, z] = F.toWorld(c[1], c[2]); ctx.colliders.addCircle(x, z, c[3], G0 - 5, G0 + 20, 'carnegie'); }
    else {
      const [x, z] = F.toWorld(c[1], c[2]);
      ctx.colliders.addBox(x, z, c[3], c[4], (c[5] || 0) + F.rotationY, G0 - 5, G0 + 14, 'carnegie');
    }
  }
  void W;

  // ---------------------------------------------------------------- picking + labels
  const entries = {};
  for (const k of Object.keys(IDS)) {
    const i = INFO[k];
    const c = bld[k].centroid;
    entries[k] = {
      key: i.key, kind: 'landmark', name: i.name, nameZh: i.nameZh, osmId: i.osmId,
      position: [c[0], (k === 'art' ? GS : G0) + 10, c[1]], radius: Math.sqrt(bld[k].area) * 0.75,
    };
    ctx.labels.add({ key: i.key, text: i.name, textZh: i.nameZh, kind: 'landmark', priority: i.priority, position: { x: i.label[0], y: i.label[1], z: i.label[2] }, maxDistance: 1500 });
  }
  ctx.pick.add(group, (hit) => {
    const [u, w] = F.toLocal(hit.point.x, hit.point.z);
    if (pointInRing(u, w, R.art) || u > 112 || (u > 105 && w < 0)) return entries.art;
    if (pointInRing(u, w, R.lib) || (u < 1 && w > 62)) return entries.lib;
    if (pointInRing(u, w, R.mh) || (u < 31 && w < 20)) return entries.mh;
    return entries.nh;
  });
  return group;
}

// ------------------------------------------------------------------------------------------------ Dippy
async function buildDippy(ctx) {
  const poi = ctx.data.pois.find((p) => p.name === 'Dippy');
  const px = poi ? poi.x : -720.52, pz = poi ? poi.z : -61.43;
  // The statue stands on the lawn at Forbes Ave & Schenley Drive Ext., body parallel to Forbes, head towards the
  // Music Hall entrance. The OSM point marks the middle of the statue; the hips sit ~2 m west of it.
  const F = FRAME;
  const [pu, pw] = F.toLocal(px, pz);
  const hipU = pu + 1.9, hipW = pw;
  const [hx, hz] = F.toWorld(hipU, hipW);
  const ground = Math.min(ctx.heightAt(hx, hz), ctx.heightAt(...F.toWorld(hipU + 4, hipW)));
  const geo = dippyGeometry();
  const B = new GeoBatch();
  for (const g of geo.body) B.addGeometry('skin', g, null, 1);
  for (const g of geo.eyes) B.addGeometry('eye', g);
  const skinMats = { skin: TX.dippySkin(ctx), eye: ctx.materials.color('#141210', { roughness: 0.3 }) };
  const group = B.build(skinMats);
  // winter scarf (the museum wraps Dippy up when it's cold)
  const SB = new GeoBatch();
  for (const g of geo.scarf) SB.addGeometry('scarf', g);
  const scarf = SB.build({ scarf: ctx.materials.color('#b8202f', { roughness: 0.9 }) });
  scarf.name = 'dippy-scarf';
  scarf.userData.dynamic = true;   // (season-toggled: static batching / shadow proxies leave it alone)
  group.add(scarf);
  const setSeason = (s) => { scarf.visible = s === 'winter'; };
  setSeason(ctx.env?.state?.season);
  ctx.events.on('env:season', setSeason);
  group.name = 'landmark:dippy';
  group.position.set(hx, ground, hz);
  group.rotation.y = F.rotationY; // statue +X = local u (east along Forbes)
  group.updateMatrixWorld(true);
  // colliders: four legs (the belly is high enough to walk under)
  const legs = [[0.35, 0.72], [0.15, -0.72], [4.05, 0.64], [3.9, -0.64], [0.2, 0.0]];
  for (const [lx, lz] of legs.slice(0, 4)) {
    const [x, z] = F.toWorld(hipU + lx, hipW + lz);
    ctx.colliders.addCircle(x, z, 0.5, ground - 1, ground + 2.6, 'dippy');
  }
  // tail tip & neck are above head height; body block from 2.2 m up
  ctx.colliders.addBox(...F.toWorld(hipU + 1.5, hipW), 3.4, 1.2, F.rotationY, ground + 1.9, ground + 4.8, 'dippy');
  const [cx, cz] = F.toWorld(hipU - 1, hipW);
  const entry = { key: 'dippy', kind: 'landmark', name: 'Dippy the Dinosaur', nameZh: '恐龙“迪皮”雕像', infoKey: 'dippy', position: [cx, ground + 4, cz], radius: 14 };
  ctx.pick.add(group, entry);
  const [lx, lz] = F.toWorld(hipU + 6, hipW);
  ctx.labels.add({ key: 'dippy', text: 'Dippy', textZh: '迪皮恐龙', kind: 'landmark', priority: 7, position: { x: lx, y: ground + 9.5, z: lz }, maxDistance: 700 });
  return group;
}

// ------------------------------------------------------------------------------------------------ Bellefield stack
// The Bellefield Boiler Plant (Longfellow, Alden & Harlow 1907, in Junction Hollow behind the museum; nicknamed the
// "Cloud Factory") was built to heat the Carnegie Institute and now steams most of Oakland. The plant itself stays a
// generic OSM building (w302715370); this adds its 1966 concrete stack — 255 ft = 77.7 m (Wikipedia) — at the OSM
// man_made=chimney node 3382324173, with a sooty crown, red FAA obstruction beacons (> 200 ft) and, in winter, the
// steam plume that gave the plant its nickname.
const STACK = { x: -520.6, z: 65.0, height: 77.7, r0: 3.0, r1: 2.1, osmId: 'w302715370' };

/** Open cylinder frustum from y0 (radius ra) to y1 (radius rb) with smooth normals and metre UVs. */
function stackShell(ra, rb, y0, y1, seg) {
  const g = new THREE.CylinderGeometry(rb, ra, y1 - y0, seg, 1, true);
  g.translate(0, (y0 + y1) / 2, 0);
  const uv = g.attributes.uv, circ = Math.PI * (ra + rb);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ, y0 + uv.getY(i) * (y1 - y0));
  return g;
}

/** Soft steam plume drifting ENE (prevailing westerlies): merged puffs with per-vertex alpha. */
function steamPlume(top) {
  let s = 255;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const dx = 0.93, dz = -0.36;
  const P = [], N = [], C = [];
  const n = 24;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const r = 2.2 + t * 11 + rnd() * 1.5;
    const along = t * 75 + (rnd() - 0.5) * 4;
    const side = (rnd() - 0.5) * 7 * t;
    const g = new THREE.IcosahedronGeometry(r, 2);
    g.scale(1, 0.8, 1);
    g.translate(dx * along - dz * side, top + 1.5 + t * 26 - t * t * 8 + (rnd() - 0.5) * 2 * t, dz * along + dx * side);
    const pos = g.attributes.position, nor = g.attributes.normal;
    const a = 0.05 + 0.6 * Math.pow(1 - t, 1.5);
    for (let k = 0; k < pos.count; k++) {
      P.push(pos.getX(k), pos.getY(k), pos.getZ(k));
      N.push(nor.getX(k), nor.getY(k), nor.getZ(k));
      C.push(1, 1, 1, a);
    }
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 4));
  geo.computeBoundingSphere();
  return geo;
}

async function buildBellefieldStack(ctx) {
  const { x, z, height, r0, r1 } = STACK;
  const g0 = ctx.heightAt(x, z);
  let gMin = g0;
  for (let k = 0; k < 8; k++) gMin = Math.min(gMin, ctx.heightAt(x + Math.cos(k * 0.785) * r0, z + Math.sin(k * 0.785) * r0));
  const top = g0 + height;
  const rAt = (y) => r0 + ((r1 - r0) * (y - g0)) / height;
  const seg = 20;
  const sootFrom = top - 7;
  const B = new GeoBatch();
  // tapered slip-formed concrete shaft, reaching below the sloping ground
  B.addGeometry('concrete', stackShell(r0 + 0.02, rAt(sootFrom), gMin - 1.2, sootFrom, seg));
  // weathered crown: soot-darkened top, a slightly projecting lip, the flue opening
  B.addGeometry('soot', stackShell(rAt(sootFrom), r1, sootFrom, top - 1.1, seg));
  B.addGeometry('soot', stackShell(r1 + 0.18, r1 + 0.18, top - 1.1, top, seg));
  const lipTop = new THREE.RingGeometry(r1 - 0.3, r1 + 0.18, seg, 1).rotateX(-Math.PI / 2).translate(0, top, 0);
  B.addGeometry('soot', lipTop);
  B.addGeometry('flue', new THREE.CircleGeometry(r1 - 0.28, seg).rotateX(-Math.PI / 2).translate(0, top - 0.5, 0));
  // red obstruction beacons: three around the crown and three at mid-height
  for (const [y, rr] of [[top - 0.55, r1 + 0.18], [g0 + height / 2, rAt(g0 + height / 2)]]) {
    for (let k = 0; k < 3; k++) {
      const a = (k * 2 * Math.PI) / 3 + 0.4;
      B.addGeometry('beacon', new THREE.BoxGeometry(0.5, 0.6, 0.5), new THREE.Matrix4().makeTranslation(Math.cos(a) * (rr + 0.25), y, Math.sin(a) * (rr + 0.25)));
    }
  }
  const beacon = new THREE.MeshStandardMaterial({ color: '#5c1712', roughness: 0.4, emissive: new THREE.Color('#ff2a14'), emissiveIntensity: 0 });
  beacon.name = 'bellefield-beacon';
  const group = B.build({
    concrete: ctx.materials.get('concrete'),
    soot: ctx.materials.color('#48443f', { roughness: 0.95 }),
    flue: ctx.materials.color('#151413', { roughness: 1 }),
    beacon,
  }, { shadows: { beacon: { cast: false }, flue: { cast: false } } });
  // winter steam plume (the "Cloud Factory")
  // steam scatters a lot of light: a daylight-scaled emissive term keeps it white rather than smoke-grey
  const plumeMat = new THREE.MeshStandardMaterial({ color: '#f4f4f1', roughness: 1, metalness: 0, transparent: true, depthWrite: false, vertexColors: true, emissive: new THREE.Color('#e4e2dc'), emissiveIntensity: 0.45 });
  plumeMat.name = 'bellefield-steam';
  // soft puff silhouettes: fade the alpha where the surface turns away from the viewer
  plumeMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>',
      '#include <normal_fragment_maps>\n  diffuseColor.a *= smoothstep(0.05, 0.75, abs(dot(normal, normalize(vViewPosition))));');
  };
  plumeMat.customProgramCacheKey = () => 'oaklandB-steam-v1';
  const plume = new THREE.Mesh(steamPlume(top), plumeMat);
  plume.name = 'bellefield-steam';
  plume.castShadow = false; plume.receiveShadow = false;
  plume.userData.dynamic = true;   // (season-toggled and animated)
  group.add(plume);
  const setSeason = (s) => { plume.visible = s === 'winter'; };
  setSeason(ctx.env?.state?.season);
  ctx.events.on('env:season', setSeason);
  // beacons glow red at night and pulse brighter ~40 times a minute; the plume drifts a little
  ctx.onUpdate((dt, t) => {
    const nf = ctx.env?.state?.nightFactor ?? 0;
    const ph = (t % 1.5) / 1.5;
    beacon.emissiveIntensity = nf > 0.01 ? nf * (1.5 + 4 * (ph < 0.4 ? Math.sin((ph / 0.4) * Math.PI) : 0)) : 0;
    if (plume.visible) {
      plumeMat.emissiveIntensity = 0.45 * (1 - nf) + 0.05 * nf; // faintly lit by the city at night
      plume.rotation.y = Math.sin(t * 0.07) * 0.12;
      plume.scale.setScalar(1 + 0.035 * Math.sin(t * 0.4));
    }
  }, 10);
  group.name = 'landmark:bellefieldStack';
  group.position.set(x, 0, z);
  group.updateMatrixWorld(true);
  ctx.colliders.addCircle(x, z, r0 + 0.1, gMin - 1, top, 'bellefieldStack');
  const entry = {
    key: 'bellefieldStack', kind: 'landmark', name: 'Bellefield Boiler Plant Stack', nameZh: '贝勒菲尔德锅炉厂烟囱',
    osmId: STACK.osmId, infoKey: STACK.osmId, position: [x, g0 + height * 0.5, z], radius: 20,
  };
  ctx.pick.add(group, entry);
  ctx.labels.add({ key: 'bellefieldStack', text: 'Bellefield Stack ("Cloud Factory")', textZh: '锅炉厂烟囱（云工厂）', kind: 'landmark', priority: 5, position: { x, y: top + 4, z }, maxDistance: 1500 });
  return group;
}

// Identity-only definitions: the geometry for all four buildings is produced by the 'carnegieMuseum' build (they
// share walls, cornices and roofs), these entries give the UI/search separate records and hide the generic boxes.
const identity = (k) => ({
  key: INFO[k].key, name: INFO[k].name, nameZh: INFO[k].nameZh, osmIds: [IDS[k]],
  async build() { const g = new THREE.Group(); g.name = `landmark:${INFO[k].key}`; return g; },
});

export default [
  {
    key: 'carnegieMuseum',
    name: 'Carnegie Museum of Natural History',
    nameZh: '卡内基自然历史博物馆',
    osmIds: [IDS.nh],
    build: buildComplex,
  },
  identity('art'),
  identity('lib'),
  identity('mh'),
  {
    key: 'dippy',
    name: 'Dippy the Dinosaur',
    nameZh: '恐龙“迪皮”雕像',
    osmIds: [],
    build: buildDippy,
  },
  {
    key: 'bellefieldStack',
    name: 'Bellefield Boiler Plant Stack',
    nameZh: '贝勒菲尔德锅炉厂烟囱',
    osmIds: [], // the plant (w302715370) stays a generic building; only its stack is modelled here
    build: buildBellefieldStack,
  },
];
