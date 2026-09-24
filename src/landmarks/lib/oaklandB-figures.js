// Figurative / ornamental pieces for the Carnegie Institute: J. Massey Rhind's seated bronzes and the standing
// muses on the parapets, Corinthian columns, lamp standards, the armillary sphere and Dippy the Diplodocus.
// Every builder appends to a GeoBatch under the given material keys; figures face local +Z before `m` is applied.
import * as THREE from 'three';
import { loftTube } from './oaklandB-geo.js';

const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3(), E = new THREE.Euler();

// Geometry prototypes are shared (created once per module load).
let PROTO = null;
function proto() {
  if (PROTO) return PROTO;
  PROTO = {
    box: new THREE.BoxGeometry(1, 1, 1),
    sphere: new THREE.SphereGeometry(1, 12, 8),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 8, 1),
    cone: new THREE.CylinderGeometry(0.7, 1, 1, 8, 1),
    torus: new THREE.TorusGeometry(1, 0.04, 5, 36),
    capsule: new THREE.CapsuleGeometry(1, 1, 3, 8),
    seated: new THREE.LatheGeometry([
      [0.001, 0], [0.36, 0], [0.37, 0.1], [0.33, 0.28], [0.27, 0.46], [0.24, 0.62], [0.25, 0.78], [0.27, 0.86], [0.2, 0.9], [0.001, 0.92],
    ].map(([x, y]) => new THREE.Vector2(x, y)), 12),
    robe: new THREE.LatheGeometry([
      [0.001, 0], [0.33, 0], [0.31, 0.08], [0.27, 0.45], [0.23, 0.85], [0.2, 1.15], [0.215, 1.3], [0.2, 1.4], [0.12, 1.46], [0.001, 1.47],
    ].map(([x, y]) => new THREE.Vector2(x, y)), 10),
  };
  return PROTO;
}

/** Add a prototype with position/rotation(euler XYZ)/scale relative to parent matrix `m`. */
function put(B, key, geom, m, px, py, pz, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
  E.set(rx, ry, rz);
  Q.setFromEuler(E);
  M.compose(P.set(px, py, pz), Q, S.set(sx, sy, sz));
  M.premultiply(m);
  B.addGeometry(key, geom, M);
}

/** Cylinder between two points a→b with radii ra/rb (local coords), relative to m. */
function limb(B, key, m, a, b, ra, rb = ra) {
  const g = proto().cyl;
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  const mid = new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  const r = (ra + rb) / 2;
  const mm = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(r, len, r));
  mm.premultiply(m);
  B.addGeometry(key, g, mm);
}

/**
 * Seated bronze figure in a granite klismos chair on a granite pedestal (Shakespeare, Bach, Michelangelo, Galileo).
 * m: placement matrix (origin = pedestal base centre at ground, facing +Z). Total height ≈ 1.7 + 2.3 m.
 */
export function seatedFigure(B, m, keys, pose = 0) {
  const { bronze, granite } = keys;
  const p = proto();
  // pedestal (moulded cap)
  put(B, granite, p.box, m, 0, 0.8, 0, 2.2, 1.6, 2.5);
  put(B, granite, p.box, m, 0, 1.66, 0, 2.4, 0.12, 2.7);
  const s = 1.6; // larger than life
  const base = new THREE.Matrix4().compose(new THREE.Vector3(0, 1.72, 0), new THREE.Quaternion(), new THREE.Vector3(s, s, s)).premultiply(m);
  // klismos chair with a curved back
  put(B, granite, p.box, base, 0, 0.24, -0.08, 0.95, 0.48, 0.78);
  put(B, granite, p.box, base, 0, 0.92, -0.47, 0.9, 0.9, 0.1, -0.16);
  // seated body wrapped in a gown: robe lathe (shoulders → lap), flattened front-to-back
  put(B, bronze, p.seated, base, 0, 0.44, -0.12, 1, 1, 0.82, -0.06);
  // lap drape over the thighs + knees
  for (const sx of [-1, 1]) {
    limb(B, bronze, base, [0.13 * sx, 0.6, -0.08], [0.15 * sx, 0.6, 0.34], 0.12, 0.1);
    put(B, bronze, p.capsule, base, 0.15 * sx, 0.6, 0.35, 0.1, 0.1, 0.1);
    // shins and feet (one foot forward)
    const f = sx * (pose ? 0.06 : -0.04);
    limb(B, bronze, base, [0.15 * sx, 0.58, 0.36], [0.16 * sx, 0.07, 0.4 + f], 0.075, 0.062);
    put(B, bronze, p.capsule, base, 0.16 * sx, 0.05, 0.47 + f, 0.07, 0.05, 0.12, Math.PI / 2);
  }
  put(B, bronze, p.cone, base, 0, 0.36, 0.3, 0.33, 0.5, 0.12); // hanging gown between the knees
  // neck + head (slightly bowed)
  limb(B, bronze, base, [0, 1.3, -0.1], [0, 1.44, -0.07], 0.06);
  put(B, bronze, p.sphere, base, 0, 1.54, -0.04, 0.105, 0.13, 0.115, 0.15);
  put(B, bronze, p.sphere, base, 0, 1.47, 0.02, 0.07, 0.06, 0.05); // beard / collar
  // arms: one on the chair arm / lap, the other raised to the chin or holding a book
  limb(B, bronze, base, [0.25, 1.26, -0.1], [0.3, 0.98, 0.02], 0.065, 0.055);
  limb(B, bronze, base, [0.3, 0.98, 0.02], [0.2, 0.74, 0.28], 0.052, 0.045);
  limb(B, bronze, base, [-0.25, 1.26, -0.1], [-0.31, 0.99, 0.08], 0.065, 0.055);
  if (pose === 1) {
    limb(B, bronze, base, [-0.31, 0.99, 0.08], [-0.1, 1.38, 0.08], 0.05, 0.045);
    put(B, bronze, p.box, base, 0.2, 0.72, 0.34, 0.24, 0.05, 0.32, 0.15); // book on the lap
  } else {
    limb(B, bronze, base, [-0.31, 0.99, 0.08], [-0.2, 0.76, 0.33], 0.05, 0.045);
    put(B, bronze, p.box, base, -0.18, 0.73, 0.38, 0.06, 0.05, 0.3, 0, 0.3); // scroll
  }
}

/**
 * One of Rhind's four standing muses: a robed female allegory (≈3.9 m bronze) on a stone pedestal at the parapet,
 * directly above a seated figure. seed picks the attribute: 0 laurel wreath (literature), 1 lyre (music),
 * 2 palette (art), 3 globe (science). m = pedestal base, figure facing +Z.
 */
export function standingMuse(B, m, keys, seed = 0) {
  const { bronze, stone } = keys;
  const p = proto();
  // moulded pedestal
  put(B, stone, p.box, m, 0, 0.45, 0, 1.7, 0.9, 1.5);
  put(B, stone, p.box, m, 0, 0.95, 0, 1.9, 0.12, 1.7);
  const s = 2.5;
  const lean = (seed % 2 ? -1 : 1) * 0.05;
  const fm = new THREE.Matrix4().compose(new THREE.Vector3(0, 1.0, 0.05), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, lean * 2, lean)), new THREE.Vector3(s, s, s)).premultiply(m);
  // flowing robe + cloak falling behind + a diagonal drapery fold across the front
  put(B, bronze, p.robe, fm, 0, 0, 0, 1, 1, 0.74);
  put(B, bronze, p.cone, fm, 0, 0.62, -0.13, 0.26, 1.2, 0.1, 0.08);
  put(B, bronze, p.box, fm, 0, 0.92, 0.19, 0.44, 0.07, 0.06, 0.1, 0, 0.6);
  put(B, bronze, p.box, fm, 0.06, 0.32, 0.25, 0.3, 0.5, 0.05, -0.05, 0, 0.12); // knee pushing the drapery forward
  // neck, head with bound hair
  limb(B, bronze, fm, [0, 1.44, 0], [0, 1.52, 0.01], 0.042);
  put(B, bronze, p.sphere, fm, 0, 1.6, 0.015, 0.072, 0.088, 0.08);
  put(B, bronze, p.sphere, fm, 0, 1.63, -0.05, 0.06, 0.05, 0.05);
  // arms: one raised holding the attribute aloft, the other lowered along the robe
  const up = seed % 2 === 0 ? 1 : -1;
  limb(B, bronze, fm, [0.16 * up, 1.38, 0], [0.27 * up, 1.6, 0.07], 0.042, 0.036);
  limb(B, bronze, fm, [0.27 * up, 1.6, 0.07], [0.25 * up, 1.86, 0.12], 0.034, 0.03);
  limb(B, bronze, fm, [-0.16 * up, 1.38, 0], [-0.21 * up, 1.08, 0.08], 0.042, 0.036);
  limb(B, bronze, fm, [-0.21 * up, 1.08, 0.08], [-0.12 * up, 0.86, 0.17], 0.034, 0.03);
  const ax = 0.25 * up, ay = 1.95, az = 0.12;
  switch (seed % 4) {
    case 0: put(B, bronze, p.torus, fm, ax, ay, az, 0.1, 0.1, 0.8); break; // laurel wreath
    case 1: // lyre: two arms + crossbar
      put(B, bronze, p.box, fm, ax - 0.05, ay, az, 0.025, 0.2, 0.025, 0, 0, 0.2);
      put(B, bronze, p.box, fm, ax + 0.05, ay, az, 0.025, 0.2, 0.025, 0, 0, -0.2);
      put(B, bronze, p.box, fm, ax, ay + 0.1, az, 0.18, 0.025, 0.025);
      break;
    case 2: put(B, bronze, p.cyl, fm, ax, ay, az, 0.12, 0.018, 0.09, Math.PI / 2); break; // palette
    default: put(B, bronze, p.sphere, fm, ax, ay + 0.02, az, 0.085, 0.085, 0.085); // globe
  }
  // scroll / book in the lowered hand
  put(B, bronze, p.box, fm, -0.12 * up, 0.83, 0.2, 0.1, 0.16, 0.035, 0.3);
}

/** Ornamental bronze lamp standard with three globes (lit at night). m = base at ground. */
export function lampStandard(B, m, keys) {
  const { bronze, globe } = keys;
  const p = proto();
  put(B, bronze, p.cyl, m, 0, 0.45, 0, 0.32, 0.9, 0.32);
  put(B, bronze, p.cone, m, 0, 1.05, 0, 0.18, 0.35, 0.18);
  put(B, bronze, p.cyl, m, 0, 2.6, 0, 0.09, 3.2, 0.09);
  put(B, bronze, p.box, m, 0, 4.0, 0, 1.2, 0.08, 0.08);
  for (const x of [-0.6, 0.6]) put(B, globe, p.sphere, m, x, 4.28, 0, 0.21, 0.24, 0.21);
  put(B, globe, p.sphere, m, 0, 4.55, 0, 0.24, 0.27, 0.24);
}

/** Armillary sphere (2.4 m, aluminium) on a stone pedestal. m = pedestal base. */
export function armillary(B, m, keys) {
  const { metal, stone } = keys;
  const p = proto();
  put(B, stone, p.box, m, 0, 0.6, 0, 1.4, 1.2, 1.4);
  put(B, metal, p.cyl, m, 0, 1.6, 0, 0.08, 0.8, 0.08);
  const c = new THREE.Vector3(0, 2.4, 0);
  const R = 1.2;
  for (const [rx, ry, rz] of [[0, 0, 0], [Math.PI / 2, 0, 0], [Math.PI / 2, Math.PI / 2, 0], [Math.PI / 2 - 0.41, 0, 0.3]]) {
    put(B, metal, p.torus, m, c.x, c.y, c.z, R, R, R * 1.4, rx, ry, rz);
  }
  limb(B, metal, m, [0.5, 1.2, 0], [-0.5, 3.6, 0], 0.035);
}

/**
 * Corinthian column (base + fluted shaft with entasis + bell capital with volutes and acanthus tabs).
 * Returns geometries in column space: x/z centred, y from 0 (bottom of base) to H. Shaft UVs: u = flutes, v = metres.
 */
export function corinthianColumn(D, H, flutes = 20) {
  const baseH = 0.55 * D, capH = 1.15 * D;
  const shaftY0 = baseH, shaftY1 = H - capH;
  const r0 = D / 2, r1 = D / 2 * 0.86;
  // shaft
  const seg = 24, rings = 8;
  const pos = [], nor = [], uv = [];
  const radius = (t) => r0 + (r1 - r0) * Math.pow(t, 1.6); // entasis: straight lower third then taper
  for (let i = 0; i < rings; i++) {
    const t0 = i / rings, t1 = (i + 1) / rings;
    const ya = shaftY0 + (shaftY1 - shaftY0) * t0, yb = shaftY0 + (shaftY1 - shaftY0) * t1;
    const ra = radius(t0), rb = radius(t1);
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      const u0 = (k / seg) * flutes, u1 = ((k + 1) / seg) * flutes;
      const v = (a, r, y, u) => { pos.push(Math.cos(a) * r, y, Math.sin(a) * r); nor.push(Math.cos(a), 0, Math.sin(a)); uv.push(u, y); };
      // two triangles, outward winding (counter-clockwise seen from outside)
      v(a0, ra, ya, u0); v(a1, rb, yb, u1); v(a1, ra, ya, u1);
      v(a0, ra, ya, u0); v(a0, rb, yb, u0); v(a1, rb, yb, u1);
    }
  }
  const shaft = new THREE.BufferGeometry();
  shaft.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shaft.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  shaft.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // Check orientation of the first triangle; flip if needed
  {
    const a = new THREE.Vector3(pos[0], pos[1], pos[2]), b = new THREE.Vector3(pos[3], pos[4], pos[5]), c = new THREE.Vector3(pos[6], pos[7], pos[8]);
    const n = new THREE.Vector3().crossVectors(b.sub(a), c.sub(a));
    if (n.dot(new THREE.Vector3(nor[0], 0, nor[2])) < 0) {
      const arr = shaft.attributes.position.array, ua = shaft.attributes.uv.array, na = shaft.attributes.normal.array;
      for (let i = 0; i < arr.length; i += 9) {
        for (let k = 0; k < 3; k++) { let t = arr[i + 3 + k]; arr[i + 3 + k] = arr[i + 6 + k]; arr[i + 6 + k] = t; t = na[i + 3 + k]; na[i + 3 + k] = na[i + 6 + k]; na[i + 6 + k] = t; }
        const j = (i / 9) * 6;
        for (let k = 0; k < 2; k++) { const t = ua[j + 2 + k]; ua[j + 2 + k] = ua[j + 4 + k]; ua[j + 4 + k] = t; }
      }
    }
  }
  // Attic base on a square plinth
  const R = D / 2;
  const baseLathe = new THREE.LatheGeometry([
    [0.001, 0.22 * D], [R * 1.3, 0.22 * D], [R * 1.32, 0.28 * D], [R * 1.25, 0.34 * D], [R * 1.14, 0.36 * D], [R * 1.1, 0.4 * D],
    [R * 1.16, 0.44 * D], [R * 1.08, 0.5 * D], [R * 1.0, baseH], [0.001, baseH],
  ].map(([x, y]) => new THREE.Vector2(x, y)), 20);
  const plinth = new THREE.BoxGeometry(D * 1.36, 0.22 * D, D * 1.36).translate(0, 0.11 * D, 0);
  // Capital: bell with acanthus bulge + abacus
  const y0 = shaftY1;
  const bell = new THREE.LatheGeometry([
    [0.001, y0], [r1 * 1.02, y0], [r1 * 1.08, y0 + 0.08 * D], [r1 * 1.22, y0 + 0.3 * D], [r1 * 1.18, y0 + 0.45 * D],
    [r1 * 1.3, y0 + 0.65 * D], [r1 * 1.42, y0 + 0.85 * D], [r1 * 1.5, y0 + 0.92 * D], [0.001, y0 + 0.92 * D],
  ].map(([x, y]) => new THREE.Vector2(x, y)), 16);
  const abacus = new THREE.BoxGeometry(D * 1.42, 0.23 * D, D * 1.42).translate(0, H - 0.115 * D, 0);
  const cap = [bell, abacus];
  // acanthus tabs (two rows) and corner volutes
  for (let row = 0; row < 2; row++) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + row * Math.PI / 8;
      const rr = r1 * (1.15 + row * 0.12);
      const leaf = new THREE.BoxGeometry(0.28 * D, (0.34 + row * 0.1) * D, 0.08 * D);
      leaf.translate(0, (0.17 + row * 0.05) * D, 0);
      leaf.rotateX(-0.35);
      leaf.rotateY(-a + Math.PI / 2);
      leaf.translate(Math.cos(a) * rr, y0 + (0.05 + row * 0.25) * D, Math.sin(a) * rr);
      cap.push(leaf);
    }
  }
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + (k * Math.PI) / 2;
    const vol = new THREE.CylinderGeometry(0.12 * D, 0.12 * D, 0.1 * D, 8).rotateX(Math.PI / 2).rotateY(-a);
    vol.translate(Math.cos(a) * r1 * 1.55, y0 + 0.8 * D, Math.sin(a) * r1 * 1.55);
    cap.push(vol);
  }
  return { shaft, stone: [plinth, baseLathe, ...cap], topY: H };
}

/**
 * Dippy: life-size fibreglass Diplodocus carnegii (26 m long, head ≈ 6.7 m high), tail carried high.
 * Geometry in statue space: +X = head direction, y up, hips at the origin (x=0) on the ground (y=0).
 * Returns { body: BufferGeometry[], eyes: [...] , scarf: [...] }.
 */
export function dippyGeometry() {
  // spine: [x, y, rx (half width), ry (half height)]
  const spine = [
    [-13.5, 1.55, 0.03, 0.035], [-12.4, 1.75, 0.07, 0.08], [-11.0, 2.05, 0.13, 0.15], [-9.4, 2.4, 0.2, 0.24],
    [-7.8, 2.72, 0.29, 0.34], [-6.2, 3.02, 0.4, 0.47], [-4.6, 3.28, 0.53, 0.62], [-3.0, 3.42, 0.7, 0.8],
    [-1.6, 3.47, 0.88, 0.98], [-0.2, 3.42, 1.02, 1.13], [1.2, 3.3, 1.1, 1.22], [2.5, 3.18, 1.1, 1.2],
    [3.6, 3.14, 0.98, 1.06], [4.6, 3.3, 0.78, 0.84], [5.5, 3.66, 0.57, 0.62], [6.5, 4.22, 0.44, 0.47],
    [7.6, 4.86, 0.34, 0.37], [8.7, 5.46, 0.27, 0.29], [9.7, 5.94, 0.22, 0.24], [10.5, 6.24, 0.19, 0.21],
    [11.05, 6.36, 0.19, 0.21],
  ];
  const curve = new THREE.CatmullRomCurve3(spine.map(([x, y]) => new THREE.Vector3(x, y, 0)), false, 'centripetal');
  const N = 110;
  const pts = [], radii = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    pts.push(curve.getPoint(t));
    const f = t * (spine.length - 1), k = Math.min(spine.length - 2, Math.floor(f)), a = f - k;
    const rx = spine[k][2] * (1 - a) + spine[k + 1][2] * a;
    const ry = spine[k][3] * (1 - a) + spine[k + 1][3] * a;
    radii.push([rx, ry]);
  }
  // the belly hangs a little: shift body section centres down where the body is thick
  for (let i = 0; i < N; i++) { const r = radii[i][1]; if (r > 0.6) pts[i].y -= (r - 0.6) * 0.25; }
  const body = [loftTube(pts, radii, 16)];
  // head: long low snout angled slightly down
  const head = [[10.95, 6.37, 0.19, 0.21], [11.3, 6.42, 0.22, 0.2], [11.65, 6.36, 0.19, 0.16], [11.95, 6.26, 0.14, 0.11], [12.15, 6.19, 0.09, 0.07], [12.24, 6.16, 0.02, 0.02]];
  body.push(loftTube(head.map(([x, y]) => new THREE.Vector3(x, y, 0)), head.map(([, , rx, ry]) => [rx, ry]), 12));
  // legs (walking pose): [x hip, z side, forward offset of the foot]
  const legs = [
    { x: 0.35, z: 0.72, fwd: 0.35, top: 3.05, r: [0.62, 0.46, 0.37, 0.4] },
    { x: 0.15, z: -0.72, fwd: -0.3, top: 3.05, r: [0.62, 0.46, 0.37, 0.4] },
    { x: 4.05, z: 0.64, fwd: -0.25, top: 2.85, r: [0.46, 0.34, 0.3, 0.34] },
    { x: 3.9, z: -0.64, fwd: 0.3, top: 2.85, r: [0.46, 0.34, 0.3, 0.34] },
  ];
  for (const L of legs) {
    const side = Math.sign(L.z) * 0.04;
    const ctrl = [
      new THREE.Vector3(L.x, L.top, L.z * 0.85),
      new THREE.Vector3(L.x + L.fwd * 0.3 + 0.1, L.top * 0.55, L.z + side),
      new THREE.Vector3(L.x + L.fwd * 0.8, L.top * 0.22, L.z + side),
      new THREE.Vector3(L.x + L.fwd, 0.18, L.z + side),
      new THREE.Vector3(L.x + L.fwd, -0.25, L.z + side),
    ];
    body.push(loftTube(ctrl, [[L.r[0], L.r[0] * 1.1], [L.r[1], L.r[1]], [L.r[2], L.r[2]], [L.r[3], L.r[3]], [L.r[3] * 1.12, L.r[3] * 1.12]], 12));
  }
  // eyes (dark)
  const eyes = [];
  for (const z of [-0.17, 0.17]) eyes.push(new THREE.SphereGeometry(0.045, 6, 5).translate(11.45, 6.47, z));
  // winter scarf around the base of the neck (the museum dresses Dippy up when it's cold)
  const scarf = [];
  const t0 = new THREE.Vector3(5.35, 3.72, 0);
  const tor = new THREE.TorusGeometry(0.64, 0.19, 6, 20);
  tor.rotateY(Math.PI / 2); // ring normal along +x (the neck direction)
  tor.rotateZ(0.52); // tilt the normal up with the rising neck (~30°)
  tor.translate(t0.x, t0.y, t0.z);
  scarf.push(tor);
  const tail1 = new THREE.BoxGeometry(0.42, 1.5, 0.1).translate(0, -0.75, 0).rotateX(-0.1).translate(5.15, 3.45, 0.74);
  const tail2 = new THREE.BoxGeometry(0.42, 1.25, 0.1).translate(0, -0.62, 0).rotateX(-0.2).translate(5.6, 3.55, 0.7);
  scarf.push(tail1, tail2);
  return { body, eyes, scarf };
}
