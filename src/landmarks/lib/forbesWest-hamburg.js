// Hamburg Hall (former Main Building "A" of the U.S. Bureau of Mines, Henry Hornbostel, 1915–1919; Heinz College)
// and Smith Hall (a Bureau of Mines laboratory building, now the Robotics Institute) on the south side of Forbes Ave.
//
// From photographs + aerial imagery:
//  - Hamburg Hall is a U: a three-storey range along Forbes with two long wings running south; the wings stand
//    forward of the range by ~9 m, forming a shallow forecourt with a looped drive. Pale cream-buff brick over a
//    smooth light-grey plinth, dark green multi-pane sash windows with thin stone sills, copper downspouts, and low
//    hipped roofs in pale grey-green metal with deep eaves edged in verdigris copper.
//  - On the Forbes axis a tall cast-stone frontispiece: one great round arch leading into a brick-vaulted porch
//    with the stair inside, carved foliage panels on the piers, "U.S. BUREAU OF MINES" cut in the frieze, and a
//    cornice with a crested attic block.
//  - The wings hold double-height laboratories: tall round-headed windows with fanlights, a row of square-headed
//    windows above. A half-round one-storey wing projects from the range into the courtyard.
//  - Smith Hall closes the courtyard to the south: a plain two-storey buff brick block under a hipped roof, with
//    rows of large steel industrial sash windows.
import { massing } from './north-kit.js';
import { brickPlain, seamMetal, glz } from './north-materials.js';
import {
  MeshKit, prng, planFrame, edgeInfo, openingWall, bayCentres, hippedRoof, downspout, ringGroundStats, registerForbes,
} from './forbesWest-kit.js';
import { sashAtlas, sashCell, WIN, plainMat, precast, frontispiece, signMat } from './forbesWest-materials.js';

export const HAMBURG_OSM = 'w27591096';
export const SMITH_OSM = 'w27591104';

// Local frame fitted to the OSM footprints: u runs east along the Forbes front, v runs south into the courtyard.
const F = planFrame([-217.2, -154.8], [70.2, -2.6]);
const RANGE = { u0: -35.18, u1: 35.13, v0: 0, v1: 21.4 };
const WWING = { u0: -51.27, u1: -35.51, v0: -9.06, v1: 57.6 };
const EWING = { u0: 34.8, u1: 51.8, v0: -9.06, v1: 57.1 };
const SMITH = { u0: -26.66, u1: 27.6, v0: 38.5, v1: 56.6 };
const APSE = { cu: 0.1, cv: 21.4, ru: 11.5, rv: 10.8 };

const G0 = 37.9, FH = 3.75;                      // Hamburg ground floor (Forbes entrance level) and storey height
const WALL_TOP = G0 + 3 * FH + 0.35;             // 49.6
const SLOPE = 0.31;

const rectRing = (R) => F.rect(R.u0, R.u1, R.v0, R.v1);

function hamburgMaterials(ctx) {
  const low = ctx.quality?.level === 'low';
  const brick = brickPlain(ctx, {
    colors: ['#e2d3ad', '#d9caa2', '#e7dab8', '#d2c299', '#ddcea8'], weights: [3, 3, 2, 1, 2],
    brickW: 0.2, brickH: 0.064, joint: 0.011, mortar: '#ddd6c4',
  });
  return {
    brick,
    plinth: precast(ctx, '#c8c4b8'),
    stone: plainMat(ctx, '#dcd6c7', { roughness: 0.85 }),
    sill: plainMat(ctx, '#e0dacb', { roughness: 0.8 }),
    roof: seamMetal(ctx, { color: '#667669', seam: 0.5, tileM: 4, metalness: 0.3, roughness: 0.62 }),
    fascia: plainMat(ctx, '#3f6556', { roughness: 0.5, metalness: 0.4 }),
    soffit: plainMat(ctx, '#58554c', { roughness: 0.9 }),
    pipe: plainMat(ctx, '#39473f', { roughness: 0.5, metalness: 0.4 }),
    win: sashAtlas(ctx),
    flat: ctx.materials.get('flatRoof'),
    lamp: glz(ctx, 'lamp'),
    dark: glz(ctx, 'dark'),
    low,
  };
}

// ------------------------------------------------------------------ Hamburg Hall
export function buildHamburg(ctx) {
  const kit = new MeshKit();
  const M = hamburgMaterials(ctx);
  const low = M.low;
  const rand = prng(1917);
  const rec = ctx.data?.buildings?.find((b) => b.osmId === HAMBURG_OSM);
  const outline = rec?.footprint || [...rectRing(RANGE), ...rectRing(WWING)];
  const gs = ringGroundStats(ctx, outline, 3);
  const base = Math.min(gs.min, G0 - 3.5) - 1.5;
  const H = (x, z) => ctx.heightAt(x, z);

  // apse ring (half ellipse projecting south from the range into the courtyard)
  const apse = [];
  const AS = low ? 8 : 12;
  for (let k = 0; k <= AS; k++) { const t = (k / AS) * Math.PI; apse.push(F.W(APSE.cu + Math.cos(t) * APSE.ru, APSE.cv + Math.sin(t) * APSE.rv)); }
  const APSE_TOP = G0 + 4.0;

  const vols = [
    { ring: rectRing(RANGE), y0: base, y1: WALL_TOP, wallKey: 'brick', roofKey: false, role: 'range' },
    { ring: rectRing(WWING), y0: base, y1: WALL_TOP, wallKey: 'brick', roofKey: false, role: 'wing' },
    { ring: rectRing(EWING), y0: base, y1: WALL_TOP, wallKey: 'brick', roofKey: false, role: 'wing' },
    { ring: apse, y0: base, y1: APSE_TOP, wallKey: 'brick', roofKey: 'flat', parapet: 0.5, parapetKey: 'brick', copingKey: 'sill', role: 'apse' },
  ];

  const PLINTH_TOP = G0 + 0.35;
  const spouts = [];
  // windows of one wall run; (a, b) is the exposed run, (A, B) the whole edge it belongs to
  const buildRun = (v, a, b, n, y0, y1, A, B) => {
    const { L } = edgeInfo(a, b);
    const E = edgeInfo(A, B);
    const off = Math.hypot(a[0] - A[0], a[1] - A[1]);          // run start along the full edge
    const la = F.toLocal(A[0], A[1]), lb = F.toLocal(B[0], B[1]);
    const alongU = Math.abs(lb[0] - la[0]) > Math.abs(lb[1] - la[1]);
    const ops = [];
    const push = (s, w, yb, yt, kind, arch = false) => ops.push({ s0: s - off - w / 2, s1: s - off + w / 2, yb, yt, arch, kind });
    let centres = [];
    if (v.role === 'apse') {
      if (E.L > 2.1) push(E.L / 2, Math.min(1.5, E.L - 0.6), G0 + 0.8, G0 + 3.3, WIN.sash);
    } else if (v.role === 'range' || (v.role === 'wing' && alongU)) {
      // three storeys of square-headed sash windows (the wing ends facing Forbes / Smith Hall have three bays)
      const bay = v.role === 'wing' ? 5.2 : 4.3;
      centres = bayCentres(E.L, bay, 1.4);
      const isFront = v.role === 'range' && Math.abs(la[1] - RANGE.v0) < 0.5 && Math.abs(lb[1] - RANGE.v0) < 0.5;
      for (const s of centres) {
        if (isFront) { // keep the frontispiece bay clear
          const t = s / E.L, uu = la[0] + (lb[0] - la[0]) * t;
          if (Math.abs(uu) < 6.0) continue;
        }
        for (let f = 0; f < 3; f++) {
          const yb = G0 + f * FH + 0.95, h = f === 2 ? 2.25 : 2.55;
          push(s, 2.05, yb, yb + h, WIN.sash);
        }
      }
    } else if (v.role === 'wing') {
      // long wing walls: double-height round-headed laboratory windows, square windows to the top floor
      const bay = 4.25;
      centres = bayCentres(E.L, bay, 1.6);
      for (const s of centres) {
        push(s, 2.3, G0 + 0.75, G0 + 2 * FH - 0.35, WIN.arched, true);
        push(s, 2.05, G0 + 2 * FH + 0.85, G0 + 2 * FH + 3.05, WIN.sash);
      }
    }
    // plinth (light grey, smooth) and water table
    openingWall(kit, a, b, n, y0, Math.min(PLINTH_TOP, y1), [], { wallKey: 'plinth', vRef: G0, uStart: off });
    if (y1 > PLINTH_TOP + 0.3) {
      openingWall(kit, a, b, n, PLINTH_TOP, y1, ops, {
        wallKey: 'brick', revealKey: 'brick', sillKey: 'sill', vRef: G0, uStart: off, depth: 0.3, seg: low ? 6 : 10,
        glassKey: 'win', cell: (q) => sashCell(q.kind, rand), sillProj: low ? 0 : 0.12, ground: H,
      });
      const d = E.d;
      if (L > 1) kit.beam('sill', [a[0] + n[0] * 0.05, PLINTH_TOP, a[1] + n[2] * 0.05], [b[0] + n[0] * 0.05, PLINTH_TOP, b[1] + n[2] * 0.05], 0.14, 0.22, { caps: false });
      // downspouts on every third pier line
      if (!low && v.role !== 'apse' && centres.length > 2) {
        const bayW = centres.length > 1 ? centres[1] - centres[0] : 4;
        for (let k = 1; k < centres.length; k += 3) {
          const s = centres[k] - bayW / 2 - off;
          if (s < 0.4 || s > L - 0.4) continue;
          const x = a[0] + d[0] * s + n[0] * 0.14, z = a[1] + d[1] * s + n[2] * 0.14;
          spouts.push([x, z]);
        }
      }
    }
    return true;
  };

  massing(kit, vols, {
    wallBuilder(v, a, b, n, y0, y1, uA, i) {
      const r = v.ring, A = r[i], B = r[(i + 1) % r.length];
      return buildRun(v, a, b, n, y0, y1, A, B);
    },
  });
  for (const [x, z] of spouts) downspout(kit, 'pipe', x, z, H(x, z) - 0.3, WALL_TOP + 0.1);

  // ---------------------------------------------------------------- roofs: hipped, overlapping at the wing junctions
  const rk = { roof: 'roof', fascia: 'fascia', soffit: 'soffit' };
  hippedRoof(kit, F, WWING.u0, WWING.u1, WWING.v0, WWING.v1, WALL_TOP, SLOPE, { ov: 0.95, keys: rk });
  hippedRoof(kit, F, EWING.u0, EWING.u1, EWING.v0, EWING.v1, WALL_TOP, SLOPE, { ov: 0.95, keys: rk });
  // the range roof runs out over both wings (its hip ends lie under the wing roofs); a hair lower so the coplanar
  // hip faces never fight
  hippedRoof(kit, F, WWING.u0, EWING.u1, RANGE.v0, RANGE.v1, WALL_TOP, SLOPE, { ov: 0.95, keys: { roof: 'roof' }, dy: 0.07 });
  // range eaves between the wings (fascia + soffit along the front and the courtyard side)
  for (const [vv, out] of [[RANGE.v0, -1], [RANGE.v1, 1]]) {
    const yE = WALL_TOP - 0.95 * SLOPE - 0.07;
    const ua = WWING.u1 + 0.95, ub = EWING.u0 - 0.95, ve = vv + out * 0.95;
    kit.beam('fascia', F.P(ua, yE - 0.11, ve), F.P(ub, yE - 0.11, ve), 0.1, 0.32);
    const ys = yE - 0.24;
    kit.quad('soffit', F.P(ua, ys, vv), F.P(ub, ys, vv), F.P(ub, ys, ve), F.P(ua, ys, ve), [0, -1, 0], [ua, vv], [ub, vv], [ub, ve], [ua, ve]);
  }
  // roof vents
  if (!low) {
    for (const [u, v] of [[-20, 8], [-8, 13], [12, 8], [24, 13], [-43.4, 30], [-43.4, 45], [43.3, 25], [43.3, 42]]) {
      const [x, z] = F.W(u, v);
      const top = WALL_TOP + 2.2;
      kit.cylinder('pipe', x, z, top - 1.2, top + 0.6, 0.18, 0.18, 6);
    }
  }

  // ---------------------------------------------------------------- frontispiece on the Forbes axis
  const P0 = { u0: -4.6, u1: 4.6, v0: -2.5 };
  const gEnt = Math.max(H(...F.W(0, -3)), H(...F.W(-3, -3)), H(...F.W(3, -3)));
  const pBase = Math.min(gEnt, G0) - 1.2;
  const ARCH = { s0: 2.7, s1: 6.5 };                     // along the face from u = -4.6
  const crown = G0 + 6.35;
  const CORN0 = G0 + 8.25, CORN1 = G0 + 9.0;             // cornice
  const pTop = CORN0;
  {
    // built east → west so the carving reads correctly from the street (the face looks north)
    const a = F.W(P0.u1, P0.v0), b = F.W(P0.u0, P0.v0);
    const n = F.dirOf(0, -1);
    const frontMat = frontispiece(ctx, { w: 9.2, h: pTop - pBase, a0: ARCH.s0, a1: ARCH.s1, archTop: crown - pBase, friezeY: crown + 1.15 - pBase });
    M.frontis = frontMat;
    openingWall(kit, a, b, n, pBase, pTop, [{ s0: ARCH.s0, s1: ARCH.s1, yb: G0 - 0.02, yt: crown, arch: true, depth: -P0.v0 }], {
      wallKey: 'frontis', revealKey: 'brick', sillKey: 'stone', vRef: pBase, uStart: 0, seg: low ? 8 : 14,
    });
    // sides + top
    for (const [u, s] of [[P0.u0, -1], [P0.u1, 1]]) {
      const p = F.W(u, P0.v0), q = F.W(u, 0);
      const nn = F.dirOf(s, 0);
      const A = s < 0 ? q : p, B = s < 0 ? p : q;
      kit.quad('stone', [A[0], pBase, A[1]], [B[0], pBase, B[1]], [B[0], pTop, B[1]], [A[0], pTop, A[1]], nn, [0, 0], [2.5, 0], [2.5, pTop - pBase], [0, pTop - pBase]);
    }
    kit.cap('stone', F.rect(P0.u0, P0.u1, P0.v0, 0), pTop, true);
    // mouldings, cornice, attic block and crest
    const box = (key, u0, u1, v0, v1, y0, y1) => {
      const [x, z] = F.W((u0 + u1) / 2, (v0 + v1) / 2);
      kit.box(key, x, (y0 + y1) / 2, z, u1 - u0, y1 - y0, v1 - v0, F.rotY);
    };
    box('stone', P0.u0 - 0.12, P0.u1 + 0.12, P0.v0 - 0.12, 0, CORN0 - 0.35, CORN0);           // bed moulding
    box('stone', P0.u0 - 0.4, P0.u1 + 0.4, P0.v0 - 0.42, 0, CORN0, CORN1);                    // cornice
    box('stone', -3.5, 3.5, P0.v0 + 0.2, 0, CORN1, CORN1 + 0.95);                             // attic
    box('stone', -3.7, 3.7, P0.v0 + 0.1, 0, CORN1 + 0.95, CORN1 + 1.15);                      // attic cap
    box('stone', -0.8, 0.8, P0.v0 + 0.05, -0.6, CORN1 + 1.15, CORN1 + 2.15);                  // crest block
    if (!low) {
      const [cx, cz] = F.W(0, P0.v0 - 0.02);
      kit.cylinder('stone', cx, cz, CORN1 + 1.35, CORN1 + 2.0, 0.55, 0.55, 12);               // cartouche disc
      box('stone', -1.3, -0.8, P0.v0 + 0.15, -0.6, CORN1 + 1.15, CORN1 + 1.75);               // scrolls
      box('stone', 0.8, 1.3, P0.v0 + 0.15, -0.6, CORN1 + 1.15, CORN1 + 1.75);
      box('stone', P0.u0 - 0.1, P0.u1 + 0.1, P0.v0 - 0.1, 0, pBase, G0 - 0.25);               // plinth course
    }
    // porch: steps up from the walk inside the arch, door with fanlight at the back
    const nSteps = Math.max(1, Math.round((G0 - gEnt) / 0.16));
    const r = (ARCH.s1 - ARCH.s0) / 2 - 0.02, uc = 0;
    for (let k = 0; k < nSteps; k++) {
      const y1 = gEnt + ((k + 1) * (G0 - gEnt)) / nSteps;
      const v0 = P0.v0 - 0.9 + (k * (0.9 + 1.8)) / nSteps;
      box('stone', uc - r - 0.3, uc + r + 0.3, v0, 0, Math.min(gEnt, pBase + 1) - 0.4, y1);
    }
    // door + fanlight (sash atlas door cell) set in the front wall at v = 0
    const cell = sashCell(WIN.door, rand);
    const dA = F.W(r, -0.04), dB = F.W(-r, -0.04), dn = F.dirOf(0, -1);
    const spring = crown - r;
    const G = (s, y) => [cell[0] + (cell[2] - cell[0]) * (s / (2 * r)), cell[1] + (cell[3] - cell[1]) * ((y - G0) / (crown - G0))];
    const at = (s, y) => [dA[0] + (dB[0] - dA[0]) * s / (2 * r), y, dA[1] + (dB[1] - dA[1]) * s / (2 * r)];
    kit.quad('win', at(0, G0), at(2 * r, G0), at(2 * r, spring), at(0, spring), dn, G(0, G0), G(2 * r, G0), G(2 * r, spring), G(0, spring));
    const seg = low ? 8 : 14;
    for (let k = 0; k < seg; k++) {
      const t0 = Math.PI - (k / seg) * Math.PI, t1 = Math.PI - ((k + 1) / seg) * Math.PI;
      const p0 = [r + Math.cos(t0) * r, spring + Math.sin(t0) * r], p1 = [r + Math.cos(t1) * r, spring + Math.sin(t1) * r];
      kit.tri('win', at(r, spring), at(p0[0], p0[1]), at(p1[0], p1[1]), dn, G(r, spring), G(p0[0], p0[1]), G(p1[0], p1[1]));
    }
    // porch lantern
    const [lx, lz] = F.W(0, -1.3);
    kit.box('lamp', lx, crown - 0.9, lz, 0.4, 0.5, 0.4, F.rotY);
    // pedestal lamps at the foot of the arch
    if (!low) {
      for (const s of [-1, 1]) {
        const [px, pz] = F.W(s * (r + 0.9), P0.v0 - 0.7);
        const gy = H(px, pz);
        kit.box('stone', px, gy + 0.35, pz, 0.8, 0.7, 0.8, F.rotY);
        kit.cylinder('pipe', px, pz, gy + 0.7, gy + 2.3, 0.07, 0.07, 6, { top: false });
        kit.box('lamp', px, gy + 2.5, pz, 0.36, 0.42, 0.36, F.rotY);
      }
    }
    // name sign on the east pier
    const sA = F.W(P0.u1 - 0.35, P0.v0 - 0.03), sB = F.W(P0.u1 - 2.05, P0.v0 - 0.03);
    kit.quad('sign', [sA[0], G0 + 0.9, sA[1]], [sB[0], G0 + 0.9, sB[1]], [sB[0], G0 + 1.4, sB[1]], [sA[0], G0 + 1.4, sA[1]], dn, [0, 0], [1, 0], [1, 1], [0, 1]);
  }

  const group = kit.build({
    brick: M.brick, plinth: M.plinth, stone: M.stone, sill: M.sill, roof: M.roof, fascia: M.fascia, soffit: M.soffit,
    pipe: M.pipe, win: M.win, flat: M.flat, lamp: M.lamp, frontis: M.frontis,
    sign: signMat(ctx, 'hamburg', {
      w: 1.7, h: 0.5, bg: '#1f2124', ppm: 160, lines: [
        { text: 'Hamburg Hall', size: 0.34, y: 0.4, weight: 700 },
        { text: '4800 Forbes Ave.', size: 0.2, y: 0.76, weight: 400 },
      ],
    }),
  }, { name: 'landmark:hamburgHall', noShadowKeys: ['sign', 'lamp'] });

  // colliders: range, wings, apse, frontispiece piers
  for (const v of vols) ctx.colliders.addPolygon(v.ring, base, v.y1 + 1, 'hamburgHall');
  for (const s of [-1, 1]) {
    const [x, z] = F.W(s * 3.6, -1.25);
    ctx.colliders.addBox(x, z, 1.0, 1.25, F.rotY, base, CORN1, 'hamburgHall');
  }
  const [cx, cz] = F.W(0, 12);
  registerForbes(ctx, group, {
    key: 'hamburgHall', name: 'Hamburg Hall', nameZh: '汉堡楼（海因茨学院）', osmId: HAMBURG_OSM,
    position: [cx, WALL_TOP + 3, cz], radius: 60, labelY: WALL_TOP + 9,
  });
  return group;
}

// ------------------------------------------------------------------ Smith Hall
export function buildSmith(ctx) {
  const kit = new MeshKit();
  const M = hamburgMaterials(ctx);
  const low = M.low;
  const rand = prng(1939);
  const ring = rectRing(SMITH);
  const gs = ringGroundStats(ctx, ring, 3);
  const S0 = gs.max + 0.25;                  // ground floor
  const SF = 4.0;
  const TOP = S0 + 2 * SF + 0.3;
  const base = gs.min - 1.5;
  const H = (x, z) => ctx.heightAt(x, z);
  const vols = [{ ring, y0: base, y1: TOP, wallKey: 'brick', roofKey: false }];
  const spouts = [];
  let doorDone = false;
  massing(kit, vols, {
    wallBuilder(v, a, b, n, y0, y1, uA, i) {
      const { L, d } = edgeInfo(a, b);
      const bay = 3.7;
      const centres = bayCentres(L, bay, 1.3);
      const ops = [];
      const la = F.toLocal(a[0], a[1]), lb = F.toLocal(b[0], b[1]);
      const south = Math.abs(la[1] - SMITH.v1) < 0.5 && Math.abs(lb[1] - SMITH.v1) < 0.5;
      centres.forEach((s, k) => {
        const door = south && !doorDone && k === 2;
        if (door) {
          doorDone = true;
          ops.push({ s0: s - 0.95, s1: s + 0.95, yb: S0, yt: S0 + 3.0, kind: WIN.door, door: true, depth: 0.35 });
        } else ops.push({ s0: s - 1.35, s1: s + 1.35, yb: S0 + 0.9, yt: S0 + 3.45, kind: WIN.steel });
        ops.push({ s0: s - 1.35, s1: s + 1.35, yb: S0 + SF + 0.8, yt: S0 + SF + 3.2, kind: WIN.steel });
      });
      openingWall(kit, a, b, n, y0, S0 + 0.3, [], { wallKey: 'plinth', vRef: S0 });
      openingWall(kit, a, b, n, S0 + 0.3, y1, ops.map((q) => (q.door ? { ...q, yb: S0 + 0.32 } : q)), {
        wallKey: 'brick', revealKey: 'brick', sillKey: 'sill', vRef: S0, depth: 0.25, glassKey: 'win',
        cell: (q) => sashCell(q.kind, rand), sillProj: low ? 0 : 0.1, ground: H,
      });
      kit.beam('sill', [a[0] + n[0] * 0.04, S0 + 0.3, a[1] + n[2] * 0.04], [b[0] + n[0] * 0.04, S0 + 0.3, b[1] + n[2] * 0.04], 0.12, 0.18, { caps: false });
      if (!low) for (let k = 2; k < centres.length; k += 4) {
        const s = centres[k] - bay / 2;
        spouts.push([a[0] + d[0] * s + n[0] * 0.13, a[1] + d[1] * s + n[2] * 0.13]);
      }
      return true;
    },
  });
  for (const [x, z] of spouts) downspout(kit, 'pipe', x, z, H(x, z) - 0.3, TOP + 0.1);
  hippedRoof(kit, F, SMITH.u0, SMITH.u1, SMITH.v0, SMITH.v1, TOP, 0.3, { ov: 0.75, keys: { roof: 'roof', fascia: 'fascia', soffit: 'soffit' } });
  // rooftop ventilators along the ridge (laboratory exhausts)
  const ridgeY = TOP - 0.75 * 0.3 + ((SMITH.v1 - SMITH.v0) / 2 + 0.75) * 0.3;
  const vc = (SMITH.v0 + SMITH.v1) / 2;
  const vents = low ? [-12, 8] : [-18, -9, 0, 9, 18];
  for (const u of vents) {
    const [x, z] = F.W(u, vc);
    kit.box('pipe', x, ridgeY + 0.3, z, 1.1, 1.2, 1.1, F.rotY);
    if (!low) kit.box('fascia', x, ridgeY + 1.0, z, 1.5, 0.25, 1.5, F.rotY);
  }
  const group = kit.build({
    brick: M.brick, plinth: M.plinth, sill: M.sill, roof: M.roof, fascia: M.fascia, soffit: M.soffit, pipe: M.pipe, win: M.win,
  }, { name: 'landmark:smithHall' });
  ctx.colliders.addPolygon(ring, base, TOP + 1, 'smithHall');
  const [cx, cz] = F.W(0, vc);
  registerForbes(ctx, group, {
    key: 'smithHall', name: 'Smith Hall', nameZh: '史密斯楼', osmId: SMITH_OSM,
    position: [cx, TOP + 2, cz], radius: 30, labelY: TOP + 7,
  });
  return group;
}
